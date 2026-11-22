/**
 * Typing helpers, both opt-in: a bar line when Space is typed after a full bar, and a typed note
 * letter taking the octave nearest the note before it. Both act only in music, never in headers,
 * lyrics, comments, chord symbols, decorations or inline fields.
 *
 * They run on every key, so they read back only from the caret: to the voice's previous note,
 * or to the start of the bar, never the whole tune.
 */
import {
  type MusicToken,
  add,
  frac,
  lineKind,
  meterLength,
  octaveOf,
  tokenizeMusic,
  value,
  writePitch,
} from "./abc";
import { type FileIndex, type TuneInfo, indexFile } from "./tunes";
import { tuneItems } from "./walk";

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

/** Where each voice starts in a tune's body: V: lines and lines that begin with [V:]. */
function voiceMarks(text: string, tune: TuneInfo): { at: number; id: string }[] {
  const body = text.slice(tune.bodyFrom, tune.to);
  const marks: { at: number; id: string }[] = [];
  for (const match of body.matchAll(/^(?:V:[ \t]*(\S+)|\[V:[ \t]*([^\]\s]+))/gm))
    marks.push({ at: tune.bodyFrom + (match.index ?? 0), id: (match[1] ?? match[2]) as string });
  return marks;
}

/** The voice of the line a position is on. */
function voiceOf(marks: { at: number; id: string }[], tune: TuneInfo, lineFrom: number): string {
  let voice = tune.voices[0]?.id ?? "1";
  for (const mark of marks) {
    if (mark.at > lineFrom) break;
    voice = mark.id;
  }
  return voice;
}

/**
 * The lines of the caret's voice, from the caret's line back towards the body's start, each
 * cut at the caret; music lines only.
 */
function* linesBack(
  text: string,
  tune: TuneInfo,
  position: number,
): Generator<{ from: number; text: string }> {
  const marks = voiceMarks(text, tune);
  let lineFrom = text.lastIndexOf("\n", position - 1) + 1;
  const voice = voiceOf(marks, tune, lineFrom);
  let lineEnd = position;
  while (lineFrom >= tune.bodyFrom) {
    const line = text.slice(lineFrom, lineEnd);
    if (lineKind(line, true) === "music" && voiceOf(marks, tune, lineFrom) === voice)
      yield { from: lineFrom, text: line };
    if (lineFrom === 0) break;
    lineEnd = lineFrom - 1;
    lineFrom = text.lastIndexOf("\n", lineEnd - 1) + 1;
  }
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
  // The bar so far: back through the voice's lines to its last bar line.
  const parts: string[] = [];
  let barFrom = tune.bodyFrom;
  for (const line of linesBack(text, tune, position)) {
    const bars = tokenizeMusic(line.text, line.from).filter((token) => token.kind === "bar");
    const last = bars[bars.length - 1];
    if (last) {
      parts.unshift(text.slice(last.to, line.from + line.text.length));
      barFrom = last.to;
      break;
    }
    parts.unshift(line.text);
    barFrom = line.from;
  }
  // The meter and unit in force there: the header, then the body's M:/L: before the bar.
  const before = text.slice(tune.bodyFrom, barFrom);
  const fields: string[] = [];
  for (const key of ["M", "L"]) {
    const changes = [
      ...before.matchAll(new RegExp(`(?:^${key}:([^\\n%]*)|\\[${key}:([^\\]]*)\\])`, "gm")),
    ];
    const last = changes[changes.length - 1];
    if (last) fields.push(`${key}:${(last[1] ?? last[2] ?? "").trim()}`);
  }
  const header = text.slice(tune.from, tune.bodyFrom).replace(/\n*$/, "\n");
  const bar = parts.join("\n");
  const snippet = `${header}${fields.map((field) => `${field}\n`).join("")}${bar}`;
  const small = indexFile(snippet);
  const smallTune = small.tunes[0];
  if (!smallTune) return false;
  const items = tuneItems(snippet, smallTune, small);
  const last = items[items.length - 1];
  if (!last || last.type !== "event") return false;
  if (!/^[-)]*$/.test(snippet.slice(last.to))) return false;
  let filled = frac(0);
  for (const item of items) {
    if (item.type === "bar") filled = frac(0);
    else if (item.bars) return false;
    else filled = add(filled, item.duration);
  }
  const expected = meterLength(last.meter);
  return Boolean(expected) && Math.abs(value(filled) - value(expected as never)) < 1e-9;
}

const STEPS = "CDEFGAB";
/** Staff steps from C0, by letter and octave; middle C is 28. */
const stepOf = (letter: string, octave: number) => STEPS.indexOf(letter.toUpperCase()) + 7 * octave;
const MIDDLE_C = 28;
/** A sensible written range per clef: treble G, to c''', bass C,, to e'. */
const RANGES = {
  // c is C5 in ABC, so c''' is C8.
  treble: [stepOf("G", 3), stepOf("C", 8)],
  bass: [stepOf("C", 2), stepOf("E", 6)],
} as const;

/** The clef of a voice, from its V: line or the K: line (bass or F clef; else treble). */
function clefOf(text: string, tune: TuneInfo, voice: string): "treble" | "bass" {
  const tuneText = text.slice(tune.from, tune.to);
  const escaped = voice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = [
    ...tuneText.matchAll(new RegExp(`^V:[ \\t]*${escaped}(?=\\s|$).*$`, "gm")),
    ...tuneText.matchAll(/^K:.*$/gm),
  ].map((match) => match[0]);
  return lines.some((line) => /\bclef\s*=\s*(bass|F)\b|\bbass\b/i.test(line)) ? "bass" : "treble";
}

/**
 * The pitch a typed note letter is written as, whatever its case: the octave nearest the
 * previous note in the same voice by staff steps (the same letter gives the same octave; a tie
 * would go towards middle C), kept within the clef's range (when the nearest would leave it, the
 * other side). A ' or , typed after the note then moves it, the ABC way. Null when there is no
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
  let from: number | null = null;
  for (const line of linesBack(text, tune, position)) {
    const notes = tokenizeMusic(line.text, line.from).filter(
      (token): token is Extract<MusicToken, { kind: "note" }> =>
        token.kind === "note" && !token.inGrace,
    );
    const last = notes[notes.length - 1];
    if (last) {
      from = stepOf(last.letter, octaveOf(last.letter, last.octave));
      break;
    }
  }
  if (from === null) return null;
  const letter = STEPS.indexOf(typed.toUpperCase());
  const below = from - ((from - letter + 70) % 7);
  const above = below === from ? from : below + 7;
  let choice =
    from - below < above - from
      ? below
      : above - from < from - below
        ? above
        : Math.abs(below - MIDDLE_C) <= Math.abs(above - MIDDLE_C)
          ? below
          : above;
  const lineFrom = text.lastIndexOf("\n", position - 1) + 1;
  const voice = voiceOf(voiceMarks(text, tune), tune, lineFrom);
  const [low, high] = RANGES[clefOf(text, tune, voice)];
  if (choice < low || choice > high) {
    const other = choice === below ? (below === above ? below + 7 : above) : below;
    if (other >= low && other <= high) choice = other;
  }
  return writePitch(typed, Math.floor(choice / 7));
}
