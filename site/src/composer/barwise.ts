/**
 * Editing selected music bar by bar (loaded once the editor is in use). A selection never holds a
 * bar line at its ends; one inside it is kept by everything but Cut:
 * - typing over a selection, Backspace and Delete replace the notes only: bar lines (`|`, `|:`,
 *   `:|`, `|]`, `[1`) and line breaks stay;
 * - Cut (and Delete in the score) takes whole bars out with one of their bar lines, so no empty
 *   `||` is left, and only the notes of a bar it covers in part;
 * - Copy of whole bars copies their closing bar line too, so pasting brings whole bars;
 * - Paste fits the copy to the bars around it: a copy ending in a bar line pasted just before one
 *   doesn't double it, and a copy without bar lines over a selection with some keeps them.
 */
import { type MusicToken, lineKind, tokenizeMusic } from "./abc";
import type { Change, Range } from "./commands";
import { selectedNotes } from "./selected";
import { type FileIndex, indexFile } from "./tunes";

type Line = { from: number; to: number; tokens: MusicToken[] };

/** The music lines a range touches, tokenized. */
function linesOf(text: string, range: Range): Line[] {
  const lines: Line[] = [];
  let at = text.lastIndexOf("\n", range.from - 1) + 1;
  while (at <= range.to && at <= text.length) {
    const end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    const line = text.slice(at, end);
    if (lineKind(line, true) === "music")
      lines.push({ from: at, to: end, tokens: tokenizeMusic(line, at) });
    if (end >= text.length) break;
    at = end + 1;
  }
  return lines;
}

/** A bar's text on a line: between its bar lines (or the line's ends), with its notes' starts. */
type Segment = {
  from: number;
  to: number;
  open?: MusicToken;
  close?: MusicToken;
  events: number[];
};

function segmentsOf(line: Line, events: number[]): Segment[] {
  const segments: Segment[] = [];
  let open: MusicToken | undefined;
  let from = line.from;
  const push = (to: number, close?: MusicToken) => {
    const own = events.filter((at) => at >= from && at < to);
    segments.push({
      from,
      to,
      events: own,
      ...(open ? { open } : {}),
      ...(close ? { close } : {}),
    });
  };
  for (const token of line.tokens) {
    if (token.kind !== "bar") continue;
    push(token.from, token);
    open = token;
    from = token.to;
  }
  push(line.to);
  return segments;
}

/** Whether every range is music in a tune's body (notes or rests), so bar rules apply. */
function inMusic(text: string, ranges: Range[], file: FileIndex): boolean {
  return ranges.every((range) => {
    if (range.from >= range.to) return false;
    const tune = file.tunes.find((each) => range.from >= each.bodyFrom && range.to <= each.to);
    if (!tune) return false;
    let at = text.lastIndexOf("\n", range.from - 1) + 1;
    while (at < range.to) {
      const end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
      if (lineKind(text.slice(at, end), true) !== "music") return false;
      at = end + 1;
    }
    return true;
  });
}

/** Bar lines and line breaks wholly inside a range: what typing over it keeps. */
function keptInside(text: string, range: Range): Range[] {
  const kept: Range[] = [];
  for (const line of linesOf(text, range)) {
    for (const token of line.tokens)
      if (token.kind === "bar" && token.to > range.from && token.from < range.to)
        kept.push({ from: Math.max(token.from, range.from), to: Math.min(token.to, range.to) });
    if (line.to >= range.from && line.to < range.to) kept.push({ from: line.to, to: line.to + 1 });
  }
  // A bar line cut by the range's edge is kept whole: the range stops at it.
  return kept.sort((a, b) => a.from - b.from);
}

/**
 * Typing `insert` over the selection (or Backspace/Delete, with ""), keeping the bar lines and
 * line breaks inside it. Null when no range holds one, or the selection isn't music: then the
 * editor's own typing does.
 */
export function replaceKeepingBars(
  text: string,
  ranges: Range[],
  insert: string,
  file: FileIndex = indexFile(text),
): Change[] | null {
  const selected = ranges.filter((range) => range.to > range.from);
  if (!selected.length || !inMusic(text, selected, file)) return null;
  // A selection of bar lines alone (no note) is text: deleting a bar line on purpose works.
  if (!selectedNotes(text, selected, file).length) return null;
  const changes: Change[] = [];
  let any = false;
  for (const range of selected) {
    const kept = keptInside(text, range);
    if (kept.length) any = true;
    const gaps: Range[] = [];
    let at = range.from;
    for (const piece of kept) {
      if (piece.from > at) gaps.push({ from: at, to: piece.from });
      at = Math.max(at, piece.to);
    }
    if (at < range.to) gaps.push({ from: at, to: range.to });
    if (!gaps.length) changes.push({ from: range.from, to: range.from, insert });
    gaps.forEach((gap, index) =>
      changes.push({ ...gap, insert: index || !insert ? apart(text, gap) : insert }),
    );
  }
  return any ? changes : null;
}

/**
 * What a deleted stretch leaves: nothing, or a space when it would put two bar lines together
 * (`|` and `:|` would read as `|:|`, `|` and `|` as a double bar): an empty bar, each bar line
 * as it was.
 */
function apart(text: string, gap: Range): string {
  return /[|:\]]$/.test(text.slice(0, gap.from)) && /^[|:[]/.test(text.slice(gap.to)) ? " " : "";
}

/** The notes' starts each range selects whole (the one rule), and every event's start per line. */
function chosen(text: string, ranges: Range[], file: FileIndex) {
  return new Set(
    selectedNotes(text, ranges, file)
      .filter((each) => each.whole)
      .map((each) => each.event.from),
  );
}
function eventsOn(text: string, line: Line, file: FileIndex): number[] {
  return selectedNotes(text, [{ from: line.from, to: line.to }], file)
    .map((each) => each.event.from)
    .filter((at) => at >= line.from && at < line.to);
}

const PLAIN = /^\|$/;

/**
 * Cut: whole bars go, each run of them with one bar line (the one after it when that is a plain
 * `|`, else the plain one before it), and a bar covered in part loses only the selected text, its
 * bar lines kept. A music line left empty goes too, so a blank line never ends the tune.
 */
export function cutKeepingBars(
  text: string,
  ranges: Range[],
  file: FileIndex = indexFile(text),
): Change[] | null {
  const selected = ranges.filter((range) => range.to > range.from);
  if (!selected.length || !inMusic(text, selected, file)) return null;
  const picked = chosen(text, selected, file);
  const cuts: Range[] = [];
  const touched = new Map<number, Line>();
  for (const range of selected)
    for (const line of linesOf(text, range)) {
      touched.set(line.from, line);
      const segments = segmentsOf(line, eventsOn(text, line, file));
      const whole = (segment: Segment) =>
        segment.events.length > 0 &&
        segment.events.every((at) => picked.has(at)) &&
        segment.to > range.from &&
        segment.from < range.to;
      for (let at = 0; at < segments.length; at++) {
        const segment = segments[at] as Segment;
        if (segment.to <= range.from || segment.from >= range.to) continue;
        if (!whole(segment)) {
          // Part of a bar: the selected text, never its bar lines.
          const from = Math.max(range.from, segment.from);
          const to = Math.min(range.to, segment.to);
          if (to > from) cuts.push({ from, to });
          continue;
        }
        let last = at;
        while (last + 1 < segments.length && whole(segments[last + 1] as Segment)) last += 1;
        const first = segment;
        const end = segments[last] as Segment;
        if (end.close && PLAIN.test(end.close.text))
          cuts.push({ from: first.from, to: end.close.to });
        else if (!end.close || !first.open || !PLAIN.test(first.open.text))
          cuts.push({ from: first.from, to: end.to });
        else cuts.push({ from: first.open.from, to: end.to });
        at = last;
      }
    }
  // A music line left with nothing but spaces goes, with its line break.
  const merged = union(cuts);
  for (const line of touched.values()) {
    let left = "";
    let at = line.from;
    for (const cut of merged) {
      if (cut.to <= line.from || cut.from >= line.to) continue;
      left += text.slice(at, Math.max(at, cut.from));
      at = Math.max(at, cut.to);
    }
    left += text.slice(Math.min(at, line.to), line.to);
    if (!left.trim() && merged.some((cut) => cut.from < line.to && cut.to > line.from)) {
      const to = line.to < text.length ? line.to + 1 : line.to;
      const from = to === line.to && line.from > 0 ? line.from - 1 : line.from;
      merged.push({ from, to });
    }
  }
  return union(merged).map((cut) => ({ ...cut, insert: apart(text, cut) }));
}

function union(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

/**
 * The text a copy of one range takes: as written, and when it ends on a whole bar, that bar's
 * closing bar line too (a plain `|`), so a paste brings whole bars.
 */
export function copyWithBars(
  text: string,
  range: Range,
  file: FileIndex = indexFile(text),
): string {
  const written = text.slice(range.from, range.to);
  if (range.to <= range.from || !inMusic(text, [range], file)) return written;
  const lines = linesOf(text, range);
  const line = lines[lines.length - 1];
  if (!line) return written;
  const picked = chosen(text, [range], file);
  const segments = segmentsOf(line, eventsOn(text, line, file));
  const last = segments.find((segment) => segment.from < range.to && segment.to >= range.to);
  if (!last?.close || !last.events.length || !last.events.every((at) => picked.has(at)))
    return written;
  if (!/^\s*$/.test(text.slice(range.to, last.close.from))) return written;
  return `${written.replace(/[ \t]+$/, "")}|`;
}

/** Whether a copy holds a bar line. */
export function hasBars(clip: string): boolean {
  return clip
    .split("\n")
    .some((line) => tokenizeMusic(line, 0).some((token) => token.kind === "bar"));
}

/**
 * What pasting plain music over a range writes: a copy ending in a bar line pasted just before
 * one doesn't double it; a copy with no bar lines over a range holding some keeps them (like
 * typing). Null when the editor's own paste does.
 */
export function pasteKeepingBars(
  text: string,
  ranges: Range[],
  clip: string,
  file: FileIndex = indexFile(text),
): Change[] | null {
  const music = ranges.every(
    (range) =>
      (range.from === range.to &&
        file.tunes.some((tune) => range.from >= tune.bodyFrom && range.from <= tune.to)) ||
      inMusic(text, [range], file),
  );
  if (!music) return null;
  if (!hasBars(clip)) {
    if (ranges.every((range) => range.from === range.to)) return null;
    return replaceKeepingBars(text, ranges, clip, file);
  }
  let changed = false;
  const changes = ranges.map((range) => {
    let insert = clip;
    let ahead = range.to;
    while (ahead < text.length && /[ \t]/.test(text[ahead] as string)) ahead += 1;
    const next = tokenizeMusic(
      text.slice(ahead, text.indexOf("\n", ahead) < 0 ? text.length : text.indexOf("\n", ahead)),
      ahead,
    )[0];
    if (next?.kind === "bar" && /\|[ \t]*$/.test(clip)) {
      insert = clip.replace(/[ \t]*\|[ \t]*$/, "");
      changed = true;
    }
    return { from: range.from, to: range.to, insert };
  });
  return changed ? changes : null;
}

/** What typing `"`, `[` or `{` over selected music does, or why it can't. */
export type Bracketed = { changes: Change[]; caret?: number } | { refused: string };

/**
 * `"`, `[` and `{` typed over selected music act on its notes rather than wrapping the text:
 * - `"` writes an empty chord symbol before the first selected note, the caret inside it;
 * - `[` makes the selected notes one chord, when they are notes side by side in one bar of one
 *   voice: spaces go, and the chord takes the first note's length;
 * - `{` makes them grace notes, when they have no lengths of their own and sit in one bar.
 * Null when the selection isn't music (it is typed as usual).
 */
export function bracketOver(
  text: string,
  ranges: Range[],
  typed: string,
  file: FileIndex = indexFile(text),
): Bracketed | null {
  if (!['"', "[", "{"].includes(typed)) return null;
  const selected = ranges.filter((range) => range.to > range.from);
  if (!selected.length || !inMusic(text, selected, file)) return null;
  const picked = selectedNotes(text, selected, file);
  const notes = picked.filter((each) => !each.event.rest);
  const first = notes[0];
  if (!first) return null;
  if (typed === '"')
    return {
      changes: [{ from: first.span.from, to: first.span.from, insert: '""' }],
      caret: first.span.from + 1,
    };
  const what = typed === "[" ? "A chord" : "Grace notes";
  const last = picked[picked.length - 1] as (typeof picked)[number];
  const between = tokenizeMusic(text.slice(first.span.from, last.span.to), first.span.from);
  const voices = new Set(picked.map((each) => each.event.voice));
  if (voices.size > 1 || between.some((token) => token.kind === "bar"))
    return { refused: `${what} can only be made from notes in one bar of one voice.` };
  if (picked.some((each) => each.event.rest))
    return { refused: `${what} can't hold a rest: select notes only.` };
  const loose = between.filter((token) =>
    ["tuplet", "slur", "inline-field", "grace-open", "grace-close", "chord-symbol"].includes(
      token.kind,
    ),
  );
  if (loose.length && typed === "{")
    return {
      refused: "Grace notes are made from plain notes: these have marks or groups between them.",
    };
  const tones = notes.flatMap((each) => each.event.notes);
  if (typed === "{") {
    if (tones.some((tone) => tone.length) || notes.some((each) => each.event.notes.length > 1))
      return {
        refused:
          "Grace notes have no lengths of their own: select single notes written without a length.",
      };
    return {
      changes: [
        { from: first.event.from, to: first.event.from, insert: "{" },
        { from: last.event.to, to: last.event.to, insert: "}" },
      ],
    };
  }
  if (loose.some((token) => token.kind !== "chord-symbol"))
    return {
      refused:
        "A chord is made from notes side by side: these have a tuplet, slur or field between them.",
    };
  // The first note's marks stay before the chord; the chord takes its length.
  const lead = text.slice(first.span.from, first.event.from);
  const length =
    first.event.notes.length > 1
      ? (tokenizeMusic(text.slice(first.event.from, first.event.to), first.event.from).find(
          (token) => token.kind === "chord-close",
        )?.length ?? "")
      : (first.event.notes[0] as (typeof tones)[number]).length;
  const pitches = tones.map((tone) => `${tone.accidental}${tone.letter}${tone.octave}`).join("");
  const tail = text.slice(last.event.to, last.span.to);
  return {
    changes: [
      { from: first.span.from, to: last.span.to, insert: `${lead}[${pitches}]${length}${tail}` },
    ],
  };
}
