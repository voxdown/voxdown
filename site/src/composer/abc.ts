/**
 * Composer's own reading of ABC 2.1 text: a line tokenizer with exact offsets, keys, pitches and
 * lengths. It never rewrites a file; commands use it to make small, local text changes. abcjs
 * remains the authority for engraving and playback.
 */

export type Fraction = { num: number; den: number };

export type NoteToken = {
  kind: "note";
  from: number;
  to: number;
  text: string;
  accidental: string; // "", "^", "^^", "_", "__", "="
  letter: string; // A–G or a–g
  octave: string; // ' and , marks
  length: string; // as written: "", "2", "/", "3/2", "//"
  /** Offset where the length text begins. */
  lengthFrom: number;
  inChord: boolean;
  inGrace: boolean;
};
export type RestToken = {
  kind: "rest";
  from: number;
  to: number;
  text: string;
  letter: string; // z x Z X
  length: string;
  lengthFrom: number;
};
export type SimpleKind =
  | "bar"
  | "chord-open"
  | "chord-close"
  | "chord-symbol"
  | "annotation"
  | "decoration"
  | "slur"
  | "tie"
  | "tuplet"
  | "grace-open"
  | "grace-close"
  | "broken"
  | "inline-field"
  | "spacer"
  | "space"
  | "continuation"
  | "comment"
  | "unknown";
export type SimpleToken = {
  kind: SimpleKind;
  from: number;
  to: number;
  text: string;
  /** For a chord close, the chord's own length (after `]`). */
  length?: string;
  lengthFrom?: number;
};
export type MusicToken = NoteToken | RestToken | SimpleToken;

export type LineKind = "field" | "lyrics" | "directive" | "comment" | "music" | "text" | "blank";

/** A header-style line, `T:Title`, or `w:` lyrics. */
export function fieldOf(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z+]):(.*)$/.exec(line);
  if (!match) return null;
  return { key: match[1] as string, value: match[2] as string };
}

export function lineKind(line: string, inBody: boolean): LineKind {
  if (!line.trim()) return "blank";
  if (line.startsWith("%%")) return "directive";
  if (line.startsWith("%")) return "comment";
  const field = fieldOf(line);
  if (field) {
    if (field.key === "w") return inBody ? "lyrics" : "field";
    // A music line can start "e:|"; lower-case field names are only w, s, r and m.
    if (inBody && /^[a-z]$/.test(field.key) && !"srm".includes(field.key)) return "music";
    return "field";
  }
  return inBody ? "music" : "text";
}

const BAR =
  /^(?:\[\|:?|\|\]|:\|\]|\|[0-9]+(?:[,-][0-9]+)*|:*\|+:*[0-9]*|:{2,}|\[[0-9]+(?:[,-][0-9]+)*)/;
const LENGTH = /^(?:[0-9]*\/+[0-9]*|[0-9]+)/;

/** Tokens of one music line. `offset` is the line's position in the document. */
export function tokenizeMusic(line: string, offset = 0): MusicToken[] {
  const tokens: MusicToken[] = [];
  let i = 0;
  let inChord = false;
  let inGrace = false;
  const push = (kind: SimpleKind, length: number) => {
    tokens.push({
      kind,
      from: offset + i,
      to: offset + i + length,
      text: line.slice(i, i + length),
    });
    i += length;
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const char = line[i] as string;
    if (char === "%") {
      push("comment", line.length - i);
      break;
    }
    if (/\s/.test(char)) {
      const match = /^\s+/.exec(rest) as RegExpExecArray;
      push("space", match[0].length);
      continue;
    }
    if (char === "\\" && !rest.slice(1).trim()) {
      push("continuation", 1);
      continue;
    }
    if (char === '"') {
      const end = line.indexOf('"', i + 1);
      const length = end < 0 ? line.length - i : end - i + 1;
      const body = line.slice(i + 1, i + length - 1);
      push(/^[\^_<>@]/.test(body) ? "annotation" : "chord-symbol", length);
      continue;
    }
    if (char === "!" || char === "+") {
      const end = line.indexOf(char, i + 1);
      if (end > i + 1 && !/\s/.test(line.slice(i + 1, end)) && end - i < 40) {
        push("decoration", end - i + 1);
        continue;
      }
      if (char === "!") {
        push("unknown", 1);
        continue;
      }
    }
    if (char === "[" && /^\[[A-Za-z]:[^\]]*\]/.test(rest)) {
      // An inline field, [K:G]; a chord cannot contain a colon.
      push("inline-field", line.indexOf("]", i) - i + 1);
      continue;
    }
    const bar = BAR.exec(rest);
    if (bar && !(char === "[" && /^\[[A-Ga-gz^_=]/.test(rest) && !/^\[\|/.test(rest))) {
      push("bar", bar[0].length);
      continue;
    }
    if (char === "[") {
      inChord = true;
      push("chord-open", 1);
      continue;
    }
    if (char === "]") {
      inChord = false;
      const length = (LENGTH.exec(line.slice(i + 1)) ?? [""])[0];
      tokens.push({
        kind: "chord-close",
        from: offset + i,
        to: offset + i + 1 + length.length,
        text: line.slice(i, i + 1 + length.length),
        length,
        lengthFrom: offset + i + 1,
      });
      i += 1 + length.length;
      continue;
    }
    if (char === "{") {
      inGrace = true;
      const slash = line[i + 1] === "/" ? 2 : 1;
      push("grace-open", slash);
      continue;
    }
    if (char === "}") {
      inGrace = false;
      push("grace-close", 1);
      continue;
    }
    if (char === "(") {
      const tuplet = /^\([2-9](?::[0-9]*)?(?::[0-9]*)?/.exec(rest);
      if (tuplet) {
        push("tuplet", tuplet[0].length);
        continue;
      }
      push("slur", 1);
      continue;
    }
    if (char === ")") {
      push("slur", 1);
      continue;
    }
    if (char === "-") {
      push("tie", 1);
      continue;
    }
    if (char === ">" || char === "<") {
      const match = /^(?:>+|<+)/.exec(rest) as RegExpExecArray;
      push("broken", match[0].length);
      continue;
    }
    if (char === "y") {
      const length = (LENGTH.exec(line.slice(i + 1)) ?? [""])[0];
      push("spacer", 1 + length.length);
      continue;
    }
    const note = /^(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)/.exec(rest);
    if (note) {
      const head = note[0].length;
      const length = (LENGTH.exec(line.slice(i + head)) ?? [""])[0];
      tokens.push({
        kind: "note",
        from: offset + i,
        to: offset + i + head + length.length,
        text: line.slice(i, i + head + length.length),
        accidental: note[1] ?? "",
        letter: note[2] as string,
        octave: note[3] ?? "",
        length,
        lengthFrom: offset + i + head,
        inChord,
        inGrace,
      });
      i += head + length.length;
      continue;
    }
    if (/[zxZX]/.test(char)) {
      const length = (LENGTH.exec(line.slice(i + 1)) ?? [""])[0];
      tokens.push({
        kind: "rest",
        from: offset + i,
        to: offset + i + 1 + length.length,
        text: line.slice(i, i + 1 + length.length),
        letter: char,
        length,
        lengthFrom: offset + i + 1,
      });
      i += 1 + length.length;
      continue;
    }
    if (/[.~HLMOPSTuv]/.test(char)) {
      push("decoration", 1);
      continue;
    }
    if (char === "&" || char === "`" || char === "$" || char === "*") {
      push("space", 1);
      continue;
    }
    push("unknown", 1);
  }
  return tokens;
}

/* Lengths. */

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}
export function frac(num: number, den = 1): Fraction {
  const sign = den < 0 ? -1 : 1;
  const divisor = gcd(num, den);
  return { num: (sign * num) / divisor, den: (sign * den) / divisor };
}
export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.num, a.den * b.den);
}
export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}
export function value(a: Fraction): number {
  return a.num / a.den;
}

/** The multiplier a length suffix means: "" 1, "2" 2, "/" ½, "//" ¼, "3/2" 1½, "/4" ¼. */
export function parseLength(text: string): Fraction {
  if (!text) return frac(1);
  const slash = text.indexOf("/");
  if (slash < 0) return frac(Number(text) || 1);
  const numText = text.slice(0, slash);
  const after = text.slice(slash);
  const slashes = (/^\/+/.exec(after) as RegExpExecArray)[0].length;
  const denText = after.slice(slashes);
  const num = numText ? Number(numText) : 1;
  const den = denText ? Number(denText) * 2 ** (slashes - 1) : 2 ** slashes;
  return frac(num || 1, den || 1);
}

/** Writes a multiplier the way people write ABC: 1 "", 2 "2", ½ "/", ¼ "/4", 3/2 "3/2". */
export function formatLength(length: Fraction): string {
  const { num, den } = frac(length.num, length.den);
  if (den === 1) return num === 1 ? "" : String(num);
  if (num === 1) return den === 2 ? "/" : `/${den}`;
  return `${num}/${den}`;
}

/** A meter's bar length in whole notes, or null for free meter. */
export function meterLength(meter: string): Fraction | null {
  const text = meter.trim().replace(/\s*%.*$/, "");
  if (!text || /^none$/i.test(text)) return null;
  if (text === "C") return frac(1);
  if (text === "C|") return frac(1, 2);
  const match = /^\(?([0-9+\s]+)\)?\s*\/\s*([0-9]+)/.exec(text);
  if (!match) return null;
  const top = (match[1] as string)
    .split("+")
    .reduce((sum, part) => sum + (Number(part.trim()) || 0), 0);
  const bottom = Number(match[2]);
  return top && bottom ? frac(top, bottom) : null;
}

/** The default unit length when L: is absent (ABC 2.1 §3.1.7). */
export function defaultUnit(meter: string): Fraction {
  const length = meterLength(meter);
  if (!length) return frac(1, 8);
  return value(length) < 0.75 ? frac(1, 16) : frac(1, 8);
}

export function parseUnit(text: string): Fraction | null {
  const match = /^\s*([0-9]+)\s*\/\s*([0-9]+)/.exec(text);
  if (!match) return /^\s*1\s*$/.test(text) ? frac(1) : null;
  const num = Number(match[1]);
  const den = Number(match[2]);
  return num && den ? frac(num, den) : null;
}

/* Keys and pitch. */

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const MAJOR_FIFTHS: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  "C#": 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
};
const MODE_SHIFT: Record<string, number> = {
  maj: 0,
  ion: 0,
  min: -3,
  m: -3,
  aeo: -3,
  mix: -1,
  dor: -2,
  phr: -4,
  lyd: 1,
  loc: -5,
};
const MODE_NAME: Record<string, string> = {
  maj: "major",
  ion: "Ionian",
  min: "minor",
  m: "minor",
  aeo: "Aeolian",
  mix: "Mixolydian",
  dor: "Dorian",
  phr: "Phrygian",
  lyd: "Lydian",
  loc: "Locrian",
};

export type Key = {
  /** Accidental per letter (upper case), in semitones: −1 flat, +1 sharp. */
  accidentals: Record<string, number>;
  fifths: number;
  tonic: string;
  mode: string;
  /** Read aloud: "D major", "E minor", "A Dorian". */
  name: string;
  /** Spell new notes with flats. */
  flats: boolean;
};

export function parseKey(value: string): Key {
  const text = value.replace(/%.*$/, "").trim();
  const accidentals: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const match = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(text);
  let fifths = 0;
  let tonic = "C";
  let mode = "maj";
  let rest = text;
  if (/^(none|HP|Hp)\b/.test(text)) {
    rest = text.replace(/^(none|HP|Hp)/, "");
    tonic = "";
    mode = "";
  } else if (match) {
    tonic = `${match[1]}${match[2]}`;
    const word = (match[3] ?? "").toLowerCase();
    const modeKey = word === "m" ? "m" : word.slice(0, 3);
    if (
      word &&
      !(modeKey in MODE_SHIFT) &&
      !/^(clef|middle|transpose|octave|stafflines|exp)/.test(word)
    )
      mode = "maj";
    else if (modeKey in MODE_SHIFT) mode = modeKey;
    const major = MAJOR_FIFTHS[tonic];
    fifths = (major ?? 0) + (MODE_SHIFT[mode] ?? 0);
    rest = text.slice(match[0].length);
  }
  const explicit = rest.match(/(?:^|\s)(\^\^|\^|__|_|=)([A-Ga-g])/g) ?? [];
  const exp = /\bexp\b/.test(rest);
  if (!exp) {
    if (fifths > 0) for (const letter of SHARP_ORDER.slice(0, fifths)) accidentals[letter] = 1;
    if (fifths < 0)
      for (const letter of [...SHARP_ORDER].reverse().slice(0, -fifths)) accidentals[letter] = -1;
  }
  for (const item of explicit) {
    const parts = /(\^\^|\^|__|_|=)([A-Ga-g])/.exec(item) as RegExpExecArray;
    accidentals[(parts[2] as string).toUpperCase()] = accidentalValue(parts[1] as string);
  }
  const tonicName = tonic.replace("#", "♯").replace("b", "♭");
  const name = tonic ? `${tonicName} ${MODE_NAME[mode] ?? "major"}` : "no key signature";
  return { accidentals, fifths, tonic, mode, name, flats: fifths < 0 };
}

export function accidentalValue(text: string): number {
  return text === "^" ? 1 : text === "^^" ? 2 : text === "_" ? -1 : text === "__" ? -2 : 0;
}
export function accidentalText(semitones: number): string {
  return semitones === 1
    ? "^"
    : semitones === 2
      ? "^^"
      : semitones === -1
        ? "_"
        : semitones === -2
          ? "__"
          : "=";
}

/** Octave number (scientific: middle C is C4) of a written letter and its marks. */
export function octaveOf(letter: string, marks: string): number {
  let octave = letter === letter.toLowerCase() ? 5 : 4;
  for (const mark of marks) octave += mark === "'" ? 1 : -1;
  return octave;
}

/** The staff position used for bar accidentals: letter plus octave. */
export function staffPlace(letter: string, marks: string): string {
  return `${letter.toUpperCase()}${octaveOf(letter, marks)}`;
}

/** MIDI number for letter, octave and an alteration in semitones. */
export function midiOf(letter: string, octave: number, alter: number): number {
  return (octave + 1) * 12 + (LETTER_SEMITONE[letter.toUpperCase()] as number) + alter;
}

/** The sounding alteration of a note: its own accidental, the bar's, or the key's. */
export function alterationOf(
  note: Pick<NoteToken, "accidental" | "letter" | "octave">,
  key: Key,
  bar: Map<string, number>,
): { alter: number; source: "written" | "bar" | "key" | "none" } {
  if (note.accidental) return { alter: accidentalValue(note.accidental), source: "written" };
  const place = staffPlace(note.letter, note.octave);
  const carried = bar.get(place);
  if (carried !== undefined) return { alter: carried, source: "bar" };
  const fromKey = key.accidentals[note.letter.toUpperCase()] ?? 0;
  return { alter: fromKey, source: fromKey ? "key" : "none" };
}

export function noteMidi(
  note: Pick<NoteToken, "accidental" | "letter" | "octave">,
  key: Key,
  bar: Map<string, number>,
): number {
  return midiOf(
    note.letter,
    octaveOf(note.letter, note.octave),
    alterationOf(note, key, bar).alter,
  );
}

const SIGN: Record<number, string> = { [-2]: "𝄫", [-1]: "♭", 0: "", 1: "♯", 2: "𝄪" };
export function pitchName(letter: string, alter: number, octave?: number): string {
  return `${letter.toUpperCase()}${SIGN[alter] ?? ""}${octave === undefined ? "" : octave}`;
}

/** Writes a letter and octave back as ABC: C4 "C", C5 "c", C6 "c'", C3 "C,". */
export function writePitch(letter: string, octave: number): string {
  const upper = letter.toUpperCase();
  if (octave >= 5) return `${upper.toLowerCase()}${"'".repeat(octave - 5)}`;
  return `${upper}${",".repeat(4 - octave)}`;
}

/** Spellings of a pitch class, for transposition: [letter, alteration]. */
export function spellings(midi: number): [string, number][] {
  const pc = ((midi % 12) + 12) % 12;
  const out: [string, number][] = [];
  for (const letter of LETTERS) {
    const base = LETTER_SEMITONE[letter] as number;
    for (const alter of [0, 1, -1, 2, -2]) {
      if ((((base + alter) % 12) + 12) % 12 === pc) out.push([letter, alter]);
    }
  }
  return out;
}

/** Chooses how to spell a pitch in a key: its own scale note first, then a natural, then by key. */
export function spell(
  midi: number,
  key: Key,
  preferFlats = key.flats,
): { letter: string; alter: number; octave: number } {
  const options = spellings(midi);
  const choice =
    options.find(([letter, alter]) => (key.accidentals[letter] ?? 0) === alter) ??
    options.find(([, alter]) => alter === 0) ??
    options.find(([, alter]) => (preferFlats ? alter === -1 : alter === 1)) ??
    options.find(([, alter]) => Math.abs(alter) === 1) ??
    (options[0] as [string, number]);
  const [letter, alter] = choice;
  // B♯ and C♭ cross the octave boundary.
  const octave = Math.floor((midi - alter - (LETTER_SEMITONE[letter] as number)) / 12) - 1;
  return { letter, alter, octave };
}

/** Transposes a chord symbol's root and bass ("Am7", "D/F#", "Bbmaj7"). */
export function transposeChordSymbol(symbol: string, semitones: number, key: Key): string {
  const one = (text: string) =>
    text.replace(/^([A-G])([#b♯♭]?)/, (_match, letter: string, sign: string) => {
      const alter = sign === "#" || sign === "♯" ? 1 : sign === "b" || sign === "♭" ? -1 : 0;
      const midi = midiOf(letter, 4, alter) + semitones;
      const spelled = spell(midi, key, key.flats || (semitones < 0 && key.fifths === 0 && false));
      const out =
        spelled.alter === 1
          ? "#"
          : spelled.alter === -1
            ? "b"
            : spelled.alter === 2
              ? "##"
              : spelled.alter === -2
                ? "bb"
                : "";
      return `${spelled.letter}${out}`;
    });
  const slash = symbol.indexOf("/");
  if (slash > 0) return `${one(symbol.slice(0, slash))}/${one(symbol.slice(slash + 1))}`;
  return one(symbol);
}
