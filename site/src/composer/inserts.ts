import type { Change, Range } from "./commands";
import { selectedNotes } from "./selected";
import { type FileIndex, indexFile } from "./tunes";

/*
 * Insert › Triplet, Repeat and Chord symbol over a selection go by its notes, never by which end
 * the selection was dragged to.
 */

/** The selected notes of each range (the one rule), in text order. */
function notesOfRanges(text: string, ranges: Range[], file: FileIndex) {
  return ranges
    .filter((range) => range.to > range.from)
    .map((range) => selectedNotes(text, [range], file).filter((each) => !each.event.rest))
    .filter((notes) => notes.length);
}

/** `(3` before each range's first selected note (before its decorations): three selected notes
 * become the triplet. Null when nothing selected is a note. */
export function insertTriplet(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): Change[] | null {
  const groups = notesOfRanges(text, ranges, file);
  if (!groups.length) return null;
  return groups.map((notes) => {
    const first = notes[0] as (typeof notes)[number];
    return { from: first.span.from, to: first.span.from, insert: "(3" };
  });
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
 * Each range's notes inside a repeat: `|:` before the first and `:|` after the last, reusing a
 * plain bar line already there (`|` becomes `|:` or `:|`; a `||` or `|]` takes a `:` before it).
 */
export function insertRepeat(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): Change[] | null {
  const groups = notesOfRanges(text, ranges, file);
  if (!groups.length) return null;
  const changes: Change[] = [];
  for (const notes of groups) {
    const start = (notes[0] as (typeof notes)[number]).span.from;
    const end = (notes[notes.length - 1] as (typeof notes)[number]).span.to;
    // Before: a bar line just before the first note (spaces apart) opens the repeat.
    let back = start;
    while (back > 0 && /[ \t]/.test(text[back - 1] as string)) back -= 1;
    const before = /(\|:|::|:\||\|\]|\|\||\|)$/.exec(text.slice(Math.max(0, back - 3), back))?.[1];
    if (before === "|:" || before === "::") {
      /* Already opens a repeat. */
    } else if (before === "|") changes.push({ from: back - 1, to: back, insert: "|:" });
    else if (before === ":|") changes.push({ from: back, to: back, insert: ":" });
    else changes.push({ from: start, to: start, insert: "|: " });
    // After: a bar line just after the last note closes it.
    let ahead = end;
    while (ahead < text.length && /[ \t]/.test(text[ahead] as string)) ahead += 1;
    const after = /^(:\||::|\|:|\|\]|\|\||\|)/.exec(text.slice(ahead, ahead + 3))?.[1];
    if (after === ":|" || after === "::") {
      /* Already closes a repeat. */
    } else if (after === "|") changes.push({ from: ahead, to: ahead + 1, insert: ":|" });
    else if (after) changes.push({ from: ahead, to: ahead, insert: ":" });
    else changes.push({ from: end, to: end, insert: " :|" });
  }
  return changes;
}
