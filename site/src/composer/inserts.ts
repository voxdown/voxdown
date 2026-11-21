import { tokenizeMusic } from "./abc";
import { type Change, type Range, passagesOf } from "./commands";
import { selectedNotes } from "./selected";
import { type FileIndex, indexFile } from "./tunes";

/*
 * Insert › Triplet, Repeat and Chord symbol over a selection go by its notes, never by which end
 * the selection was dragged to; a voice selected across V: blocks is one passage (as for
 * Duplicate and slurs), so a triplet or repeat is written once over it.
 */

/** The selected notes of each passage (the one rule), in text order. */
function notesOfRanges(text: string, ranges: Range[], file: FileIndex) {
  return passagesOf(text, ranges, file)
    .map((passage) => selectedNotes(text, passage.ranges, file).filter((each) => !each.event.rest))
    .filter((notes) => notes.length);
}

/**
 * `(3` before three selected notes: exactly three, in one bar of one voice, none already in a
 * tuplet. Otherwise refused, saying why; null when nothing selected is music.
 */
export function insertTriplet(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): Change[] | { refused: string } | null {
  const picked = selectedNotes(
    text,
    ranges.filter((range) => range.to > range.from),
    file,
  );
  if (!picked.length) return null;
  if (picked.length !== 3)
    return {
      refused: `A triplet takes exactly 3 notes in one bar: ${picked.length} ${picked.length === 1 ? "is" : "are"} selected.`,
    };
  const first = picked[0] as (typeof picked)[number];
  const last = picked[2] as (typeof picked)[number];
  const between = tokenizeMusic(text.slice(first.span.from, last.event.to), first.span.from);
  if (
    new Set(picked.map((each) => each.event.voice)).size > 1 ||
    between.some((token) => token.kind === "bar")
  )
    return { refused: "A triplet takes 3 notes in one bar of one voice: these cross a bar line." };
  if (tupletOf(text, first.span.from).some((at) => picked.some((each) => each.event.from === at)))
    return { refused: "These notes are already in a tuplet: a triplet can't go inside another." };
  return [{ from: first.span.from, to: first.span.from, insert: "(3" }];
}

/** The notes of every tuplet on a line, by their starts. */
function tupletOf(text: string, at: number): number[] {
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const to = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
  const tokens = tokenizeMusic(text.slice(from, to), from);
  const notes: number[] = [];
  let left = 0;
  for (const token of tokens) {
    if (token.kind === "tuplet") left = Number(/^\((\d+)/.exec(token.text)?.[1] ?? 3);
    else if (
      left > 0 &&
      ((token.kind === "note" && !token.inGrace && !token.inChord) ||
        token.kind === "rest" ||
        token.kind === "chord-open")
    ) {
      notes.push(token.from);
      left -= 1;
    }
  }
  return notes;
}

/** A chord symbol's quotes before the first selected note; null when no note is selected. */
export function insertChordSymbol(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): Change | null {
  const first = notesOfRanges(text, ranges, file)[0]?.[0];
  return first ? { from: first.span.from, to: first.span.from, insert: '""' } : null;
}

/**
 * A repeat around the selected music's bars: `|:` at the bar line before its first bar and `:|`
 * at the one after its last, merging with what is there (`|` becomes `|:` or `:|`, `:|` before
 * becomes `::`, `|]` after becomes `:|]`), or at the line's ends. Refused inside an ending.
 */
export function insertRepeat(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): Change[] | { refused: string } | null {
  const groups = notesOfRanges(text, ranges, file);
  if (!groups.length) return null;
  const changes: Change[] = [];
  for (const notes of groups) {
    const start = (notes[0] as (typeof notes)[number]).span.from;
    const end = (notes[notes.length - 1] as (typeof notes)[number]).span.to;
    const line = (at: number) => {
      const from = text.lastIndexOf("\n", at - 1) + 1;
      const to = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
      return { from, to, tokens: tokenizeMusic(text.slice(from, to), from) };
    };
    const first = line(start);
    const open = first.tokens.filter((token) => token.kind === "bar" && token.to <= start).at(-1);
    if (!open) {
      const at = first.tokens.find((token) => token.kind !== "space")?.from ?? start;
      changes.push({ from: at, to: at, insert: "|: " });
    } else if (open.text === "|" || open.text === "||")
      changes.push({ from: open.from, to: open.to, insert: "|:" });
    else if (open.text === ":|") changes.push({ from: open.from, to: open.to, insert: "::" });
    else if (/^\|?\[?[0-9]/.test(open.text))
      return { refused: "A repeat can't start inside an ending: select bars before the endings." };
    else if (!/:$/.test(open.text)) changes.push({ from: open.to, to: open.to, insert: " |:" });
    const last = line(end);
    const close = last.tokens.find((token) => token.kind === "bar" && token.from >= end);
    if (!close) {
      const at = [...last.tokens].reverse().find((token) => token.kind !== "space")?.to ?? end;
      changes.push({ from: at, to: at, insert: " :|" });
    } else if (close.text === "|" || close.text === "||")
      changes.push({ from: close.from, to: close.to, insert: ":|" });
    else if (close.text === "|:") changes.push({ from: close.from, to: close.to, insert: "::" });
    else if (close.text === "|]") changes.push({ from: close.from, to: close.to, insert: ":|]" });
    else if (/[0-9]$/.test(close.text))
      return { refused: "A repeat can't end where an ending starts: select the bars before it." };
    else if (!/^:/.test(close.text))
      changes.push({ from: close.from, to: close.from, insert: ":" });
  }
  return changes;
}
