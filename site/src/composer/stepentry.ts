/**
 * Step entry from a MIDI keyboard: what to write at the caret for the notes played. Pitches are
 * spelled for the key (and the accidentals already in the bar); a voice with an octave clef or
 * transpose= is written where abcjs draws it, so it sounds as played; a chord is [...]; the
 * length is the one chosen, in the tune's unit.
 */
import {
  type Fraction,
  type Key,
  accidentalText,
  accidentalValue,
  add,
  defaultUnit,
  formatLength,
  frac,
  meterLength,
  mul,
  parseKey,
  parseUnit,
  spell,
  staffPlace,
  value,
  writePitch,
} from "./abc";
import { barAt } from "./barcheck";
import { type FileIndex, tuneAt } from "./tunes";
import { tuneItems, walkTune } from "./walk";

export type StepReading = {
  key: Key;
  /** Accidentals written earlier in the bar, by staff place ("F4"). */
  bar: Map<string, number>;
  unit: Fraction;
  meter: string;
  voice: string;
  /** Semitones abcjs adds when it plays this voice (treble-8: −12). */
  shift: number;
};

/** The voice's octave clef, or else its transpose=, as semitones abcjs adds when playing. */
function shiftOf(definition: string): number {
  const clef = /\bclef=(\S+)/.exec(definition)?.[1] ?? "";
  const octave = /([-+])8$/.exec(clef);
  if (octave) return octave[1] === "-" ? -12 : 12;
  return Number(/\btranspose=(-?\d+)/.exec(definition)?.[1] ?? 0);
}

/** The key, unit, meter, bar accidentals and voice at a place in a tune's music. */
export function readingAt(text: string, file: FileIndex, position: number): StepReading | null {
  const tune = tuneAt(file, position);
  if (!tune || tune.bodyFrom < 0 || position < tune.bodyFrom) return null;
  let reading: StepReading | null = null;
  const take = (state: {
    key: Key;
    unit: Fraction;
    meter: string;
    voice: string;
    bar: Map<string, number>;
  }) => {
    reading = {
      key: state.key,
      unit: state.unit,
      meter: state.meter,
      voice: state.voice,
      bar: new Map(state.bar),
      shift: 0,
    };
  };
  walkTune(
    text,
    tune,
    file,
    (token, state) => {
      if (token.from >= position) return;
      take(state);
      const read = reading as StepReading | null;
      if (!read) return;
      if (token.kind === "note" && token.accidental && !token.inGrace)
        read.bar.set(staffPlace(token.letter, token.octave), accidentalValue(token.accidental));
      if (token.kind === "bar") read.bar = new Map();
    },
    (from, _to, kind, state) => {
      // A line before the caret with no music yet (the first one, or after V:) still says
      // which voice, key and unit are in force.
      if (from <= position && (kind === "music" || kind === "field")) take(state);
    },
  );
  const found: StepReading = (reading as StepReading | null) ?? {
    key: parseKey(tune.key || "C"),
    bar: new Map(),
    unit: parseUnit(tune.unit) ?? defaultUnit(tune.meter),
    meter: tune.meter,
    voice: tune.voices[0]?.id ?? "1",
    shift: 0,
  };
  // The voice's definition: V: in the header or body, else the K: line (a clef there).
  const voiceLine = [...text.slice(tune.from, tune.to).matchAll(/^V:\s*(\S+)(.*)$/gm)].find(
    (match) => match[1] === found.voice && /clef=|transpose=/.test(match[2] ?? ""),
  );
  const keyLine = /^K:(.*)$/m.exec(text.slice(tune.from, tune.bodyFrom))?.[1] ?? "";
  found.shift = shiftOf(voiceLine?.[2] ?? keyLine);
  return found;
}

/** A played pitch spelled for the key: C major spells E♭ and B♭, F♯, C♯ and G♯. */
export function spellFor(
  pitch: number,
  key: Key,
): { letter: string; alter: number; octave: number } {
  const pc = ((pitch % 12) + 12) % 12;
  const flats = key.fifths === 0 ? pc === 3 || pc === 10 : key.flats;
  return spell(pitch, key, flats);
}

/** One pitch as ABC at this point, accidental only where the key and bar don't give it. */
export function pitchText(pitch: number, reading: StepReading): string {
  const written = pitch - reading.shift;
  const spelled = spellFor(written, reading.key);
  const place = `${spelled.letter}${spelled.octave}`;
  const implied = reading.bar.get(place) ?? reading.key.accidentals[spelled.letter] ?? 0;
  let accidental = "";
  if (spelled.alter !== implied) {
    accidental = accidentalText(spelled.alter);
    reading.bar.set(place, spelled.alter);
  }
  return `${accidental}${writePitch(spelled.letter, spelled.octave)}`;
}

/** A length (whole notes) in the tune's unit: "2", "/", "3/2". */
export const lengthText = (length: Fraction, unit: Fraction) =>
  formatLength(mul(length, frac(unit.den, unit.num)));

/** What a step writes: a note, a chord ([...]) or a rest, with its length. */
export function stepText(
  pitches: number[] | "rest",
  length: Fraction,
  reading: StepReading,
): string {
  const suffix = lengthText(length, reading.unit);
  if (pitches === "rest" || !pitches.length) return `z${suffix}`;
  const notes = [...pitches].sort((a, b) => a - b).map((pitch) => pitchText(pitch, reading));
  return notes.length > 1 ? `[${notes.join("")}]${suffix}` : `${notes[0]}${suffix}`;
}

/** The beat of a meter in whole notes: a dotted note in compound time. */
export function beatOf(meter: string): number {
  const text = meter.trim();
  if (text === "C|") return 0.5;
  const match = /^(\d+)(?:\+\d+)*\s*\/\s*(\d+)/.exec(text);
  if (!match) return 0.25;
  const num = Number(match[1]);
  const den = Number(match[2]) || 4;
  return (num > 3 && num % 3 === 0 ? 3 : 1) / den;
}

/** The lengths step entry offers (keys 1–6), shortest first. */
export const STEP_LENGTHS: { key: string; name: string; length: Fraction }[] = [
  { key: "1", name: "32nd", length: frac(1, 32) },
  { key: "2", name: "16th", length: frac(1, 16) },
  { key: "3", name: "8th", length: frac(1, 8) },
  { key: "4", name: "Quarter", length: frac(1, 4) },
  { key: "5", name: "Half", length: frac(1, 2) },
  { key: "6", name: "Whole", length: frac(1) },
];

const sub = (a: Fraction, b: Fraction) => add(a, frac(-b.num, b.den));
/** Note values a step can be written as (in whole notes): plain or dotted, a whole down to a 64th. */
export const VALUES = [
  1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125, 0.09375, 0.0625, 0.046875, 0.03125, 0.015625,
];
/** A length as note values, largest first: 5/8 is a half tied to an eighth. */
export function noteValues(length: Fraction): Fraction[] {
  const pieces: Fraction[] = [];
  let left = length;
  while (value(left) > 1e-9) {
    const fits = VALUES.find((each) => each <= value(left) + 1e-9);
    if (!fits) {
      pieces.push(left);
      break;
    }
    const piece = frac(Math.round(fits * 256), 256);
    pieces.push(piece);
    left = sub(left, piece);
  }
  return pieces;
}

/**
 * What step entry writes at a place: the note, chord or rest, with a space before it unless it
 * joins a note shorter than a beat inside the same beat (so they beam). When the caret ends its
 * line, the bar is counted as the bar check counts it: a step that fills the bar is followed by a
 * bar line, and one that overflows it is split at the bar line and tied (a rest is split without a
 * tie), the count starting again in the new bar, where accidentals are written afresh. Null when
 * the place isn't in a tune's music.
 */
export function stepInsert(
  text: string,
  file: FileIndex,
  at: number,
  pitches: number[] | "rest",
  length: Fraction,
): { insert: string; written: string; bars: number } | null {
  const reading = readingAt(text, file, at);
  const tune = tuneAt(file, at);
  if (!reading || !tune) return null;
  const lineEnd = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
  const atLineEnd = !text.slice(at, lineEnd).trim();
  // Right after a bar line the new bar is empty (the bar check still counts the closed one).
  const afterBarLine = /[|:]\]?\s*$/.test(text.slice(tune.bodyFrom, at));
  const bar = afterBarLine ? null : barAt(tuneItems(text, tune, file), at);
  const filled = bar?.filled ?? frac(0);
  const expected = atLineEnd ? meterLength(reading.meter) : null;
  const beat = beatOf(reading.meter);
  // A space first, unless this joins a short note in the middle of a beat.
  const before = at === 0 ? "\n" : (text[at - 1] as string);
  let gap = /\s/.test(before) ? "" : " ";
  if (gap && /[A-Ga-gz,'\d/\]]/.test(before) && value(length) < beat) {
    const onBeat = Math.abs(value(filled) / beat - Math.round(value(filled) / beat)) < 1e-6;
    if (!onBeat) gap = "";
  }
  if (!expected) {
    const written = stepText(pitches, length, reading);
    return { insert: `${gap}${written}`, written, bars: 0 };
  }
  let room = sub(expected, filled);
  let out = gap;
  let bars = 0;
  const newBar = () => {
    out += out && !/\s$/.test(out) ? " |" : "|";
    room = expected;
    reading.bar = new Map();
    bars += 1;
  };
  // A bar already full (or over) gets its bar line first.
  if (value(room) <= 1e-9 && value(filled) > 0) {
    newBar();
    out += " ";
  }
  const rest = pitches === "rest" || !pitches.length;
  const parts: string[] = [];
  let left = length;
  while (value(left) > 1e-9) {
    const take = value(left) <= value(room) + 1e-9 ? left : room;
    const pieces = noteValues(take);
    pieces.forEach((piece, index) => {
      const last = index === pieces.length - 1 && value(sub(left, take)) <= 1e-9;
      const written = stepText(pitches, piece, reading);
      parts.push(written);
      out += `${index > 0 ? " " : ""}${written}${!rest && !last ? "-" : ""}`;
    });
    left = sub(left, take);
    room = sub(room, take);
    if (value(room) <= 1e-9) {
      newBar();
      if (value(left) > 1e-9) out += " ";
    }
  }
  return { insert: out, written: parts.join(" "), bars };
}
