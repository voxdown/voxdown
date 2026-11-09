import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { LabelWidget, stackLabels } from "./labels";
import { type EditorMark, editorMarks } from "./marks";
import { ChipWidget, LineWidget } from "./widgets";

/**
 * Live preview: every line shows the story as it reads, with a character's name as a chip in their
 * colour, a direction as a small label above the words it directs (Performance's look, 1082),
 * sounds and page turns as chips, and scene breaks and groups drawn across the page. The line you
 * are typing in shows its raw marks instead, and "Show marks" shows them everywhere. Switches
 * (as Performance's) leave out names, directions, sounds, character sounds, page turns or notes,
 * or the speakers' colours, everywhere but where you type.
 */
export type Character = {
  handle: string;
  name: string;
  color?: string;
  /** Written in the text but not in the cast yet: coloured, never suggested. */
  provisional?: boolean;
};

export type PreviewOptions = {
  characters: () => readonly Character[];
  /** Clicking a name chip, for a host's speaker menu. Without it, a click puts the cursor there. */
  onNameClick?: (view: EditorView, at: { from: number; to: number; speaker: string }) => void;
  /** Start with every mark shown raw. */
  showMarks?: boolean;
  /** Type “ ” and ’ for " and ' (on unless false). */
  smartQuotes?: boolean;
  /** Whether page turns do anything where this text goes; when not, they're drawn inactive. */
  pageTurns?: () => boolean;
  /**
   * The host's own instructions (§9.5), by name, such as `kinu:join`: drawn as this small mark
   * with this title instead of as a chip naming them.
   */
  toolMarks?: Readonly<Record<string, { text: string; title: string }>>;
  /** Which kinds of mark are drawn to begin with (all of them unless said). */
  view?: Partial<ViewSwitches>;
  /**
   * A host's status for a sound or a character's sound, by where its mark starts (a take's, say):
   * set on its chip as `data-status`, for the host to draw. Read again whenever the host sends an
   * effect.
   */
  chipStatus?: (
    state: EditorState,
    from: number,
    to: number,
  ) => { name: string; title: string } | undefined;
  /** What a page turn turns to (the next page's name), by where its mark starts. */
  pageLabel?: (state: EditorState, from: number) => string | undefined;
};

/** What the page draws, as Performance's switches choose (1082). */
export type ViewSwitches = {
  /** Each speaker's words underlined, and their name chip, in their colour. */
  colour: boolean;
  names: boolean;
  directions: boolean;
  sounds: boolean;
  /** Sounds a character makes: `@Gerald [snores]`. */
  vocal: boolean;
  pages: boolean;
  notes: boolean;
};

const ALL_ON: ViewSwitches = {
  colour: true,
  names: true,
  directions: true,
  sounds: true,
  vocal: true,
  pages: true,
  notes: true,
};

export const setView = StateEffect.define<Partial<ViewSwitches>>();

export const viewField = StateField.define<ViewSwitches>({
  create: () => ALL_ON,
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) if (e.is(setView)) next = { ...next, ...e.value };
    return next;
  },
});

export const setShowMarks = StateEffect.define<boolean>();

export const showMarksField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setShowMarks)) return e.value;
    return value;
  },
});

/** The marks of the current text, worked out again only when the text changes. */
export const marksField = StateField.define<EditorMark[]>({
  create: (state) => editorMarks(state.doc.toString()),
  update(marks, tr) {
    return tr.docChanged ? editorMarks(tr.state.doc.toString()) : marks;
  },
});

/** Lines short enough to show raw while you type in them; long paragraphs show only the mark you're in. */
const SHORT_LINE = 160;

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const a = state.doc.lineAt(range.from).number;
    const b = state.doc.lineAt(range.to).number;
    for (let n = a; n <= b; n++) if (state.doc.line(n).length <= SHORT_LINE) lines.add(n);
  }
  return lines;
}

function touchesSelection(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

const shortSound = (text: string) => {
  const label = text.split(";")[0]?.trim() ?? text;
  return label.length > 42 ? `${label.slice(0, 40)}…` : label;
};

function build(view: EditorView, options: PreviewOptions): DecorationSet {
  const { state } = view;
  const marks = state.field(marksField);
  const raw = state.field(showMarksField);
  const shown = state.field(viewField);
  const pagesOff = options.pageTurns ? !options.pageTurns() : false;
  const active = activeLines(state);
  const people = new Map(options.characters().map((c) => [c.handle.toLowerCase(), c]));
  const colorOf = (speaker?: string) =>
    speaker ? people.get(speaker.toLowerCase())?.color : undefined;
  const nameOf = (speaker: string) => people.get(speaker.toLowerCase())?.name ?? speaker;
  const decorations: Array<{ from: number; to: number; deco: Decoration }> = [];
  // A replacement may never cross a line break (CodeMirror refuses, and the editor stops). A mark
  // that does, like a note still being typed, is drawn as a styled mark instead.
  const crossesLine = (from: number, to: number) =>
    to > from && state.doc.lineAt(from).number !== state.doc.lineAt(Math.max(from, to - 1)).number;
  const add = (from: number, to: number, deco: Decoration) => {
    if (from < to && isReplace(deco) && crossesLine(from, to)) {
      decorations.push({ from, to, deco: Decoration.mark({ class: "am-note am-raw" }) });
      return;
    }
    decorations.push({ from, to, deco });
  };
  const tinted = (cls: string, color?: string) =>
    Decoration.mark(
      color ? { class: cls, attributes: { style: `--am-speaker: ${color}` } } : { class: cls },
    );
  /** A mark switched off: left out, with one space so the words either side still read. */
  const leaveOut = (from: number, to: number) => {
    const line = state.doc.lineAt(from);
    const after = state.sliceDoc(to, to + 1) === " ";
    const before = from > line.from && state.sliceDoc(from - 1, from) === " ";
    add(from, after && (before || from === line.from) ? to + 1 : to, Decoration.replace({}));
  };

  // A blank line between paragraphs reads as a paragraph's gap, not a whole empty line.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (
        !line.text.trim() &&
        !active.has(line.number) &&
        !touchesSelection(state, line.from, line.to)
      )
        add(line.from, line.from, Decoration.line({ class: "am-blank" }));
      pos = line.to + 1;
    }
  }

  for (const mark of marks) {
    const lineNo = state.doc.lineAt(mark.from).number;
    const showRaw =
      raw ||
      active.has(lineNo) ||
      touchesSelection(state, mark.from, mark.to) ||
      mark.to > state.doc.length;
    const color = shown.colour ? colorOf("speaker" in mark ? mark.speaker : undefined) : undefined;
    switch (mark.kind) {
      case "speech":
        if (shown.colour || showRaw) add(mark.from, mark.to, tinted("am-speech", color));
        break;
      case "directed":
        if (shown.directions || showRaw)
          add(mark.from, mark.to, Decoration.mark({ class: "am-directed" }));
        break;
      case "warning":
        add(
          mark.from,
          mark.to,
          Decoration.mark({ class: "am-warning", attributes: { title: mark.message } }),
        );
        break;
      case "in-group":
        add(mark.from, mark.from, Decoration.line({ class: "am-in-group" }));
        break;
      case "frontmatter":
        add(mark.from, mark.to, Decoration.mark({ class: "am-frontmatter" }));
        break;
      case "escape":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-escape" }));
        else add(mark.from, mark.to, Decoration.replace({}));
        break;
      case "name":
        if (showRaw) add(mark.from, mark.to, tinted("am-name am-raw", color));
        else if (!shown.names) leaveOut(mark.from, mark.to);
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new ChipWidget(
                "name",
                nameOf(mark.speaker),
                color,
                `@${mark.speaker}`,
                options.onNameClick
                  ? (v) =>
                      options.onNameClick?.(v, {
                        from: mark.from,
                        to: mark.to,
                        speaker: mark.speaker,
                      })
                  : undefined,
                mark.from,
              ),
            }),
          );
        break;
      case "direction":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-direction am-raw" }));
        else if (!shown.directions) leaveOut(mark.from, mark.to);
        else {
          // Above the words it directs: the space after it goes too, so the words keep their place.
          const end = state.sliceDoc(mark.to, mark.to + 1) === " " ? mark.to + 1 : mark.to;
          add(
            mark.from,
            end,
            Decoration.replace({
              widget: new LabelWidget(
                mark.text,
                "Direction: click to change it",
                mark.from,
                mark.to,
              ),
            }),
          );
        }
        break;
      case "run-repeat":
        // A run's later lines: the bar beside them carries the direction, drawn once above.
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-direction am-raw" }));
        else if (mark.to < state.doc.length && state.sliceDoc(mark.to, mark.to + 1) === " ")
          add(mark.from, mark.to + 1, Decoration.replace({}));
        else add(mark.from, mark.to, Decoration.replace({}));
        break;
      case "cleared":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-direction am-raw" }));
        // The dashes under a direction's words already show where it ends.
        else if (mark.to < state.doc.length && state.sliceDoc(mark.to, mark.to + 1) === " ")
          add(mark.from, mark.to + 1, Decoration.replace({}));
        else add(mark.from, mark.to, Decoration.replace({}));
        break;
      case "sound":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-sound am-raw" }));
        else if (!shown.sounds) leaveOut(mark.from, mark.to);
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new ChipWidget(
                "sound",
                shortSound(mark.text),
                undefined,
                mark.text,
                undefined,
                mark.from,
                options.chipStatus?.(state, mark.from, mark.to),
              ),
            }),
          );
        break;
      case "vocal":
        if (showRaw) add(mark.from, mark.to, tinted("am-name am-raw", color));
        else if (!shown.vocal) leaveOut(mark.from, mark.to);
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new ChipWidget(
                "vocal",
                `${nameOf(mark.speaker)} · ${shortSound(mark.text)}`,
                color,
                mark.text,
                undefined,
                mark.from,
                options.chipStatus?.(state, mark.from, mark.to),
              ),
            }),
          );
        break;
      case "page": {
        const turnsTo = mark.label ?? options.pageLabel?.(state, mark.from);
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-page am-raw" }));
        else if (!shown.pages) leaveOut(mark.from, mark.to);
        else if (mark.ownLine)
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new LineWidget(
                "turn",
                pagesOff
                  ? "page turn · this story has no pages yet"
                  : turnsTo
                    ? `page turn · ${turnsTo}`
                    : "page turn",
                "{page}",
              ),
            }),
          );
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new ChipWidget(
                "page",
                pagesOff
                  ? "page turn (no pages yet)"
                  : turnsTo
                    ? `page turn · ${turnsTo}`
                    : "page turn",
                undefined,
                pagesOff ? "This story has no pages yet: set them up in Pages" : "{page}",
                undefined,
                mark.from,
              ),
            }),
          );
        break;
      }
      case "pause":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-page am-raw" }));
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new ChipWidget(
                "pause",
                mark.value ? `pause ${mark.value}` : "pause",
                undefined,
                "{pause}",
                undefined,
                mark.from,
              ),
            }),
          );
        break;
      case "instruction": {
        // Words printed but never read aloud, or neither, look quieter than the words heard
        // (1082, review r2): the line they are on.
        if (mark.text === "book only" || mark.text === "hidden")
          add(
            state.doc.lineAt(mark.from).from,
            state.doc.lineAt(mark.from).from,
            Decoration.line({ class: "am-unheard" }),
          );
        // A mistyped instruction looks like one: drawn as a warning, not a quiet chip.
        const wrong = marks.find(
          (m) => m.kind === "warning" && m.from < mark.to && mark.from < m.to,
        );
        const tool = wrong ? undefined : options.toolMarks?.[mark.text.split(" ")[0] ?? ""];
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-note am-raw" }));
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: tool
                ? new ChipWidget("tool", tool.text, undefined, tool.title, undefined, mark.from)
                : new ChipWidget(
                    wrong ? "warning" : "instruction",
                    mark.text,
                    undefined,
                    wrong && wrong.kind === "warning" ? wrong.message : mark.raw,
                    undefined,
                    mark.from,
                  ),
            }),
          );
        break;
      }
      case "note":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-note" }));
        else if (!shown.notes) leaveOut(mark.from, mark.to);
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new ChipWidget(
                "note",
                mark.text,
                undefined,
                "Note: never read aloud",
                undefined,
                mark.from,
              ),
            }),
          );
        break;
      case "group":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-group am-raw" }));
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new LineWidget(
                "group",
                mark.close
                  ? "end of group"
                  : [mark.speaker ? nameOf(mark.speaker) : "", mark.text]
                      .filter(Boolean)
                      .join(" · ") || "group",
                mark.close ? ":::" : "Applies to the lines below, until :::",
              ),
            }),
          );
        break;
      case "heading":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-heading am-raw" }));
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new LineWidget(
                "heading",
                mark.text,
                mark.hidden ? "Scene name (not read aloud)" : "Heading",
              ),
            }),
          );
        break;
      case "break":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "am-break am-raw" }));
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({ widget: new LineWidget("break", "scene break", "---") }),
          );
        break;
    }
  }
  // A replacement inside another (an escape inside a note) would fight it: the outer one wins.
  const replaces = decorations
    .filter((d) => d.from < d.to && isReplace(d.deco))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const dropped = new Set<(typeof decorations)[number]>();
  let reach = -1;
  for (const d of replaces) {
    if (d.from < reach) dropped.add(d);
    else reach = d.to;
  }
  return Decoration.set(
    decorations.filter((d) => !dropped.has(d)).map((d) => d.deco.range(d.from, d.to)),
    true,
  );
}

const isReplace = (deco: Decoration) =>
  (deco.spec as { widget?: unknown }).widget !== undefined ||
  !(deco.spec as { class?: string }).class;

/** The front matter folded to one line while reading: the story starts the page (1082). */
class FrontMatterFold extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: FrontMatterFold) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "am-frontmatter-fold";
    el.textContent = this.text;
    el.title = "The title, language and cast. Click here, or Show marks, to see them.";
    return el;
  }
  // A click puts the cursor there, which opens it.
  override ignoreEvent() {
    return false;
  }
}

function foldFrontMatter(state: EditorState): DecorationSet {
  if (state.field(showMarksField)) return Decoration.none;
  const fm = state.field(marksField).find((m) => m.kind === "frontmatter");
  if (!fm) return Decoration.none;
  const from = state.doc.lineAt(fm.from).from;
  const to = state.doc.lineAt(Math.max(fm.from, Math.min(fm.to, state.doc.length) - 1)).to;
  if (to <= from || state.selection.ranges.some((r) => r.from <= to && r.to >= from))
    return Decoration.none;
  const text = state.sliceDoc(from, to);
  const title = /^title:[ \t]*(.+)$/mu
    .exec(text)?.[1]
    ?.replace(/^["']|["']$/gu, "")
    .trim();
  const cast = /^cast:[ \t]*$/mu.test(text)
    ? (text.split(/^cast:[ \t]*$/mu)[1] ?? "").split("\n").filter((l) => /^[ \t]+\S/u.test(l))
        .length
    : 0;
  const summary = [title, cast ? `${cast} in the cast` : "", "title, language and cast"]
    .filter(Boolean)
    .join(" · ");
  return Decoration.set([
    Decoration.replace({ widget: new FrontMatterFold(summary), block: true }).range(from, to),
  ]);
}

const frontMatterField = StateField.define<DecorationSet>({
  create: foldFrontMatter,
  update: (value, tr) =>
    tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setShowMarks))
      ? foldFrontMatter(tr.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

export function livePreview(options: PreviewOptions): Extension {
  return [
    showMarksField.init(() => options.showMarks ?? false),
    viewField.init(() => ({ ...ALL_ON, ...options.view })),
    marksField,
    frontMatterField,
    stackLabels,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view, options);
        }
        update(update: ViewUpdate) {
          // Any effect may change what is drawn (a switch, or the host's statuses).
          const toggled = update.transactions.some((tr) => tr.effects.length > 0);
          if (update.docChanged || update.selectionSet || toggled || update.viewportChanged)
            this.decorations = build(update.view, options);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
