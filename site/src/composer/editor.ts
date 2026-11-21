import {
  type Completion,
  type CompletionContext,
  autocompletion,
  closeBrackets,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import {
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Transaction,
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
  update: (value, transaction) => {
    if (!transaction.docChanged) return value;
    try {
      return indexFile(transaction.newDoc.toString());
    } catch (error) {
      reportFieldError(error);
      return { header: null, tunes: [] };
    }
  },
});

/** A field must never throw: a failed update would leave the screen and the document apart. */
let fieldErrorHandler: (error: unknown) => void = () => {};
export function onFieldError(handler: (error: unknown) => void) {
  fieldErrorHandler = handler;
}
function reportFieldError(error: unknown) {
  try {
    fieldErrorHandler(error);
  } catch {
    /* The report itself must not throw either. */
  }
}

/** Keeps a stored range inside a document of `length`. */
export function clampRange<T extends { from: number; to: number }>(range: T, length: number): T {
  const from = Math.max(0, Math.min(range.from, length));
  return { ...range, from, to: Math.max(from, Math.min(range.to, length)) };
}

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
      try {
        return this.highlight(view);
      } catch (error) {
        reportFieldError(error);
        return Decoration.none;
      }
    }
    highlight(view: EditorView): DecorationSet {
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
    kind: "bar" | "parse" | "lyrics";
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
    try {
      return updateMarks(value, transaction);
    } catch (error) {
      // Lose the marks, never the edit.
      reportFieldError(error);
      return {
        caret: Decoration.none,
        playing: Decoration.none,
        issues: Decoration.none,
        list: [],
      };
    }
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.issues),
    EditorView.decorations.from(field, (value) => value.caret),
    EditorView.decorations.from(field, (value) => value.playing),
  ],
});

function updateMarks(value: MarkState, transaction: Transaction): MarkState {
  let next = value;
  if (transaction.docChanged) {
    const before = transaction.startState.doc.length;
    next = {
      caret: next.caret.map(transaction.changes),
      playing: next.playing.map(transaction.changes),
      issues: next.issues.map(transaction.changes),
      // Stored positions are kept inside the old document before mapping, so mapping never throws.
      list: next.list
        .map((issue) => clampRange(issue, before))
        .map((issue) => ({
          ...issue,
          from: transaction.changes.mapPos(issue.from),
          to: transaction.changes.mapPos(issue.to),
        }))
        .filter((issue) => issue.to >= issue.from),
    };
  }
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
              .map((issue) => clampRange(issue, length))
              .filter((issue) => issue.to > issue.from)
              .sort((a, b) => a.from - b.from)
              .map((issue) =>
                (issue.kind === "parse" ? warningMark : barIssueMark).range(issue.from, issue.to),
              ),
            true,
          )
        : next.issues,
      // The list is kept clamped, like the decorations made from it.
      list: marks.issues ? marks.issues.map((issue) => clampRange(issue, length)) : next.list,
    };
  }
  return next;
}

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

/** Keeps a list in the order given (most used first), whatever the matcher's own scores. */
export function inOrder(options: Completion[]): Completion[] {
  return options.map((option, index) => ({ ...option, boost: Math.max(-99, 99 - index * 3) }));
}

const FIELDS: [string, string][] = [
  ["X:", "reference number — starts a tune"],
  ["T:", "title"],
  ["C:", "composer"],
  ["M:", "meter"],
  ["L:", "unit note length"],
  ["Q:", "tempo"],
  ["K:", "key — ends the header"],
  ["V:", "voice"],
  ["P:", "part"],
  ["R:", "rhythm (reel, jig, hornpipe…)"],
  ["O:", "origin"],
  ["w:", "lyrics under the notes"],
  ["W:", "words after the tune"],
  ["N:", "notes"],
  ["S:", "source"],
  ["Z:", "transcription"],
  ["%%score ", "voices on systems"],
  ["%%MIDI program ", "playback instrument"],
];
export const FIELD_COMPLETIONS = inOrder(
  FIELDS.map(([label, detail]): Completion => ({ label, detail, type: "keyword" })),
);

/** Keys, most used first: the common majors, then their minors, then modes and the rest. */
export const KEYS: [string, string][] = [
  ["C", "major, no sharps or flats"],
  ["G", "major, 1♯"],
  ["D", "major, 2♯"],
  ["F", "major, 1♭"],
  ["A", "major, 3♯"],
  ["Bb", "major, 2♭"],
  ["Am", "minor, no sharps or flats"],
  ["Em", "minor, 1♯"],
  ["Dm", "minor, 1♭"],
  ["E", "major, 4♯"],
  ["Eb", "major, 3♭"],
  ["Bm", "minor, 2♯"],
  ["Gm", "minor, 2♭"],
  ["Ador", "Dorian, 1♯"],
  ["Edor", "Dorian, 2♯"],
  ["Ddor", "Dorian, no sharps or flats"],
  ["Dmix", "Mixolydian, 1♯"],
  ["Amix", "Mixolydian, 2♯"],
  ["Gmix", "Mixolydian, no sharps or flats"],
  ["Ab", "major, 4♭"],
  ["Db", "major, 5♭"],
  ["B", "major, 5♯"],
  ["F#", "major, 6♯"],
  ["F#m", "minor, 3♯"],
  ["C#m", "minor, 4♯"],
  ["Cm", "minor, 3♭"],
  ["Fm", "minor, 4♭"],
  ["Gdor", "Dorian, 1♭"],
  ["none", "no key signature"],
];
/** Meters, most used first. */
export const METERS: [string, string][] = [
  ["4/4", "four quarters"],
  ["3/4", "waltz, three quarters"],
  ["6/8", "jig: two dotted beats"],
  ["2/4", "march, polka"],
  ["2/2", "reel in cut time"],
  ["C", "common time"],
  ["C|", "cut time"],
  ["9/8", "slip jig"],
  ["12/8", "slide"],
  ["5/4", "five quarters"],
  ["7/8", "2+2+3"],
  ["none", "free time"],
];
export const LENGTHS: [string, string][] = [
  ["1/8", "eighth note"],
  ["1/4", "quarter note"],
  ["1/16", "sixteenth note"],
  ["1/2", "half note"],
];
export const TEMPI: [string, string][] = [
  ["1/4=120", "120 quarter notes a minute"],
  ["1/4=100", "100 quarter notes a minute"],
  ["3/8=100", "jig: 100 dotted quarters"],
  ["1/2=90", "reel: 90 half notes"],
  ["1/4=60", "slow: 60 quarter notes"],
];
/** Decorations, the ones reached for most first; the rest follow alphabetically. */
const DECORATION_ORDER = [
  "p",
  "mf",
  "f",
  "pp",
  "ff",
  "mp",
  "trill",
  "fermata",
  "accent",
  "staccato",
  "tenuto",
  "roll",
  "crescendo(",
  "crescendo)",
  "diminuendo(",
  "diminuendo)",
  "mordent",
  "turn",
  "segno",
  "coda",
  "D.C.",
  "D.S.",
  "fine",
  "breath",
  "upbow",
  "downbow",
];
export function decorationOptions(): Completion[] {
  const rest = Object.keys(DECORATIONS)
    .filter((name) => !DECORATION_ORDER.includes(name))
    .sort((a, b) => a.localeCompare(b));
  return inOrder(
    [...DECORATION_ORDER.filter((name) => name in DECORATIONS), ...rest].map((label) => ({
      label,
      apply: `${label}!`,
      detail: DECORATIONS[label] as string,
      type: "function",
    })),
  );
}
const pairs = (list: [string, string][], type: string) =>
  inOrder(list.map(([label, detail]) => ({ label, detail, type })));

function abcCompletions(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const after = (match: RegExpExecArray) => context.pos - (match[1] as string).length;
  const key = /^K:\s*(\S*)$/.exec(before);
  if (key) return { from: after(key), options: pairs(KEYS, "constant"), validFor: /^[\w#]*$/ };
  const meter = /^M:\s*(\S*)$/.exec(before);
  if (meter)
    return { from: after(meter), options: pairs(METERS, "constant"), validFor: /^[\w/|]*$/ };
  const length = /^L:\s*(\S*)$/.exec(before);
  if (length)
    return { from: after(length), options: pairs(LENGTHS, "constant"), validFor: /^[\w/]*$/ };
  const tempo = /^Q:\s*(\S*)$/.exec(before);
  if (tempo)
    return { from: after(tempo), options: pairs(TEMPI, "constant"), validFor: /^[\w/=]*$/ };
  const voice = /^V:\s*(\S*)$/.exec(before) ?? /\[V:\s*(\S*)$/.exec(before);
  if (voice) {
    // The voices of the tune at the caret first, in their order; then new ones.
    const index = context.state.field(fileIndexField);
    const tune = index.tunes.find((each) => context.pos >= each.from && context.pos <= each.to);
    const ids = [
      ...new Set(
        (tune ? tune.voices : index.tunes.flatMap((each) => each.voices)).map((each) => each.id),
      ),
    ];
    const next = String(Math.max(0, ...ids.map((id) => Number(id) || 0)) + 1);
    const options: Completion[] = ids.map((label) => ({
      label,
      detail: "a voice of this tune",
      type: "variable",
    }));
    options.push({ label: `${next} name="Voice ${next}"`, detail: "a new voice", type: "keyword" });
    options.push({ label: `${next} clef=bass`, detail: "a new bass voice", type: "keyword" });
    return { from: after(voice), options: inOrder(options), validFor: /^[\w]*$/ };
  }
  const decoration = /!([\w().<>]*)$/.exec(before);
  if (decoration && (before.match(/!/g)?.length ?? 0) % 2 === 1)
    return { from: after(decoration), options: decorationOptions(), validFor: /^[\w().<>]*$/ };
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
    closeBrackets(),
    autocompletion({ override: [abcCompletions], icons: false, activateOnTyping: true }),
    search({ top: true }),
    abcHighlight,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      "aria-label": "ABC music text",
      tabindex: "0",
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
