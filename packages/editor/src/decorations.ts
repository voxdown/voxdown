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
import { nameReadAt, readNamesField, spokenName } from "./scene-names";
import { ChipWidget, LineWidget, type PageTurnTools, type ReadAloud } from "./widgets";

/**
 * Live preview: every line shows the story as it reads, with a character's name as a chip in their
 * color, a direction as a small label above the words it directs,
 * sounds and page turns as chips, and scene breaks and groups drawn across the page. The line you
 * are typing in shows its raw marks instead, and "Show marks" shows them everywhere. Switches
 * leave out names, directions, sounds, character sounds, page turns or notes,
 * or the speakers' colors, everywhere but where you type.
 */
export type Character = {
  handle: string;
  name: string;
  color?: string;
  /** Written in the text but not in the cast yet: colored, never suggested. */
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
   * The host's own instructions (§9.5), by name, such as `tool:join`: drawn as this small mark
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
  /** The host's controls on every page turn drawn (a chime and rest button, say). */
  pageTurnTools?: PageTurnTools;
  /**
   * What a scene break opens, by where its mark starts and the scene's number in text order
   * (`sceneNumbers`). Unless said, `Scene N`.
   */
  sceneLabel?: (state: EditorState, from: number, scene: number) => string | undefined;
  /**
   * A speaker on every scene break and heading that reads the scene's name aloud:
   * it writes `Name.` as a line of its own after the mark, and takes it out again.
   */
  readSceneAloud?: {
    /** How a scene's number is said in the story's language ("Toneel 2"): unless said, its label. */
    say?: (scene: number) => string;
    /** The name a heading's scene had (the project's): a line still saying it is out of date. */
    nameWas?: (state: EditorState, from: number) => string | undefined;
  };
};

/** What the page draws, as the host's switches choose. */
export type ViewSwitches = {
  /** Each speaker's words underlined, and their name chip, in their color. */
  color: boolean;
  names: boolean;
  directions: boolean;
  sounds: boolean;
  /** Sounds a character makes: `@Gerald [snores]`. */
  vocal: boolean;
  pages: boolean;
  notes: boolean;
};

const ALL_ON: ViewSwitches = {
  color: true,
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

/**
 * Each scene break's and heading's scene, numbered in text order, by where its
 * mark starts: the story's first scene has no mark before it, unless the text opens with one.
 */
export function sceneNumbers(state: EditorState): Map<number, number> {
  const marks = state.field(marksField);
  const starts = marks
    .filter((m) => m.kind === "break" || m.kind === "heading")
    .sort((a, b) => a.from - b.from);
  const blank = (from: number, to: number) => !state.sliceDoc(from, to).trim();
  // A mark with nothing after it before the next (or the end) opens no scene: `---` twice, or
  // `---` straight before a heading, is one scene.
  const opening = starts.filter((m, i) => !blank(m.to, starts[i + 1]?.from ?? state.doc.length));
  const first = opening[0];
  // The text opens with a scene when nothing but scene marks comes before its first.
  let opens = Boolean(first);
  let at = marks.find((m) => m.kind === "frontmatter")?.to ?? 0;
  for (const m of starts) {
    if (!first || m.from > first.from) break;
    if (!blank(at, m.from)) opens = false;
    at = m.to;
  }
  return new Map(opening.map((m, index) => [m.from, index + (opens ? 1 : 2)]));
}

/** Lines short enough to show raw while you type in them; long paragraphs show only the mark you're in. */
const SHORT_LINE = 160;

/**
 * Where the text is open (its marks shown raw): the cursor, or a selection within
 * one line. While the pointer is down nothing opens or closes, so a drag never makes the page
 * move under it; letting go without moving is a click (or tap), and opens where it put the
 * cursor; letting go after a drag keeps what was open before, as does a selection over several
 * lines made with the keys.
 */
type Open = { ranges: ReadonlyArray<{ from: number; to: number }>; held: boolean };

/** The pointer down (true), or let go: `"click"` without moving, `"drag"` after a drag. */
export const holdOpen = StateEffect.define<boolean | "click" | "drag">();

const withinLines = (state: EditorState) =>
  state.selection.ranges.every(
    (r) => r.empty || state.doc.lineAt(r.from).number === state.doc.lineAt(r.to).number,
  );
const rangesOf = (state: EditorState) =>
  state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));

export const openField = StateField.define<Open>({
  create: (state) => ({ ranges: withinLines(state) ? rangesOf(state) : [], held: false }),
  update(value, tr) {
    const mapped = tr.docChanged
      ? value.ranges.map((r) => ({
          from: tr.changes.mapPos(r.from, -1),
          to: tr.changes.mapPos(r.to, 1),
        }))
      : value.ranges;
    for (const effect of tr.effects) {
      if (!effect.is(holdOpen)) continue;
      if (effect.value === true) return { ranges: mapped, held: true };
      if (effect.value === "drag") return { ranges: mapped, held: false };
      return { ranges: withinLines(tr.state) ? rangesOf(tr.state) : mapped, held: false };
    }
    if (value.held) return mapped === value.ranges ? value : { ranges: mapped, held: true };
    if ((tr.selection || tr.docChanged) && withinLines(tr.state))
      return { ranges: rangesOf(tr.state), held: false };
    return mapped === value.ranges ? value : { ranges: mapped, held: false };
  },
});

/** The pointer's press and release, told to `openField`: a release after moving is a drag. */
const pointerHold = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
  },
  {
    eventHandlers: {
      pointerdown(event, view) {
        if (event.button !== 0) return false;
        const x = event.clientX;
        const y = event.clientY;
        view.dispatch({ effects: holdOpen.of(true) });
        const up = (end: PointerEvent) => {
          window.removeEventListener("pointerup", up, true);
          window.removeEventListener("pointercancel", up, true);
          const moved = Math.hypot(end.clientX - x, end.clientY - y) > 4;
          // After the editor has set the selection for this press.
          queueMicrotask(() => view.dispatch({ effects: holdOpen.of(moved ? "drag" : "click") }));
        };
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
        return false;
      },
    },
  },
);

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.field(openField).ranges) {
    if (range.to > state.doc.length) continue;
    const a = state.doc.lineAt(range.from).number;
    const b = state.doc.lineAt(range.to).number;
    for (let n = a; n <= b; n++) if (state.doc.line(n).length <= SHORT_LINE) lines.add(n);
  }
  return lines;
}

function touchesSelection(state: EditorState, from: number, to: number) {
  return state.field(openField).ranges.some((r) => r.from <= to && r.to >= from);
}

const shortSound = (text: string) => {
  const label = text.split(";")[0]?.trim() ?? text;
  return label.length > 42 ? `${label.slice(0, 40)}…` : label;
};

function build(view: EditorView, options: PreviewOptions): DecorationSet {
  const { state } = view;
  const marks = state.field(marksField);
  const scenes = sceneNumbers(state);
  /** The speaker on a scene's mark, when the host has it. */
  const readAloud = (mark: { from: number; to: number }, name: string): ReadAloud | undefined => {
    if (!options.readSceneAloud) return undefined;
    // The name its speaker last wrote, else the one the host's project has.
    const was = nameReadAt(state, mark.from) ?? options.readSceneAloud.nameWas?.(state, mark.from);
    const said = spokenName(state, mark.to, name, was);
    return {
      name,
      said: said?.said ?? null,
      stale: said?.stale ?? false,
      ...(was && was !== name ? { was } : {}),
    };
  };
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
      decorations.push({ from, to, deco: Decoration.mark({ class: "vxd-note vxd-raw" }) });
      return;
    }
    decorations.push({ from, to, deco });
  };
  const tinted = (cls: string, color?: string) =>
    Decoration.mark(
      color ? { class: cls, attributes: { style: `--vxd-speaker: ${color}` } } : { class: cls },
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
      // Open only with the cursor on it: a selection passing over leaves it compact.
      const cursorHere = state
        .field(openField)
        .ranges.some((r) => r.from === r.to && r.from >= line.from && r.from <= line.to);
      if (!line.text.trim() && !cursorHere)
        add(line.from, line.from, Decoration.line({ class: "vxd-blank" }));
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
    const color = shown.color ? colorOf("speaker" in mark ? mark.speaker : undefined) : undefined;
    switch (mark.kind) {
      case "speech":
        if (shown.color || showRaw) add(mark.from, mark.to, tinted("vxd-speech", color));
        break;
      case "directed":
        if (shown.directions || showRaw)
          add(mark.from, mark.to, Decoration.mark({ class: "vxd-directed" }));
        break;
      case "warning":
        add(
          mark.from,
          mark.to,
          Decoration.mark({ class: "vxd-warning", attributes: { title: mark.message } }),
        );
        break;
      case "in-group":
        add(mark.from, mark.from, Decoration.line({ class: "vxd-in-group" }));
        break;
      case "frontmatter":
        add(mark.from, mark.to, Decoration.mark({ class: "vxd-frontmatter" }));
        break;
      case "escape":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-escape" }));
        else add(mark.from, mark.to, Decoration.replace({}));
        break;
      case "name":
        if (showRaw) add(mark.from, mark.to, tinted("vxd-name vxd-raw", color));
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
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-direction vxd-raw" }));
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
                mark.speaker,
              ),
            }),
          );
        }
        break;
      case "run-repeat":
        // A run's later lines: the bar beside them carries the direction, drawn once above.
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-direction vxd-raw" }));
        else if (mark.to < state.doc.length && state.sliceDoc(mark.to, mark.to + 1) === " ")
          add(mark.from, mark.to + 1, Decoration.replace({}));
        else add(mark.from, mark.to, Decoration.replace({}));
        break;
      case "cleared":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-direction vxd-raw" }));
        // The dashes under a direction's words already show where it ends.
        else if (mark.to < state.doc.length && state.sliceDoc(mark.to, mark.to + 1) === " ")
          add(mark.from, mark.to + 1, Decoration.replace({}));
        else add(mark.from, mark.to, Decoration.replace({}));
        break;
      case "sound":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-sound vxd-raw" }));
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
        if (showRaw) add(mark.from, mark.to, tinted("vxd-name vxd-raw", color));
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
                undefined,
                mark.speaker,
              ),
            }),
          );
        break;
      case "page": {
        const turnsTo = mark.label ?? options.pageLabel?.(state, mark.from);
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-page vxd-raw" }));
        else if (!shown.pages) leaveOut(mark.from, mark.to);
        else if (
          mark.ownLine ||
          // Ending its paragraph's words, it is drawn below them across the page, as
          // a script draws it.
          !state.sliceDoc(mark.to, state.doc.lineAt(mark.to).to).trim()
        )
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new LineWidget(
                "turn",
                // The page it turns to, as a script's markers say it.
                pagesOff ? "page turn · this story has no pages yet" : (turnsTo ?? "page turn"),
                "Page turn: {page}",
                pagesOff ? undefined : options.pageTurnTools,
                !mark.ownLine,
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
                undefined,
                pagesOff ? undefined : options.pageTurnTools,
              ),
            }),
          );
        break;
      }
      case "pause":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-page vxd-raw" }));
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
        //: the line they are on.
        if (mark.text === "book only" || mark.text === "hidden")
          add(
            state.doc.lineAt(mark.from).from,
            state.doc.lineAt(mark.from).from,
            Decoration.line({ class: "vxd-unheard" }),
          );
        // A mistyped instruction looks like one: drawn as a warning, not a quiet chip.
        const wrong = marks.find(
          (m) => m.kind === "warning" && m.from < mark.to && mark.from < m.to,
        );
        const tool = wrong ? undefined : options.toolMarks?.[mark.text.split(" ")[0] ?? ""];
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-note vxd-raw" }));
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
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-note" }));
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
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-group vxd-raw" }));
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
                undefined,
                false,
                mark.close ? undefined : mark.voice,
              ),
            }),
          );
        break;
      case "heading":
        if (showRaw) add(mark.from, mark.to, Decoration.mark({ class: "vxd-heading vxd-raw" }));
        else
          add(
            mark.from,
            mark.to,
            Decoration.replace({
              widget: new LineWidget(
                "heading",
                mark.text,
                mark.hidden ? "Scene name (not read aloud)" : "Heading",
                undefined,
                false,
                undefined,
                scenes.has(mark.from) ? readAloud(mark, mark.text) : undefined,
              ),
            }),
          );
        break;
      case "break": {
        if (showRaw) {
          add(mark.from, mark.to, Decoration.mark({ class: "vxd-break vxd-raw" }));
          break;
        }
        // The scene it opens, numbered in text order; one with nothing after it
        // opens none.
        const number = scenes.get(mark.from);
        const label =
          number === undefined
            ? "Scene break · nothing after it"
            : (options.sceneLabel?.(state, mark.from, number) ?? `Scene ${number}`);
        add(
          mark.from,
          mark.to,
          Decoration.replace({
            widget: new LineWidget(
              "break",
              label,
              "Scene break: ---",
              undefined,
              false,
              undefined,
              number === undefined
                ? undefined
                : readAloud(mark, options.readSceneAloud?.say?.(number) ?? label),
            ),
          }),
        );
        break;
      }
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

/** The front matter folded to one line while reading: the story starts the page. */
class FrontMatterFold extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: FrontMatterFold) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "vxd-frontmatter-fold";
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
    readNamesField,
    openField,
    pointerHold,
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
