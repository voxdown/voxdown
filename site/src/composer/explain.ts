import {
  type Fraction,
  type MusicToken,
  type NoteToken,
  alterationOf,
  fieldOf,
  frac,
  lineKind,
  meterLength,
  mul,
  octaveOf,
  parseKey,
  parseLength,
  parseUnit,
  pitchName,
  value,
} from "./abc";
import { DECORATIONS, describeKey, describeMeter } from "./names";
import { describePassDynamics, passDynamics } from "./passes";
import { type FileIndex, type TuneInfo, tuneAt } from "./tunes";
import { type WalkState, tuneItems, walkTune } from "./walk";

/** What the caret is on, read aloud in a quiet status line. */
export { DECORATIONS, describeKey, describeMeter };

export type Explanation = { token: string; text: string; midi?: number[] | undefined };

const LENGTH_NAMES: [number, string][] = [
  [2, "a double whole note"],
  [1.5, "a dotted whole note"],
  [1, "a whole note"],
  [0.875, "a double-dotted half note"],
  [0.75, "a dotted half note"],
  [0.5, "a half note"],
  [0.375, "a dotted quarter note"],
  [0.25, "a quarter note"],
  [0.1875, "a dotted eighth note"],
  [0.125, "an eighth note"],
  [0.09375, "a dotted sixteenth note"],
  [0.0625, "a sixteenth note"],
  [0.03125, "a thirty-second note"],
];

export function lengthName(duration: Fraction): string {
  const amount = value(duration);
  const found = LENGTH_NAMES.find(([length]) => Math.abs(length - amount) < 1e-9);
  if (found) return found[1];
  return `${duration.num}/${duration.den} of a whole note`;
}

function octavePhrase(letter: string, octave: number): string {
  if (octave === 4) return letter.toUpperCase() === "C" ? "middle C" : "just above middle C";
  if (octave === 3) return "just below middle C";
  const distance = octave > 4 ? octave - 4 : 3 - octave;
  const count =
    distance === 1
      ? "an octave"
      : distance === 2
        ? "two octaves"
        : distance === 3
          ? "three octaves"
          : `${distance} octaves`;
  return octave > 4 ? `${count} above middle C` : `${count} below middle C`;
}

const FIELD_NAMES: Record<string, string> = {
  X: "reference number — starts a tune",
  T: "title",
  C: "composer",
  O: "origin",
  A: "area",
  B: "book",
  D: "discography",
  F: "file URL",
  G: "group",
  H: "history",
  I: "instruction",
  N: "notes",
  P: "parts",
  Q: "tempo",
  R: "rhythm",
  S: "source",
  Z: "transcription",
  r: "remark",
  m: "macro",
  s: "symbol line",
  U: "user-defined symbol",
  W: "words printed after the tune",
  w: "words sung under the notes",
};

const SHORTHAND: Record<string, string> = {
  ".": "staccato: shorter, detached",
  "~": "roll (Irish ornament)",
  H: "fermata (pause)",
  L: "accent",
  M: "lower mordent",
  O: "coda sign",
  P: "upper mordent",
  S: "segno sign",
  T: "trill",
  u: "up bow",
  v: "down bow",
};

function barName(text: string): string {
  if (/^\[?[|]?[0-9]/.test(text.replace(/^\[\|/, "[")) || /^[[|][0-9]/.test(text))
    return `${text.includes("2") && !text.includes("1") ? "second" : text.includes("1") ? "first" : "numbered"} ending`;
  if (text === "|") return "bar line";
  if (text === "||") return "double bar line";
  if (text === "|]") return "final bar line";
  if (text === "[|") return "thick-thin bar line";
  if (text === "::" || text === ":|:" || text === ":||:") return "end one repeat and start another";
  if (text.startsWith(":")) return "end of a repeat: play from the last start-repeat again";
  if (text.endsWith(":")) return "start of a repeat";
  return "bar line";
}

function tupletText(token: string): string {
  const [p, q] = token.slice(1).split(":");
  const words: Record<string, string> = {
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
  };
  const name =
    p === "3"
      ? "triplet"
      : p === "2"
        ? "duplet"
        : p === "4"
          ? "quadruplet"
          : p === "5"
            ? "quintuplet"
            : p === "6"
              ? "sextuplet"
              : "tuplet";
  const defaults: Record<string, string> = { "2": "3", "3": "2", "4": "3", "6": "2", "8": "3" };
  const time = q || defaults[p ?? ""] || "2";
  return `${name}: ${words[p ?? ""] ?? p} notes in the time of ${words[time] ?? time}`;
}

function describeNote(
  note: NoteToken,
  state: WalkState,
  played?: { duration: Fraction; why: string },
): { text: string; midi: number } {
  const { alter, source } = alterationOf(note, state.key, state.bar);
  const octave = octaveOf(note.letter, note.octave);
  const duration = played?.duration ?? mul(parseLength(note.length), state.unit);
  const name = pitchName(note.letter, alter);
  const from =
    source === "key"
      ? ` (${alter > 0 ? "sharp" : "flat"} from the key)`
      : source === "bar"
        ? " (carried from earlier in the bar)"
        : note.accidental === "="
          ? " (natural)"
          : "";
  const midi =
    (octave + 1) * 12 +
    ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note.letter.toUpperCase()] ?? 0) +
    alter;
  const length = note.inChord ? "" : `, ${lengthName(duration)}${played?.why ?? ""}`;
  return { text: `${name}${from}, ${octavePhrase(note.letter, octave)}${length}`, midi };
}

/** Explains the token at `position` (the caret), with what sounds there. */
export function explainAt(text: string, file: FileIndex, position: number): Explanation | null {
  const lineFrom = text.lastIndexOf("\n", position - 1) + 1;
  let lineTo = text.indexOf("\n", position);
  if (lineTo < 0) lineTo = text.length;
  const line = text.slice(lineFrom, lineTo);
  const tune = tuneAt(file, position);
  const inBody = Boolean(tune && position >= tune.bodyFrom && position <= tune.to);
  const kind = tune && position >= tune.from ? lineKind(line, inBody) : lineKind(line, false);
  if (kind === "blank") return null;
  if (kind === "comment") return { token: "%", text: "A comment: ignored by the music." };
  if (kind === "directive") {
    const name = /^%%\s*(\S+)/.exec(line)?.[1] ?? "";
    const known: Record<string, string> = {
      score: "which voices share a system, and how they are bracketed",
      staves: "which voices share a system, and how they are bracketed",
      MIDI: "a playback instruction (instrument, chords, drums)",
      titlefont: "the title's font",
    };
    return {
      token: `%%${name}`,
      text: `A formatting directive${known[name] ? `: ${known[name]}` : ""}.`,
    };
  }
  if (kind === "field" || kind === "lyrics" || kind === "text") {
    const field = fieldOf(line);
    if (!field) return { token: "", text: "Free text between tunes." };
    const fieldValue = field.value.trim();
    const empty: Record<string, string> = {
      K: "Key: write it after K:, for example D or Am. The music starts on the next line.",
      M: "Meter: write it after M:, for example 4/4, 3/4 or 6/8.",
      L: "Unit note length: write it after L:, for example 1/8.",
      Q: "Tempo: write it after Q:, for example 1/4=120.",
    };
    if (!fieldValue && empty[field.key])
      return { token: `${field.key}:`, text: empty[field.key] as string };
    switch (field.key) {
      case "K": {
        const key = parseKey(fieldValue);
        return { token: "K:", text: `Key: ${describeKey(key)}. Also starts the music.` };
      }
      case "M":
        return { token: "M:", text: `Meter ${fieldValue}: ${describeMeter(fieldValue)}.` };
      case "L": {
        const unit = parseUnit(fieldValue);
        return {
          token: "L:",
          text: unit
            ? `Unit note length: a plain letter is ${lengthName(unit)}.`
            : "Unit note length.",
        };
      }
      case "Q": {
        const match = /(?:([0-9]+)\/([0-9]+)\s*=\s*)?([0-9]+)/.exec(fieldValue);
        if (match) {
          const beat = match[1]
            ? lengthName(frac(Number(match[1]), Number(match[2]))).replace(/^an? /, "")
            : "beat";
          return { token: "Q:", text: `Tempo: ${match[3]} ${beat}s a minute.` };
        }
        return { token: "Q:", text: "Tempo." };
      }
      case "V":
        return {
          token: "V:",
          text: `Voice ${fieldValue.split(/\s+/)[0]}: the music below belongs to this voice.`,
        };
      case "w":
        return {
          token: "w:",
          text: "Lyrics: one syllable per note. - splits a word, _ holds a note, * skips one, | moves to the next bar.",
        };
      default:
        return {
          token: `${field.key}:`,
          text: `${(FIELD_NAMES[field.key] ?? "information field").replace(/^./, (first) => first.toUpperCase())}.`,
        };
    }
  }
  if (!tune) return null;
  // Lengths as played: broken rhythm (f>g) and tuplets change what a note's letters say.
  const played = new Map<number, Fraction>();
  for (const item of tuneItems(text, tune, file))
    if (item.type === "event" && item.notes.length === 1) played.set(item.from, item.duration);
  let found: Explanation | null = null;
  let chordNotes: string[] = [];
  let chordMidi: number[] = [];
  let chordFrom = -1;
  // Decorations, chord symbols and annotations belong to the note after them: read the note first.
  let prefix: MusicToken[] = [];
  let pending: Explanation | null = null;
  walkTune(text, tune, file, (token: MusicToken, state) => {
    if (found || token.from > lineTo) return;
    if (token.kind === "chord-open") {
      chordNotes = [];
      chordMidi = [];
      chordFrom = token.from;
    }
    if (token.kind === "note" && token.inChord) {
      const described = describeNote(token, state);
      chordNotes.push(described.text.split(",")[0] as string);
      chordMidi.push(described.midi);
    }
    const attached =
      token.kind === "decoration" || token.kind === "chord-symbol" || token.kind === "annotation";
    const owner =
      (token.kind === "note" && !token.inChord && !token.inGrace) || token.kind === "rest";
    if (owner && prefix.length) {
      const start = (prefix[0] as MusicToken).from;
      if (pending || (position >= start && position <= token.to)) {
        found = explainToken(token, state, null, text, played, prefix.map(attachedPhrase));
        return;
      }
    }
    if (!attached && token.kind !== "space") {
      if (pending) {
        found = pending;
        return;
      }
      prefix = [];
    }
    const inside = position >= token.from && position < token.to;
    const atEnd = position === token.to && token.kind !== "space";
    if (attached) prefix.push(token);
    if (
      !inside &&
      !(atEnd && (token.kind === "note" || token.kind === "rest" || token.kind === "chord-close"))
    )
      return;
    if (token.kind === "space" && position !== token.from) return;
    const explanation = explainToken(
      token,
      state,
      chordFrom >= 0 ? { names: chordNotes, midi: chordMidi } : null,
      text,
      played,
    );
    if (attached) pending = explanation;
    else found = explanation;
    if (token.kind === "chord-close") chordFrom = -1;
  });
  return found ?? pending;
}

function explainToken(
  token: MusicToken,
  state: WalkState,
  chord: { names: string[]; midi: number[] } | null,
  text = "",
  played = new Map<number, Fraction>(),
  attached: string[] = [],
): Explanation | null {
  const extra = attached.length ? `, ${attached.join(", ")}` : "";
  switch (token.kind) {
    case "note": {
      const written = mul(parseLength(token.length), state.unit);
      const actual = token.inChord || token.inGrace ? undefined : played.get(token.from);
      let why: { duration: Fraction; why: string } | undefined;
      if (actual && value(actual) !== value(written)) {
        const before = text.slice(0, token.from).trimEnd().slice(-1);
        const broken = /[<>]/.test(text[token.to] ?? "") || /[<>]/.test(before);
        // A broken rhythm makes a dotted note and a short one; a tuplet keeps the name it is written with.
        why = broken
          ? { duration: actual, why: " (broken rhythm)" }
          : { duration: written, why: " in a tuplet" };
      }
      const described = describeNote(token, state, why);
      return {
        token: token.text,
        text: `${token.inGrace ? "Grace note " : ""}${described.text}${extra}.`,
        midi: [described.midi],
      };
    }
    case "rest": {
      if (token.letter === "Z" || token.letter === "X") {
        const bars = Number(token.length) || 1;
        return {
          token: token.text,
          text: `A rest of ${bars} whole ${bars === 1 ? "bar" : "bars"}${extra}.`,
        };
      }
      const duration = mul(parseLength(token.length), state.unit);
      return {
        token: token.text,
        text: `${token.letter === "x" ? "An invisible rest" : "A rest"}, ${lengthName(duration).replace(" note", "")}${extra}.`,
      };
    }
    case "chord-open":
    case "chord-close": {
      const length = token.kind === "chord-close" && token.length ? ` × ${token.length}` : "";
      return {
        token: token.text,
        text: `A chord: notes sounding together${chord?.names.length ? ` (${chord.names.join(", ")})` : ""}${length}.`,
        midi: chord?.midi,
      };
    }
    case "chord-symbol":
      return {
        token: token.text,
        text: `Chord symbol ${token.text.slice(1, -1)}: printed above, and played as accompaniment.`,
      };
    case "annotation": {
      const rules = passDynamics(token.text.slice(1, -1));
      return {
        token: token.text,
        text: rules
          ? `Dynamics by pass: ${describePassDynamics(rules)}. Playback follows; the score draws them as dynamics.`
          : "Annotation: text printed beside the note.",
      };
    }
    case "decoration": {
      if (token.text.length === 1)
        return { token: token.text, text: `${SHORTHAND[token.text] ?? "decoration"}.` };
      const name = token.text.slice(1, -1);
      return { token: token.text, text: `Decoration: ${DECORATIONS[name] ?? name}.` };
    }
    case "bar":
      return {
        token: token.text,
        text: `${barName(token.text)[0]?.toUpperCase()}${barName(token.text).slice(1)}.`,
      };
    case "slur":
      return {
        token: token.text,
        text:
          token.text === "("
            ? "Start of a slur: play the notes smoothly joined."
            : "End of a slur.",
      };
    case "tie":
      return { token: "-", text: "Tie: hold this note into the next one of the same pitch." };
    case "tuplet":
      return { token: token.text, text: `${tupletText(token.text)}.` };
    case "grace-open":
      return {
        token: token.text,
        text:
          token.text === "{/"
            ? "Acciaccatura: a crushed grace note."
            : "Grace notes: quick ornamental notes before the next note.",
      };
    case "grace-close":
      return { token: "}", text: "End of grace notes." };
    case "broken":
      return {
        token: token.text,
        text: token.text.startsWith(">")
          ? "Broken rhythm: the note before is dotted, the note after is shortened."
          : "Broken rhythm: the note before is shortened, the note after is dotted.",
      };
    case "inline-field": {
      const match = /^\[([A-Za-z]):(.*)\]$/.exec(token.text);
      if (!match) return null;
      if (match[1] === "K")
        return {
          token: token.text,
          text: `Key change: ${describeKey(parseKey(match[2] as string))}.`,
        };
      if (match[1] === "M")
        return { token: token.text, text: `Meter change: ${describeMeter(match[2] as string)}.` };
      if (match[1] === "L") return { token: token.text, text: "Unit length change." };
      if (match[1] === "V")
        return { token: token.text, text: `Switch to voice ${(match[2] as string).trim()}.` };
      if (match[1] === "Q") return { token: token.text, text: "Tempo change." };
      return { token: token.text, text: "Inline field." };
    }
    case "spacer":
      return { token: token.text, text: "Spacer: extra room on the staff, no time." };
    case "continuation":
      return { token: "\\", text: "Continues this line of music on the next text line." };
    case "comment":
      return { token: "%", text: "A comment: ignored by the music." };
    case "unknown":
      return { token: token.text, text: `“${token.text}” is not ABC music here.` };
    default:
      return null;
  }
}

export function meterOf(tune: TuneInfo): Fraction | null {
  return meterLength(tune.meter);
}

/** "mp (moderately soft)", "trill", "chord Am": what a mark before a note adds to it. */
function attachedPhrase(token: MusicToken): string {
  if (token.kind === "chord-symbol") return `chord ${token.text.slice(1, -1)}`;
  if (token.kind === "annotation") {
    const rules = passDynamics(token.text.slice(1, -1));
    return rules ? describePassDynamics(rules) : `“${token.text.slice(2, -1)}”`;
  }
  if (token.text.length === 1)
    return (SHORTHAND[token.text] ?? "decoration").split(":")[0] as string;
  const name = token.text.slice(1, -1);
  const meaning = DECORATIONS[name] ?? name;
  const dynamic = /^dynamic (\S+), (.+)$/.exec(meaning);
  return dynamic ? `${dynamic[1]} (${dynamic[2]})` : meaning;
}
