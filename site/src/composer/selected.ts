/**
 * The one rule for which notes a set of text ranges selects. The score's lighting, the status
 * line's count, every command (transpose, lengths, marks, ties, slurs, Insert, Duplicate), Play
 * and Loop, and Find melody all ask this one function.
 *
 * - A note (or chord, or rest) is selected when a range overlaps any part of it: its pitch letters,
 *   accidentals, octave marks and length, and what is attached to it: the decorations,
 *   annotations, chord symbol and grace notes written before it, and the tie and broken-rhythm
 *   sign written after it. Double-clicking `F` in `F/G/`, or selecting `trill` in `!trill!F`,
 *   selects that F.
 * - A caret (an empty range) stands for the note it is in, or the one just before it.
 * - A range strictly inside a chord's brackets that covers only some of its tones selects just
 *   those tones.
 */
import { type MusicToken, type NoteToken, lineKind, tokenizeMusic } from "./abc";
import { type FileIndex, type TuneInfo, indexFile } from "./tunes";
import { type MusicEvent, tuneItems } from "./walk";

export type Range = { from: number; to: number };

export type Picked = {
  event: MusicEvent;
  /** The tones selected: all of the event's notes, or (a range inside a chord) some of them. */
  tones: NoteToken[];
  /** False when only some of a chord's tones are selected. */
  whole: boolean;
  /** The note with what is attached to it: where a range touching it selects it. */
  span: Range;
};

/** Tokens written before a note that belong to it. */
const BEFORE = new Set(["decoration", "annotation", "chord-symbol", "grace-open", "grace-close"]);

/** Each event's span (the note and what is attached to it), one line's tokens at a time. */
export function eventSpans(text: string, events: MusicEvent[]): Map<MusicEvent, Range> {
  const spans = new Map<MusicEvent, Range>();
  const lines = new Map<number, MusicToken[]>();
  for (const event of events) {
    const lineFrom = text.lastIndexOf("\n", event.from - 1) + 1;
    let tokens = lines.get(lineFrom);
    if (!tokens) {
      const lineTo = text.indexOf("\n", lineFrom) < 0 ? text.length : text.indexOf("\n", lineFrom);
      const line = text.slice(lineFrom, lineTo);
      tokens = lineKind(line, true) === "music" ? tokenizeMusic(line, lineFrom) : [];
      lines.set(lineFrom, tokens);
    }
    let from = event.from;
    let to = event.to;
    const first = tokens.findIndex((token) => token.from === event.from);
    if (first >= 0) {
      for (let at = first - 1; at >= 0; at--) {
        const token = tokens[at] as MusicToken;
        const graceNote = token.kind === "note" && token.inGrace;
        if (token.kind === "space") continue;
        if (!BEFORE.has(token.kind) && !graceNote) break;
        from = token.from;
      }
      const last = tokens.findIndex((token) => token.to === event.to);
      for (let at = last + 1; last >= 0 && at < tokens.length; at++) {
        const token = tokens[at] as MusicToken;
        if (token.kind !== "tie" && token.kind !== "broken") break;
        to = token.to;
      }
    }
    spans.set(event, { from, to });
  }
  return spans;
}

/** Each tune's events and spans, kept for the text they were read from (a drag asks often). */
let memo: {
  text: string;
  tunes: Map<number, { events: MusicEvent[]; spans: Map<MusicEvent, Range> }>;
} | null = null;
function tuneEvents(text: string, tune: TuneInfo, file: FileIndex) {
  if (memo?.text !== text) memo = { text, tunes: new Map() };
  const key = tune.from * 1e7 + tune.to;
  let found = memo.tunes.get(key);
  if (!found) {
    const events = tuneItems(text, tune, file).filter(
      (item): item is MusicEvent => item.type === "event",
    );
    found = { events, spans: eventSpans(text, events) };
    memo.tunes.set(key, found);
  }
  return found;
}

/** The tunes a set of ranges touches (a caret counts as touching its tune). */
function tunesOf(file: FileIndex, ranges: Range[]): TuneInfo[] {
  return file.tunes.filter((tune) =>
    ranges.some((range) =>
      range.from === range.to
        ? range.from >= tune.bodyFrom && range.from <= tune.to
        : range.from < tune.to && range.to > tune.bodyFrom,
    ),
  );
}

/** Which notes a set of text ranges selects: the one rule (see above). In text order. */
export function selectedNotes(
  text: string,
  ranges: Range[],
  file: FileIndex = indexFile(text),
): Picked[] {
  const picked: Picked[] = [];
  for (const tune of tunesOf(file, ranges)) {
    const { events, spans } = tuneEvents(text, tune, file);
    const chosen = new Map<MusicEvent, { tones: Set<NoteToken>; whole: boolean }>();
    const take = (event: MusicEvent, tones: NoteToken[] | null) => {
      const entry = chosen.get(event) ?? { tones: new Set<NoteToken>(), whole: false };
      if (!tones) entry.whole = true;
      else for (const tone of tones) entry.tones.add(tone);
      chosen.set(event, entry);
    };
    for (const range of ranges) {
      if (range.from === range.to) {
        // A caret: the note it is in, else the one ending just before it.
        let found: MusicEvent | undefined;
        for (const event of events) {
          if (event.from <= range.from && range.from < event.to) {
            found = event;
            break;
          }
          if (event.to === range.from) found = event;
        }
        if (found) take(found, null);
        continue;
      }
      for (const event of events) {
        const span = spans.get(event) as Range;
        if (span.from >= range.to || span.to <= range.from) continue;
        // Strictly inside a chord's brackets: only the tones the range covers.
        const close = event.notes.length > 1 ? text.lastIndexOf("]", event.to - 1) : -1;
        if (close > event.from && range.from > event.from && range.to <= close) {
          const tones = event.notes.filter((note) => note.from < range.to && note.to > range.from);
          if (tones.length && tones.length < event.notes.length) {
            take(event, tones);
            continue;
          }
        }
        take(event, null);
      }
    }
    for (const event of events) {
      const entry = chosen.get(event);
      if (!entry) continue;
      const whole = entry.whole || entry.tones.size >= event.notes.length;
      picked.push({
        event,
        tones: whole ? event.notes : event.notes.filter((note) => entry.tones.has(note)),
        whole,
        span: spans.get(event) as Range,
      });
    }
  }
  return picked.sort((a, b) => a.event.from - b.event.from);
}

/** What a selection is, in words: "3 notes", "1 chord tone", "2 notes and 1 chord tone". */
export function describePicked(picked: Picked[]): { count: number; text: string } {
  const notes = picked.filter((each) => !each.event.rest && each.whole).length;
  const tones = picked
    .filter((each) => !each.event.rest && !each.whole)
    .reduce((sum, each) => sum + each.tones.length, 0);
  const parts: string[] = [];
  if (notes || !tones) parts.push(`${notes} ${notes === 1 ? "note" : "notes"}`);
  if (tones) parts.push(`${tones} chord ${tones === 1 ? "tone" : "tones"}`);
  return { count: notes + tones, text: parts.join(" and ") };
}
