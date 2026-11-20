import {
  type Completion,
  type CompletionContext,
  autocompletion,
  closeBrackets,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import {
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { fieldOf, lineKind, tokenizeMusic } from "./abc";
import { DECORATIONS } from "./explain";
import { type FileIndex, indexFile } from "./tunes";

/* The file's tunes, kept current for highlighting and completion. */
export const fileIndexField = StateField.define<FileIndex>({
  create: (state) => indexFile(state.doc.toString()),
  update: (value, transaction) =>
    transaction.docChanged ? indexFile(transaction.newDoc.toString()) : value,
});

const mark = (className: string) => Decoration.mark({ class: className });
const MARKS = {
  fieldKey: mark("abc-field-key"),
  fieldValue: mark("abc-field-value"),
  title: mark("abc-field-value abc-title"),
  note: mark("abc-note"),
  accidental: mark("abc-accidental"),
  octave: mark("abc-octave"),
  length: mark("abc-length"),
  rest: mark("abc-rest"),
  bar: mark("abc-bar"),
  chordSymbol: mark("abc-chord-symbol"),
  annotation: mark("abc-annotation"),
  chordBracket: mark("abc-chord-bracket"),
  decoration: mark("abc-decoration"),
  slur: mark("abc-slur"),
  tie: mark("abc-tie"),
  tuplet: mark("abc-tuplet"),
  broken: mark("abc-broken"),
  grace: mark("abc-grace"),
  inlineField: mark("abc-inline-field"),
  comment: mark("abc-comment"),
  directive: mark("abc-directive"),
  lyrics: mark("abc-lyrics"),
  text: mark("abc-text"),
  unknown: mark("abc-unknown"),
};

function highlightLine(
  builder: RangeSetBuilder<Decoration>,
  text: string,
  from: number,
  inBody: boolean,
) {
  const kind = lineKind(text, inBody);
  const add = (start: number, end: number, decoration: Decoration) => {
    if (end > start) builder.add(from + start, from + end, decoration);
  };
  switch (kind) {
    case "blank":
      return;
    case "comment":
      add(0, text.length, MARKS.comment);
      return;
    case "directive":
      add(0, text.length, MARKS.directive);
      return;
    case "text":
      add(0, text.length, MARKS.text);
      return;
    case "lyrics":
      add(0, 2, MARKS.fieldKey);
      add(2, text.length, MARKS.lyrics);
      return;
    case "field": {
      const field = fieldOf(text);
      add(0, 2, MARKS.fieldKey);
      const comment = text.indexOf("%", 2);
      const end = comment > 0 ? comment : text.length;
      add(2, end, field?.key === "T" ? MARKS.title : MARKS.fieldValue);
      if (comment > 0) add(comment, text.length, MARKS.comment);
      return;
    }
  }
  for (const token of tokenizeMusic(text, 0)) {
    switch (token.kind) {
      case "note": {
        const head = token.accidental.length;
        add(token.from, token.from + head, MARKS.accidental);
        add(token.from + head, token.from + head + 1, MARKS.note);
        add(token.from + head + 1, token.from + head + 1 + token.octave.length, MARKS.octave);
        add(token.lengthFrom, token.to, MARKS.length);
        break;
      }
      case "rest":
        add(token.from, token.from + 1, MARKS.rest);
        add(token.lengthFrom, token.to, MARKS.length);
        break;
      case "bar":
        add(token.from, token.to, MARKS.bar);
        break;
      case "chord-open":
        add(token.from, token.to, MARKS.chordBracket);
        break;
      case "chord-close":
        add(token.from, token.from + 1, MARKS.chordBracket);
        add(token.from + 1, token.to, MARKS.length);
        break;
      case "chord-symbol":
        add(token.from, token.to, MARKS.chordSymbol);
        break;
      case "annotation":
        add(token.from, token.to, MARKS.annotation);
        break;
      case "decoration":
        add(token.from, token.to, MARKS.decoration);
        break;
      case "slur":
        add(token.from, token.to, MARKS.slur);
        break;
      case "tie":
        add(token.from, token.to, MARKS.tie);
        break;
      case "tuplet":
        add(token.from, token.to, MARKS.tuplet);
        break;
      case "broken":
        add(token.from, token.to, MARKS.broken);
        break;
      case "grace-open":
      case "grace-close":
        add(token.from, token.to, MARKS.grace);
        break;
      case "inline-field":
        add(token.from, token.to, MARKS.inlineField);
        break;
      case "comment":
        add(token.from, token.to, MARKS.comment);
        break;
      case "unknown":
        add(token.from, token.to, MARKS.unknown);
        break;
    }
  }
}

/** Highlights only the visible lines, so a long file costs nothing extra while typing. */
const abcHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const index = view.state.field(fileIndexField);
      for (const { from, to } of view.visibleRanges) {
        let position = from;
        while (position <= to) {
          const line = view.state.doc.lineAt(position);
          const tune = index.tunes.find((each) => line.from >= each.from && line.from < each.to);
          const inBody = Boolean(tune && line.from >= tune.bodyFrom);
          const inTune = Boolean(tune) || (index.header !== null && line.from < index.header.to);
          if (inTune || fieldOf(line.text)) highlightLine(builder, line.text, line.from, inBody);
          else if (line.text.trim()) builder.add(line.from, line.to, MARKS.text);
          position = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/* Marks from the score and the player: ranges in the text. */
export type Marks = {
  caret?: { from: number; to: number }[];
  playing?: { from: number; to: number }[];
  issues?: {
    from: number;
    to: number;
    message: string;
    severity: "warning" | "error";
    kind: "bar" | "parse";
  }[];
};
export const setMarks = StateEffect.define<Marks>();

const caretMark = Decoration.mark({ class: "abc-caret-note" });
const playingMark = Decoration.mark({ class: "abc-playing" });
const barIssueMark = Decoration.mark({ class: "abc-bar-issue" });
const warningMark = Decoration.mark({ class: "abc-warning" });

type MarkState = {
  caret: DecorationSet;
  playing: DecorationSet;
  issues: DecorationSet;
  list: NonNullable<Marks["issues"]>;
};

function rangesToSet(
  ranges: { from: number; to: number }[],
  decoration: Decoration,
  length: number,
): DecorationSet {
  const sorted = ranges
    .map((range) => ({
      from: Math.max(0, Math.min(range.from, length)),
      to: Math.max(0, Math.min(range.to, length)),
    }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(sorted.map((range) => decoration.range(range.from, range.to)));
}

export const marksField = StateField.define<MarkState>({
  create: () => ({
    caret: Decoration.none,
    playing: Decoration.none,
    issues: Decoration.none,
    list: [],
  }),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged)
      next = {
        caret: next.caret.map(transaction.changes),
        playing: next.playing.map(transaction.changes),
        issues: next.issues.map(transaction.changes),
        list: next.list
          .map((issue) => ({
            ...issue,
            from: transaction.changes.mapPos(issue.from),
            to: transaction.changes.mapPos(issue.to),
          }))
          .filter((issue) => issue.to >= issue.from),
      };
    for (const effect of transaction.effects) {
      if (!effect.is(setMarks)) continue;
      const length = transaction.newDoc.length;
      const marks = effect.value;
      next = {
        caret: marks.caret ? rangesToSet(marks.caret, caretMark, length) : next.caret,
        playing: marks.playing ? rangesToSet(marks.playing, playingMark, length) : next.playing,
        issues: marks.issues
          ? Decoration.set(
              marks.issues
                .map((issue) => ({
                  ...issue,
                  from: Math.min(issue.from, length),
                  to: Math.min(issue.to, length),
                }))
                .filter((issue) => issue.to > issue.from)
                .sort((a, b) => a.from - b.from)
                .map((issue) =>
                  (issue.kind === "bar" ? barIssueMark : warningMark).range(issue.from, issue.to),
                ),
              true,
            )
          : next.issues,
        list: marks.issues ?? next.list,
      };
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.issues),
    EditorView.decorations.from(field, (value) => value.caret),
    EditorView.decorations.from(field, (value) => value.playing),
  ],
});

class IssueMarker extends GutterMarker {
  constructor(
    readonly message: string,
    readonly severity: string,
  ) {
    super();
  }
  eq(other: IssueMarker) {
    return other.message === this.message && other.severity === this.severity;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = `abc-gutter-mark ${this.severity}`;
    element.title = this.message;
    element.setAttribute("aria-label", this.message);
    return element;
  }
}

const issueGutter = gutter({
  class: "abc-gutter",
  markers(view) {
    const { list } = view.state.field(marksField);
    const builder = new RangeSetBuilder<GutterMarker>();
    const seen = new Set<number>();
    const lines = list
      .map((issue) => ({
        line: view.state.doc.lineAt(Math.min(issue.from, view.state.doc.length)),
        issue,
      }))
      .sort((a, b) => a.line.from - b.line.from);
    for (const { line, issue } of lines) {
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      const all = lines
        .filter((each) => each.line.from === line.from)
        .map((each) => each.issue.message);
      builder.add(line.from, line.from, new IssueMarker(all.join("\n"), issue.severity));
    }
    return builder.finish();
  },
  initialSpacer: () => new IssueMarker("", "warning"),
});

/* Completion: header fields, keys, meters, lengths, decorations, voices and directives. */
const FIELD_COMPLETIONS: Completion[] = [
  ["X:", "reference number — starts a tune"],
  ["T:", "title"],
  ["C:", "composer"],
  ["O:", "origin"],
  ["R:", "rhythm (reel, jig, hornpipe…)"],
  ["M:", "meter"],
  ["L:", "unit note length"],
  ["Q:", "tempo"],
  ["K:", "key — ends the header"],
  ["V:", "voice"],
  ["P:", "part"],
  ["w:", "lyrics under the notes"],
  ["W:", "words after the tune"],
  ["N:", "notes"],
  ["S:", "source"],
  ["Z:", "transcription"],
  ["%%score ", "voices on systems"],
  ["%%MIDI program ", "playback instrument"],
].map(
  ([label, detail]): Completion => ({
    label: label as string,
    detail: detail as string,
    type: "keyword",
  }),
);

const KEYS = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Am",
  "Em",
  "Bm",
  "F#m",
  "C#m",
  "Dm",
  "Gm",
  "Cm",
  "Fm",
  "Ddor",
  "Edor",
  "Ador",
  "Gdor",
  "Amix",
  "Dmix",
  "Gmix",
  "Emin",
  "none",
];
const KEY_DETAIL: Record<string, string> = {
  C: "no sharps or flats",
  G: "1♯",
  D: "2♯",
  A: "3♯",
  E: "4♯",
  B: "5♯",
  "F#": "6♯",
  F: "1♭",
  Bb: "2♭",
  Eb: "3♭",
  Ab: "4♭",
  Db: "5♭",
  Am: "minor, no sharps",
  Em: "minor, 1♯",
  Bm: "minor, 2♯",
  "F#m": "minor, 3♯",
  "C#m": "minor, 4♯",
  Dm: "minor, 1♭",
  Gm: "minor, 2♭",
  Cm: "minor, 3♭",
  Fm: "minor, 4♭",
  Ddor: "Dorian, no sharps",
  Edor: "Dorian, 2♯",
  Ador: "Dorian, 1♯",
  Gdor: "Dorian, 1♭",
  Amix: "Mixolydian, 2♯",
  Dmix: "Mixolydian, 1♯",
  Gmix: "Mixolydian, none",
  Emin: "minor, 1♯",
  none: "no key signature",
};
const METERS: [string, string][] = [
  ["4/4", "four quarters"],
  ["3/4", "waltz, three quarters"],
  ["2/4", "march, polka"],
  ["6/8", "jig: two dotted beats"],
  ["9/8", "slip jig"],
  ["12/8", "slide"],
  ["2/2", "reel in cut time"],
  ["C", "common time"],
  ["C|", "cut time"],
  ["5/4", "five quarters"],
  ["7/8", "2+2+3"],
  ["none", "free time"],
];
const LENGTHS: [string, string][] = [
  ["1/8", "eighth note"],
  ["1/4", "quarter note"],
  ["1/16", "sixteenth note"],
  ["1/2", "half note"],
];

function abcCompletions(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const value = (pattern: RegExp, options: Completion[], from: number) =>
    pattern.test(before) ? { from, options, validFor: /^[\w#/|]*$/ } : null;
  const key = /^K:\s*(\S*)$/.exec(before);
  if (key)
    return {
      from: context.pos - (key[1] as string).length,
      options: KEYS.map(
        (label): Completion => ({ label, detail: KEY_DETAIL[label] ?? "", type: "constant" }),
      ),
      validFor: /^[\w#]*$/,
    };
  const meter = /^M:\s*(\S*)$/.exec(before);
  if (meter)
    return {
      from: context.pos - (meter[1] as string).length,
      options: METERS.map(([label, detail]) => ({ label, detail, type: "constant" })),
      validFor: /^[\w/|]*$/,
    };
  const length = /^L:\s*(\S*)$/.exec(before);
  if (length)
    return {
      from: context.pos - (length[1] as string).length,
      options: LENGTHS.map(([label, detail]) => ({ label, detail, type: "constant" })),
      validFor: /^[\w/]*$/,
    };
  const tempo = /^Q:\s*(\S*)$/.exec(before);
  if (tempo)
    return value(
      /^Q:/,
      [
        { label: "1/4=120", detail: "120 quarter notes a minute" },
        { label: "3/8=100", detail: "jig: 100 dotted quarters" },
        { label: "1/2=90", detail: "reel: 90 half notes" },
      ],
      context.pos - (tempo[1] as string).length,
    );
  const voice = /^V:\s*(\S*)$/.exec(before) ?? /\[V:\s*(\S*)$/.exec(before);
  if (voice) {
    const index = context.state.field(fileIndexField);
    const ids = new Set(index.tunes.flatMap((tune) => tune.voices.map((each) => each.id)));
    const options: Completion[] = [...ids].map((label) => ({
      label,
      detail: "existing voice",
      type: "variable",
    }));
    options.push({
      label: `${ids.size + 1} name="Voice ${ids.size + 1}"`,
      detail: "a new voice",
      type: "keyword",
    });
    options.push({
      label: `${ids.size + 1} clef=bass`,
      detail: "a new bass voice",
      type: "keyword",
    });
    return { from: context.pos - (voice[1] as string).length, options, validFor: /^[\w]*$/ };
  }
  const decoration = /!([\w().<>]*)$/.exec(before);
  if (decoration && (before.match(/!/g)?.length ?? 0) % 2 === 1)
    return {
      from: context.pos - (decoration[1] as string).length,
      options: Object.entries(DECORATIONS).map(([label, detail]) => ({
        label,
        apply: `${label}!`,
        detail,
        type: "function",
      })),
      validFor: /^[\w().<>]*$/,
    };
  const field = /^([A-Za-z%]{0,2})$/.exec(before);
  if (
    field &&
    (context.explicit ||
      (field[1] && /^[A-Z%]$/.test(field[1] as string) && line.text.length === before.length))
  ) {
    return { from: line.from, options: FIELD_COMPLETIONS, validFor: /^[A-Za-z%]{0,2}:?$/ };
  }
  return null;
}

const theme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
});

export type EditorHooks = {
  onUpdate: (update: ViewUpdate) => void;
  keys: KeyBinding[];
  extra?: Extension[];
};

/** The editing state for a text; one per open file, so undo history never crosses files. */
export function editorState(text: string, hooks: EditorHooks): EditorState {
  const extensions: Extension[] = [
    fileIndexField,
    marksField,
    lineNumbers(),
    issueGutter,
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    highlightActiveLine(),
    highlightSelectionMatches(),
    closeBrackets(),
    autocompletion({ override: [abcCompletions], icons: false, activateOnTyping: true }),
    search({ top: true }),
    abcHighlight,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      "aria-label": "ABC music text",
      spellcheck: "false",
      autocapitalize: "off",
      autocorrect: "off",
    }),
    keymap.of([
      ...hooks.keys,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of(hooks.onUpdate),
    theme,
    ...(hooks.extra ?? []),
  ];
  return EditorState.create({ doc: text, extensions });
}
