/**
 * Typing helpers, both opt-in: a bar line when Space is typed after a full bar, and a typed note
 * letter taking the octave nearest the note before it. Both act only in music, never in headers,
 * lyrics, comments, chord symbols, decorations or inline fields.
 */
import { add, frac, lineKind, meterLength, octaveOf, value, writePitch } from "./abc";
import type { FileIndex, TuneInfo } from "./tunes";
import { type MusicEvent, tuneItems, walkTune } from "./walk";

/** The tune whose music the position is in, when it is in music proper. */
export function musicAt(text: string, position: number, file: FileIndex): TuneInfo | null {
  const tune = file.tunes.find((each) => position >= each.bodyFrom && position <= each.to);
  if (!tune) return null;
  const lineFrom = text.lastIndexOf("\n", position - 1) + 1;
  const lineEnd = text.indexOf("\n", position) < 0 ? text.length : text.indexOf("\n", position);
  if (lineKind(text.slice(lineFrom, lineEnd), true) !== "music") return null;
  const before = text.slice(lineFrom, position);
  // Inside a comment, a chord symbol or annotation, a !decoration!, an inline field or chord.
  if (before.includes("%")) return null;
  if ((before.match(/"/g) ?? []).length % 2) return null;
  if ((before.match(/!/g) ?? []).length % 2) return null;
  if ((before.match(/\+/g) ?? []).length % 2) return null;
  const field = before.lastIndexOf("[");
  if (field > before.lastIndexOf("]") && /^\[[A-Za-z]:/.test(before.slice(field))) return null;
  return tune;
}

/** The voice in force at a position: from the V: lines and inline [V:] fields before it. */
function voiceAt(text: string, tune: TuneInfo, file: FileIndex, position: number): string {
  let voice = tune.voices[0]?.id ?? "1";
  const lineFrom = text.lastIndexOf("\n", position - 1) + 1;
  walkTune(
    text,
    tune,
    file,
    (token, state) => {
      if (token.from >= lineFrom && token.from < position) voice = state.voice;
    },
    (from, _to, _kind, state) => {
      if (from <= lineFrom) voice = state.voice;
    },
  );
  return voice;
}

/**
 * Whether Space at the caret ends a full bar: the caret is right after a note, chord or rest (or
 * a tie or slur end on it), nothing follows on its line, and the notes since the voice's last bar
 * line fill the meter exactly (L:, tuplets, broken rhythm and inline M:/L: counted).
 */
export function barIsFull(text: string, position: number, file: FileIndex): boolean {
  const tune = musicAt(text, position, file);
  if (!tune) return false;
  const lineEnd = text.indexOf("\n", position) < 0 ? text.length : text.indexOf("\n", position);
  if (text.slice(position, lineEnd).trim()) return false;
  const voice = voiceAt(text, tune, file, position);
  const items = tuneItems(text, tune, file).filter(
    (item) => item.voice === voice && item.to <= position,
  );
  const last = items[items.length - 1];
  if (!last || last.type !== "event") return false;
  if (!/^[-)]*$/.test(text.slice(last.to, position))) return false;
  let filled = frac(0);
  let meter = last.meter;
  for (let at = items.length - 1; at >= 0; at--) {
    const item = items[at] as (typeof items)[number];
    if (item.type === "bar") break;
    if (item.bars) return false;
    filled = add(filled, item.duration);
    meter = item.meter;
  }
  const expected = meterLength(meter);
  return Boolean(expected) && Math.abs(value(filled) - value(expected as never)) < 1e-9;
}

const STEPS = "CDEFGAB";
/** Staff steps from C0, by letter and octave. */
const stepOf = (letter: string, octave: number) => STEPS.indexOf(letter.toUpperCase()) + 7 * octave;

/**
 * The pitch a typed note letter is written as: the octave nearest the previous note in the same
 * voice (by staff steps). A capital letter (Shift) takes the other side instead: the nearest
 * octave above when the nearest was below, and below when it was above. Null when there is no
 * note before in the voice, or the caret is not in music.
 */
export function nearestOctave(
  text: string,
  position: number,
  typed: string,
  file: FileIndex,
): string | null {
  if (!/^[A-Ga-g]$/.test(typed)) return null;
  const tune = musicAt(text, position, file);
  if (!tune) return null;
  const voice = voiceAt(text, tune, file, position);
  let previous: number | null = null;
  let inGrace = false;
  walkTune(text, tune, file, (token, state) => {
    if (token.from >= position) return;
    if (token.kind === "grace-open") inGrace = true;
    else if (token.kind === "grace-close") inGrace = false;
    else if (token.kind === "note" && !inGrace && state.voice === voice)
      previous = stepOf(token.letter, octaveOf(token.letter, token.octave));
  });
  if (previous === null) return null;
  const from = previous as number;
  const letter = STEPS.indexOf(typed.toUpperCase());
  // The candidates around the previous note: one below (or level) and one above.
  const below = from - ((from - letter + 70) % 7);
  const above = below === from ? from : below + 7;
  const nearest = from - below <= above - from ? below : above;
  const other = nearest === below ? (below === from ? from + 7 : above) : below;
  const step = typed === typed.toUpperCase() ? other : nearest;
  return writePitch(typed, Math.floor(step / 7));
}

export type { MusicEvent };
