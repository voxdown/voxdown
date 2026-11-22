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
import {
  type Fraction,
  type MusicToken,
  add,
  defaultUnit,
  formatLength,
  frac,
  lineKind,
  meterLength,
  parseLength,
  parseUnit,
  tokenizeMusic,
} from "./abc";
import { keyLabel } from "./clip-convert";
import { type Change, type Range, barAround, barLine, passagesOf } from "./commands";
import { markOf } from "./playorder";
import { type Picked, selectedNotes } from "./selected";
import { VALUES, beatOf, readingAt } from "./stepentry";
import { type FileIndex, type TuneInfo, indexFile } from "./tunes";
import { tuneItems } from "./walk";

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
  /** Its tokens, spaces left out. */
  tokens: MusicToken[];
};

/** Bar lines written side by side (`|[1`, `:| [2`) are one bar line. */
function joinedBars(tokens: MusicToken[]): MusicToken[] {
  const out: MusicToken[] = [];
  for (const token of tokens) {
    const last = out.filter((each) => each.kind !== "space").at(-1);
    const between = last ? out.slice(out.indexOf(last) + 1) : [];
    if (
      token.kind === "bar" &&
      last?.kind === "bar" &&
      between.every((each) => each.kind === "space") &&
      /^\[?[0-9]/.test(token.text)
    ) {
      out.splice(out.indexOf(last));
      out.push({ ...last, to: token.to, text: `${last.text}${token.text}` });
      continue;
    }
    out.push(token);
  }
  return out;
}

function segmentsOf(given: Line, events: number[]): Segment[] {
  const segments: Segment[] = [];
  const line = { ...given, tokens: joinedBars(given.tokens) };
  let open: MusicToken | undefined;
  let from = line.from;
  const push = (to: number, close?: MusicToken) => {
    const own = events.filter((at) => at >= from && at < to);
    segments.push({
      from,
      to,
      events: own,
      tokens: line.tokens.filter(
        (token) => token.from >= from && token.to <= to && token.kind !== "space",
      ),
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

/**
 * What typing over a range keeps: bar lines, line breaks, inline fields and jump marks, and a
 * slur's end whose pair is outside the selection.
 */
function keptInside(
  text: string,
  range: Range,
  structure: Structure,
  selected: Range[],
  typing = false,
): Range[] {
  const kept: Range[] = [];
  // Typing over notes: the first one's chord symbol and dynamic lead what's typed (round 7).
  const firstNote = structure.tokens.find(
    ({ token }) => token.from >= range.from && token.from < range.to && starts(token),
  )?.token;
  const leading = (token: MusicToken) =>
    typing &&
    firstNote !== undefined &&
    token.to <= firstNote.from &&
    (token.kind === "chord-symbol" ||
      (token.kind === "decoration" && DYNAMIC_MARK.test(token.text)));
  for (const line of linesOf(text, range)) {
    for (const token of line.tokens)
      if (
        token.to > range.from &&
        token.from < range.to &&
        (token.kind === "bar" ||
          keeper(token) ||
          leading(token) ||
          (token.kind === "slur" && !inside(structure.slurs.get(token.from) ?? -1, selected)))
      )
        kept.push({ from: Math.max(token.from, range.from), to: Math.min(token.to, range.to) });
    if (line.to >= range.from && line.to < range.to) kept.push({ from: line.to, to: line.to + 1 });
  }
  // A bar line cut by the range's edge is kept whole: the range stops at it.
  return kept.sort((a, b) => a.from - b.from);
}

/**
 * Typing `insert` over the selection (or Backspace/Delete, with ""), keeping what keptInside
 * says. Backspace or Delete that would leave a tuplet short is refused. Null when the range
 * keeps nothing, or the selection isn't music: then the editor's own typing does.
 */
export function replaceKeepingBars(
  text: string,
  ranges: Range[],
  insert: string,
  file: FileIndex = indexFile(text),
): Change[] | { refused: string } | null {
  const selected = ranges.filter((range) => range.to > range.from);
  if (!selected.length || !inMusic(text, selected, file)) return null;
  // A selection of bar lines alone (no note) is text: deleting a bar line on purpose works.
  if (!selectedNotes(text, selected, file).length) return null;
  const structure = structureOf(text, file, (selected[0] as Range).from);
  if (!insert && splitTuplet(structure, selected))
    return {
      refused: "This would leave a tuplet short of notes: select all of its notes, or none.",
    };
  const changes: Change[] = [];
  let any = false;
  for (const range of selected) {
    const kept = keptInside(text, range, structure, selected, Boolean(insert));
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
  // Always ours when the selection holds notes, so bar lines left side by side stay apart.
  void any;
  return changes;
}

/**
 * What a deleted stretch leaves: nothing, or a space when it would put two bar lines together
 * (`|` and `:|` would read as `|:|`, `|` and `|` as a double bar): an empty bar, each bar line
 * as it was.
 */
function apart(text: string, gap: Range): string {
  return /[|:\]]$/.test(text.slice(0, gap.from)) && /^[|:[]/.test(text.slice(gap.to)) ? " " : "";
}

/** The notes' starts the ranges select whole (the one rule), and every event's start per line. */
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

/*
 * The music's structure, kept by every edit: bars whole, inline fields and the marks that belong
 * to bar lines (a segno, a coda, D.S., Fine, a "^" text), tuplets with all their notes, slurs and
 * ties with both ends.
 */

/** A jump mark: a decoration or annotation the play order follows. */
function jumpMark(token: MusicToken) {
  if (token.kind === "decoration") {
    const name = token.text.replace(/^!|!$/g, "");
    return name === "S"
      ? markOf("segno", true)
      : name === "O"
        ? markOf("coda", true)
        : markOf(name, true);
  }
  if (token.kind === "annotation") return markOf(token.text.replace(/^"[\^_<>@]?|"$/g, ""), false);
  return null;
}
/** What belongs to a bar line rather than to a note: kept in the tune when its bar goes. */
function keeper(token: MusicToken): boolean {
  if (token.kind === "inline-field") return /^\[[KMLQPV]:/.test(token.text);
  if (token.kind === "annotation" && /^"\^/.test(token.text)) return true;
  return jumpMark(token) !== null;
}
const DYNAMIC_MARK = /^!(p{1,4}|f{1,4}|mp|mf|sfz?|sffz|fp|rfz)!$/;
const HAIRPIN_OPEN = /^!(<\(|>\(|crescendo\(|diminuendo\()!$/;
const HAIRPIN_CLOSE = /^!(<\)|>\)|crescendo\)|diminuendo\))!$/;
/**
 * What a note made a rest gives the rest (round 7): its dynamic, its texts ("_6", "^rit."), its
 * fermata, and the marks of the bar (segno, coda): they belong to the moment, not the pitch.
 */
function restKeeps(token: MusicToken): boolean {
  if (token.kind === "chord-symbol" || token.kind === "annotation" || keeper(token)) return true;
  if (token.kind !== "decoration") return false;
  return (
    DYNAMIC_MARK.test(token.text) ||
    token.text === "H" ||
    /^!(fermata|invertedfermata)!$/.test(token.text)
  );
}
/** Kept before the bar that follows (a segno, a coda, a field), or else after the bar before. */
function leads(token: MusicToken): boolean {
  if (token.kind !== "decoration" && token.kind !== "annotation") return true;
  const mark = jumpMark(token);
  return !mark || mark.kind === "segno" || mark.kind === "coda";
}
/** The start of a note, rest or chord (a grace note and a chord's tones aren't). */
const starts = (token: MusicToken) =>
  (token.kind === "note" && !token.inGrace && !token.inChord) ||
  token.kind === "rest" ||
  token.kind === "chord-open";

/** Every music token of a tune's lines in order, with its voice, for pairing slurs and tuplets. */
export function tuneTokens(text: string, file: FileIndex, at: number) {
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  const out: { token: MusicToken; voice: string }[] = [];
  if (!tune) return out;
  // As the walk reads it: the tune's first voice, until a V: says otherwise.
  let voice = tune.voices[0]?.id ?? "1";
  let line = tune.bodyFrom;
  while (line < tune.to) {
    const end = text.indexOf("\n", line) < 0 ? text.length : text.indexOf("\n", line);
    const content = text.slice(line, end);
    const field = /^V:\s*(\S+)/.exec(content);
    if (field) voice = field[1] as string;
    else if (lineKind(content, true) === "music")
      for (const token of tokenizeMusic(content, line)) {
        const inline = token.kind === "inline-field" && /^\[V:\s*([^\]\s]+)/.exec(token.text);
        if (inline) voice = inline[1] as string;
        if (token.kind !== "space") out.push({ token, voice });
      }
    line = end + 1;
  }
  return out;
}
/** Slurs' ends by position, each to its pair (or -1, unpaired); tuplets' signs to their notes. */
function structureOf(text: string, file: FileIndex, at: number) {
  const tokens = tuneTokens(text, file, at);
  const slurs = new Map<number, number>();
  const open = new Map<string, number[]>();
  const tuplets: { sign: MusicToken; notes: number[] }[] = [];
  const pending: { sign: MusicToken; left: number; notes: number[]; voice: string }[] = [];
  for (const { token, voice } of tokens) {
    if (token.kind === "slur") {
      const stack = open.get(voice) ?? [];
      if (token.text === "(") stack.push(token.from);
      else {
        const from = stack.pop();
        if (from === undefined) slurs.set(token.from, -1);
        else {
          slurs.set(from, token.from);
          slurs.set(token.from, from);
        }
      }
      open.set(voice, stack);
    } else if (token.kind === "tuplet") {
      const count = Number(
        /^\((\d+)(?::\d*)?(?::(\d+))?/.exec(token.text)?.[2] ??
          /^\((\d+)/.exec(token.text)?.[1] ??
          3,
      );
      const entry = { sign: token, left: count, notes: [] as number[], voice };
      pending.push(entry);
      tuplets.push(entry);
    } else if (starts(token))
      for (const entry of pending)
        if (entry.voice === voice && entry.left > 0) {
          entry.notes.push(token.from);
          entry.left -= 1;
        }
  }
  for (const stack of open.values()) for (const from of stack) slurs.set(from, -1);
  return { slurs, tuplets, tokens };
}
type Structure = ReturnType<typeof structureOf>;

const inside = (at: number, spans: Range[]) =>
  spans.some((span) => at >= span.from && at < span.to);

/** A tuplet the spans take some but not all of: an edit there would leave a `(3` short. */
function splitTuplet(structure: Structure, spans: Range[]): boolean {
  return structure.tuplets.some(({ sign, notes }) => {
    const taken =
      notes.filter((at) => inside(at, spans)).length + (inside(sign.from, spans) ? 1 : 0);
    return taken > 0 && taken < notes.length + 1 && notes.some((at) => inside(at, spans));
  });
}

/**
 * The text of a range, as Copy and Cut put it on the clipboard: what is written, less what would
 * be broken out of its place: jump marks (they stay with the bar lines), a slur's `(` or `)` whose
 * pair isn't copied, a tuplet sign without all its notes, a tie to a note outside. A range ending
 * on a whole bar takes the bar line after it (a plain `|`), so a paste brings whole bars.
 */
export function copyText(text: string, range: Range, file: FileIndex = indexFile(text)): string {
  const written = text.slice(range.from, range.to);
  if (range.to <= range.from) return written;
  if (!inMusic(text, [range], file)) {
    // Music lines with their verses (w: lines) between: each line's music as Copy takes it, the
    // verses as written.
    const tune = file.tunes.find((each) => range.from >= each.bodyFrom && range.to <= each.to);
    if (!tune) return written;
    const out: string[] = [];
    let at = text.lastIndexOf("\n", range.from - 1) + 1;
    while (at < range.to) {
      const end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
      const line = text.slice(at, end);
      const piece = { from: Math.max(at, range.from), to: Math.min(end, range.to) };
      if (lineKind(line, true) === "music") {
        if (piece.to > piece.from) out.push(copyText(text, piece, file));
      } else if (line.startsWith("w:")) out.push(line);
      else return written;
      at = end + 1;
    }
    return out.join("\n");
  }
  const structure = structureOf(text, file, range.from);
  const spans = [range];
  const dropped = new Set<number>();
  const within = structure.tokens.filter(
    ({ token }) => token.from >= range.from && token.to <= range.to,
  );
  for (const { token } of within) {
    if (token.kind === "slur" && !inside(structure.slurs.get(token.from) ?? -1, spans))
      dropped.add(token.from);
    if (keeper(token) && token.kind !== "inline-field") dropped.add(token.from);
  }
  for (const { sign, notes } of structure.tuplets)
    if (inside(sign.from, spans) && !notes.every((at) => inside(at, spans))) dropped.add(sign.from);
  // A tie at the end ties to a note outside the copy.
  const last = within.filter(({ token }) => token.kind !== "bar" && !keeper(token)).at(-1)?.token;
  if (last?.kind === "tie") dropped.add(last.from);
  let out = "";
  let at = range.from;
  for (const { token } of within)
    if (dropped.has(token.from)) {
      out += text.slice(at, token.from);
      at = token.to;
    }
  out += text.slice(at, range.to);
  out = out.replace(/ {2,}/g, " ").trim();
  // Ending on a whole bar: its bar line too.
  const lines = linesOf(text, range);
  const line = lines[lines.length - 1];
  if (!line) return out;
  const picked = chosen(text, [range], file);
  const segments = segmentsOf(line, eventsOn(text, line, file));
  const end = segments.find((segment) => segment.from < range.to && segment.to >= range.to);
  if (!end?.close || !end.events.length || !end.events.every((each) => picked.has(each)))
    return out;
  const after = text.slice(range.to, end.close.from);
  if (!/^\s*$/.test(after.replace(/!.*?!|"[^"]*"/g, ""))) return out;
  if (/\|\s*$/.test(out)) return out;
  // A whole repeat (from just after its |: to just before its :|): its signs come too, so a paste
  // of it is the repeat.
  const tokens = tuneTokens(text, file, range.from).map(({ token }) => token);
  const opener = tokens.filter((token) => token.to <= range.from && token.kind !== "space").at(-1);
  const closing = barParts(end.close.text);
  if (
    opener?.kind === "bar" &&
    barParts(opener.text).start > 0 &&
    closing.end > 0 &&
    !closing.ending &&
    !tokens.some(
      (token) =>
        token.kind === "bar" &&
        token.from >= range.from &&
        token.to <= range.to &&
        !/^\|\|?$/.test(token.text),
    )
  )
    return `|:${out}${/\s/.test(text[range.to] ?? "") ? " " : ""}:|`;
  return `${out}${/\s/.test(text[range.to] ?? "") ? " " : ""}|`;
}

/** Two bar lines written side by side, as the one they mean: `:|` and `|:` make `::`. */
function joinBars(first: string, second: string): string {
  const a = barParts(first);
  const b = barParts(second);
  const end = a.end || b.end;
  const start = b.start || a.start;
  const body = a.body === "|]" || b.body === "|]" ? "|]" : "|";
  if (end && start && body === "|") return `${":".repeat(end)}:${b.ending}`;
  return `${":".repeat(end)}${body}${body === "|]" ? "" : ":".repeat(start)}${b.ending}`;
}

/** Parts of a bar line: `:|2` is an end of repeat, a bar, and the 2nd ending. */
function barParts(text: string) {
  const match = /^(:*)(\[\||\|\]|\|\||\||)(:*)\[?([0-9][0-9,-]*)?$/.exec(text);
  // "::" is the end of one repeat and the start of the next.
  if (match && !match[2] && !match[3] && (match[1]?.length ?? 0) >= 2)
    return { end: 1, body: "|", start: 1, ending: match[4] ?? "" };
  return {
    end: match?.[1]?.length ?? 0,
    body: match?.[2] ?? "|",
    start: match?.[3]?.length ?? 0,
    ending: match?.[4] ?? "",
  };
}
const ordinal = (n: string) =>
  n === "1" ? "1st" : n === "2" ? "2nd" : n === "3" ? "3rd" : `${n}th`;

/**
 * The one bar line left where a bar between two went: the repeat it starts (from the one before),
 * the repeat it ends and the ending it starts (from the one after). A 1st ending cut with its only
 * bar goes, and so does the 2nd ending's number, so the bars after the repeat still play.
 */
function mergeBars(
  open: string,
  close: string,
  after: string,
): { text: string; said?: string } | { refused: string } {
  const o = barParts(open);
  const c = barParts(close);
  if (o.end && c.end)
    return {
      refused:
        "Cutting this bar would join two ends of repeats: cut the repeat's bars one at a time.",
    };
  // A whole repeat between them went: neither its start nor its end is left.
  const whole = o.start > 0 && c.end > 0;
  if (whole && c.ending)
    return {
      refused: "Cutting this would leave an ending without its repeat: cut the endings too.",
    };
  const end = whole ? 0 : o.end || c.end;
  // (The bar line after it may start the next repeat: that stays.)
  const start = c.body === "|]" ? 0 : whole ? c.start : o.start || c.start;
  let ending = c.ending;
  let said: string | undefined;
  const section = c.body === "|]" || c.body === "||" || c.start > 0;
  if (o.ending) {
    if (!c.end && section) said = `The ${ordinal(o.ending)} ending went with its last bar.`;
    else if (!c.end) ending = c.ending || o.ending;
    else if (!c.ending) said = `The ${ordinal(o.ending)} ending went with its last bar.`;
    else if (o.ending === "1" && c.ending === "2" && !moreEndings(after)) {
      ending = "";
      said =
        "The 1st ending went with its only bar; the 2nd ending's bars now play after the repeat.";
    } else
      return {
        refused: `Cutting the ${ordinal(o.ending)} ending would leave the other endings unreachable: cut the whole repeat, or its endings' bars one at a time.`,
      };
  }
  const body = c.body === "|]" ? "|]" : !end && (o.body === "||" || c.body === "||") ? "||" : "|";
  return {
    text: `${":".repeat(end)}${body}${":".repeat(start)}${ending ? (start ? `[${ending}` : ending) : ""}`,
    ...(said ? { said } : {}),
  };
}

/**
 * The bar line left when a run of bars with repeat signs or endings inside it goes: only a whole
 * repeat with its endings (from its `|:` to the end of its last ending), or a repeat's body with
 * its 1st ending (the 2nd then plays once, after); anything else across a repeat is refused.
 */
function mergeRun(
  open: string,
  inner: string[],
  close: string,
  after: string,
  body = false,
): { text: string; said?: string } | { refused: string } {
  if (inner.every((each) => /^\|\|?$/.test(each))) return mergeBars(open, close, after);
  const o = barParts(open);
  const c = barParts(close);
  const parts = inner.map(barParts);
  const ends = parts.filter((part) => part.end).length;
  const endings = parts.map((part) => part.ending).filter(Boolean);
  const refused = {
    refused:
      "This cut takes part of a repeat with its signs or endings: cut the whole repeat with its endings, or bars inside it.",
  };
  // Whole repeats inside the run, each from its start to its end (endings and all), with bars
  // after them: they all go, and the bar line after stays.
  let depth = o.start ? 1 : 0;
  let balanced = true;
  for (const part of parts) {
    if (part.end) depth -= 1;
    if (depth < 0) balanced = false;
    if (part.start) depth += 1;
  }
  if (
    balanced &&
    depth === 0 &&
    !c.end &&
    !c.ending &&
    (o.start || parts.some((part) => part.start))
  )
    return { text: c.body === "|]" ? "|]" : close || "|", said: "The repeat went with its bars." };
  if (parts.some((part) => part.start)) return refused;
  // Nothing of the repeat's body is left before the run (its start is the run's, or the tune's).
  const opened = o.start > 0 || !body;
  // Body and 1st ending: the 2nd ending's bars now follow, played once; with some of the body
  // left, the repeat stays and the 2nd ending's bars follow it.
  if (c.end && c.ending === "2" && !ends && endings.join() === "1" && !moreEndings(after))
    return opened
      ? {
          text: open ? "|" : "",
          said: "The repeat went with its 1st ending; the 2nd ending's bars now play once.",
        }
      : {
          text: ":|",
          said: "The 1st ending went with its bars; the 2nd ending's bars now play after the repeat.",
        };
  // The whole repeat with all its endings.
  if (opened && !c.end && !c.ending && ends === 1 && endings.includes("1") && endings.length >= 2)
    return { text: close, said: "The repeat went with its endings." };
  return refused;
}

/** Whether a 3rd (or later) ending follows, before the next repeat starts (`|3`, `[3`, `:|1,3`). */
function moreEndings(after: string): boolean {
  const scope = after.split(/\n\s*\n/)[0] ?? "";
  const until = scope.search(/\|:|::/);
  return /[|[][0-9,-]*[3-9](?![0-9])/.test(until < 0 ? scope : scope.slice(0, until));
}

/** Whether notes of a repeat's body come before a point, in its voice (back to the repeat's start). */
function bodyBefore(structure: Structure, at: number): boolean {
  const voice = structure.tokens.find(({ token }) => token.from >= at)?.voice;
  const prior = structure.tokens.filter((each) => each.token.to <= at && each.voice === voice);
  for (let index = prior.length - 1; index >= 0; index--) {
    const { token } = prior[index] as (typeof prior)[number];
    if (token.kind === "bar") {
      const part = barParts(token.text);
      if (part.start || part.end || part.ending) return false;
    } else if (starts(token)) return true;
  }
  return false;
}

/** What a Cut does: the edit, where it leaves the caret (after the edit), and what it says. */
export type CutPlan =
  | { changes: Change[]; clip: string; caret: number; said: string[] }
  | { refused: string };

/**
 * Cut (and Delete in the score). Whole bars go with their bar lines, the one bar line left between
 * their neighbours keeping the repeats and endings they start and end; a jump mark or inline field
 * of theirs stays (a segno, coda or field before the bar that follows, D.S. or Fine after the bar
 * before), as does a slur end whose pair stays. A bar taken in part loses only its notes. A tie
 * left to a different note goes. A tuplet is cut whole or not at all. A music line left empty
 * goes too, so a blank line never ends the tune.
 */
export function cutPlan(
  text: string,
  ranges: Range[],
  file: FileIndex = indexFile(text),
): CutPlan | null {
  const selected = ranges.filter((range) => range.to > range.from);
  // (Across tunes: one at a time, each by its own meter and bars.)
  const tunes = new Set(
    selected.flatMap((range) =>
      file.tunes
        .filter((tune) => range.from < tune.to && range.to > tune.bodyFrom)
        .map((tune) => tune.from),
    ),
  );
  if (tunes.size > 1)
    return {
      refused: `This selection is in ${tunes.size} tunes: delete or cut in one tune at a time.`,
    };
  if (!selected.length || !inMusic(text, selected, file)) return null;
  const structure = structureOf(text, file, (selected[0] as Range).from);
  // Some voices only, in a tune with several: rests, so the voices stay in step.
  const someVoices = restsInstead(text, selected, file);
  if (someVoices && "changes" in someVoices)
    return finishCut(
      text,
      selected,
      file,
      someVoices.changes,
      [{ at: someVoices.caret, offset: 0 }],
      someVoices.said,
    );
  const picked = chosen(text, selected, file);
  // (In a tune with several voices, time goes only where every voice is selected.)
  const canGo = timeCanGo(text, selected, file);
  const changes: Change[] = [];
  const said: string[] = [];
  const lines = new Map<number, Line>();
  for (const range of selected) for (const line of linesOf(text, range)) lines.set(line.from, line);
  // Music lines one after another are one stream: a run of bars, or a repeat, can cross a line
  // break.
  const chains: Line[] = [];
  for (const line of [...lines.values()].sort((a, b) => a.from - b.from)) {
    const last = chains[chains.length - 1];
    // (Not into another voice's line: an inline [V:] starts a voice of its own.)
    const voiced = line.tokens.find((token) => token.kind !== "space");
    const otherVoice = voiced?.kind === "inline-field" && /^\[V:/.test(voiced.text);
    if (last && line.from === last.to + 1 && !otherVoice)
      chains[chains.length - 1] = {
        from: last.from,
        to: line.to,
        tokens: [...last.tokens, ...line.tokens],
      };
    else chains.push(line);
  }
  const removed: Range[] = [];
  const carets: { at: number; offset: number }[] = [];
  const picks = selectedNotes(text, selected, file).filter(
    (each) => !each.event.rest || each.whole,
  );
  const resting: Picked[] = [];
  let voicesKept = false;
  for (const line of chains) {
    // A bar of nothing (a line's end and the next line's start) joins the bars either side.
    const segments = segmentsOf(line, eventsOn(text, line, file)).filter(
      (segment) => segment.tokens.length > 0,
    );
    const touches = (segment: Segment) =>
      selected.some((range) => segment.to > range.from && segment.from < range.to);
    const whole = (segment: Segment) =>
      touches(segment) &&
      segment.events.length > 0 &&
      segment.events.every((at) => picked.has(at) && (!canGo || canGo.has(at)));
    for (let at = 0; at < segments.length; at++) {
      const segment = segments[at] as Segment;
      if (!touches(segment)) continue;
      if (!whole(segment)) {
        // Part of a bar: its notes become rests of the same length (as MuseScore does), so the
        // bar keeps its length; a chord's tones alone go from the chord. In an over-full bar the
        // notes simply go while the bar stays at least its length; any shortfall is a rest.
        const own = picks.filter(
          (each) => each.event.from >= segment.from && each.event.from < segment.to,
        );
        if (
          canGo &&
          own.some(
            (each) => each.whole && picked.has(each.event.from) && !canGo.has(each.event.from),
          )
        )
          voicesKept = true;
        for (const each of own) {
          if (each.whole) resting.push(each);
          else
            for (const tone of each.tones)
              changes.push({ from: tone.from, to: tone.to, insert: "" });
        }
        for (const range of selected) {
          const from = Math.max(range.from, segment.from);
          const to = Math.min(range.to, segment.to);
          if (to > from) carets.push({ at: from, offset: 0 });
        }
        continue;
      }
      let last = at;
      while (last + 1 < segments.length && whole(segments[last + 1] as Segment)) last += 1;
      const run = segments.slice(at, last + 1);
      const first = run[0] as Segment;
      const end = run[run.length - 1] as Segment;
      const O = first.open;
      const C = end.close;
      // What stays of the run: its fields (the last of each kind, as in force after it), its
      // marks, and slur ends whose pair is outside it.
      const span = {
        from: O ? O.from : (first.tokens[0] as MusicToken).from,
        to: C ? C.to : (end.tokens.at(-1) as MusicToken).to,
      };
      const before: string[] = [];
      const after: string[] = [];
      const fields = new Map<string, string>();
      for (const segment of run)
        for (const token of segment.tokens) {
          if (token.kind === "inline-field" && keeper(token))
            fields.set(token.text.slice(1, 2), token.text);
          else if (keeper(token)) (leads(token) ? after : before).push(token.text);
          else if (token.kind === "slur" && !inside(structure.slurs.get(token.from) ?? -1, [span]))
            (token.text === "(" ? after : before).push(token.text);
        }
      after.unshift(...fields.values());
      // The dynamic in force after the run goes on to the note that follows (unless it has its own).
      const level = run
        .flatMap((segment) => segment.tokens)
        .filter((token) => token.kind === "decoration" && DYNAMIC_MARK.test(token.text))
        .at(-1);
      if (level && C) {
        const voice = structure.tokens.find(({ token }) => token.from >= span.from)?.voice;
        const next = structure.tokens.filter(
          (each) => each.voice === voice && each.token.from >= C.to,
        );
        const head = next.findIndex(({ token }) => starts(token));
        const own = next
          .slice(0, head < 0 ? 0 : head)
          .some(({ token }) => token.kind === "decoration" && DYNAMIC_MARK.test(token.text));
        if (head >= 0 && !own) after.push(level.text);
      }
      // A D.S. and its segno (and its coda) both in what goes: the jump goes with them.
      const marks = run
        .flatMap((segment) => segment.tokens)
        .map((token) => ({ token, mark: jumpMark(token) }));
      const ds = marks.find(({ mark }) => mark?.kind === "jump" && mark.jump === "D.S.");
      const segno = marks.find(({ mark }) => mark?.kind === "segno");
      if (ds && segno) {
        const gone = [ds.token.text, segno.token.text];
        const until = ds.mark?.kind === "jump" ? ds.mark.until : null;
        const coda = marks.find(({ mark }) => mark?.kind === "coda");
        if (until === "coda" && coda) gone.push(coda.token.text);
        for (const list of [before, after])
          for (const mark of gone) {
            const at = list.indexOf(mark);
            if (at >= 0) list.splice(at, 1);
          }
      }
      let bar: string;
      const innerBars = joinedBars(line.tokens)
        .filter((token) => token.kind === "bar" && token.from >= first.to && token.to <= end.from)
        .map((token) => token.text);
      // Whether some of the repeat's body stays before the run (its start is further back).
      const body = bodyBefore(structure, span.from);
      if (innerBars.some((each) => !/^\|\|?$/.test(each))) {
        const merged = mergeRun(
          O?.text ?? "",
          innerBars,
          C?.text ?? "",
          C ? text.slice(C.to) : "",
          body,
        );
        if ("refused" in merged) return merged;
        bar = merged.text;
        if (merged.said) said.push(merged.said);
      } else if (O && C) {
        if (PLAIN.test(O.text) && PLAIN.test(C.text)) bar = "|";
        else if (PLAIN.test(O.text)) bar = C.text;
        else if (PLAIN.test(C.text)) bar = O.text;
        else {
          const merged = mergeRun(O.text, innerBars, C.text, text.slice(C.to), body);
          if ("refused" in merged) return merged;
          bar = merged.text;
          if (merged.said) said.push(merged.said);
        }
      } else if (C) bar = PLAIN.test(C.text) ? "" : C.text;
      else bar = O ? O.text : "";
      // A plain bar line left first on its line, after a bar line or the tune's start, goes.
      if (bar === "|" && O && !text.slice(text.lastIndexOf("\n", O.from - 1) + 1, O.from).trim()) {
        const prior = structure.tokens.filter(({ token }) => token.to <= O.from).at(-1)?.token;
        if (!prior || prior.kind === "bar") bar = "";
      }
      // A repeat's end left at a line's start goes onto the bar line ending the line before.
      if (!O && /^:/.test(bar)) {
        const prior = structure.tokens.filter(({ token }) => token.to <= span.from).at(-1)?.token;
        if (prior?.kind === "bar" && !text.slice(prior.to, span.from).trim()) {
          changes.push({ from: prior.from, to: prior.to, insert: joinBars(prior.text, bar) });
          bar = "";
        }
      }
      // An inline voice field stays at the start of its voice's line, before its music.
      const voiceFields = O ? [] : after.filter((each) => /^\[V:/.test(each));
      const rest = after.filter((each) => !voiceFields.includes(each));
      const insert = [
        voiceFields.join(" "),
        before.join(" "),
        bar,
        rest.join(" ").replace(/\( /g, "("),
      ]
        .filter(Boolean)
        .join(" ");
      let to = span.to;
      if ((!O || !bar) && !insert) while (to < line.to && /[ \t]/.test(text[to] as string)) to += 1;
      // The caret goes where the notes were: before marks kept for the bar before, after marks
      // and fields kept for the bar that follows (before them when some were inside the run,
      // which the copy has too).
      const innerKept = run
        .slice(1)
        .some((segment) => segment.tokens.some((token) => keeper(token)));
      const offset = before.length ? 0 : innerKept ? bar.length : insert.length;
      carets.push({ at: span.from, offset });
      changes.push({ from: span.from, to, insert });
      removed.push({ from: span.from, to });
      at = last;
    }
  }
  // A tie left before what went, to a different note after it, goes too.
  for (const cut of removed) {
    const prior = structure.tokens.filter(({ token }) => token.to <= cut.from);
    const tie = prior.at(-1)?.token;
    if (tie?.kind !== "tie") continue;
    const note = [...prior].reverse().find(({ token }) => token.kind === "note")?.token;
    const next = structure.tokens.find(
      ({ token }) =>
        token.from >= cut.to &&
        token.kind === "note" &&
        !removed.some((each) => token.from >= each.from && token.from < each.to),
    )?.token;
    const pitch = (token?: MusicToken) =>
      token?.kind === "note" ? `${token.accidental}${token.letter}${token.octave}` : "";
    if (pitch(note) !== pitch(next)) changes.push({ from: tie.from, to: tie.to, insert: "" });
  }
  // Whole bars only go when no tuplet is cut in two by them.
  if (splitTuplet(structure, removed))
    return { refused: "This would cut a tuplet in two: select all of its notes, or none." };
  // Notes of part of a bar: rests in their place (or gone, from an over-full bar).
  const rests = restChanges(
    text,
    file,
    resting.filter((each) => !each.event.rest),
  );
  changes.push(...rests.changes);
  if (rests.overFull)
    said.push("The bar was over-full: its notes went as long as it stays its length.");
  if (voicesKept)
    said.push(
      "Rests where not every voice is selected, so the voices stay in step: select the same whole bars in every voice to take the time out.",
    );
  else if (rests.rested.size)
    said.push(
      "Notes replaced by rests, so the bar keeps its length: select whole bars to take the time out.",
    );
  // The notes that go, or become rests, take their syllables with them.
  const goneNotes = selectedNotes(text, selected, file)
    .filter(
      (each) =>
        each.whole &&
        !each.event.rest &&
        (inside(each.event.from, removed) ||
          resting.some((rest) => rest.event.from === each.event.from)),
    )
    .map((each) => each.event.from);
  changes.push(...lyricsFor(text, file, goneNotes, []));
  // Hairpins whole: an end moved onto a note left inside, or both ends gone.
  changes.push(
    ...hairpinsKept(
      text,
      file,
      (selected[0] as Range).from,
      [...removed, ...rests.vanished],
      rests.rested,
    ),
  );
  return finishCut(text, selected, file, changes, carets, said);
}

/** A cut's edit made: the text after it, its emptied lines dropped, as one change and a caret. */
function finishCut(
  text: string,
  selected: Range[],
  file: FileIndex,
  changes: Change[],
  carets: { at: number; offset: number }[],
  said: string[],
): CutPlan {
  // The edit, then the caret in the text after it.
  const fine = changes
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((change) => (change.insert ? change : { ...change, insert: apart(text, change) }));
  let after = text;
  for (const change of [...fine].reverse())
    after = after.slice(0, change.from) + change.insert + after.slice(change.to);
  const first = carets.sort((a, b) => a.at - b.at)[0] ?? {
    at: (selected[0] as Range).from,
    offset: 0,
  };
  let caret =
    fine
      .filter((change) => change.to <= first.at && change.from < first.at)
      .reduce((pos, change) => pos + change.insert.length - (change.to - change.from), first.at) +
    first.offset;
  // A music line left empty goes with its line break (a blank line would end the tune), and so
  // does one left with only plain bar lines after a line ending on one (a stray bar line).
  const lo = Math.min(...fine.map((change) => change.from));
  let hi =
    lo +
    fine.reduce(
      (sum, change) => sum + change.insert.length - (change.to - change.from),
      Math.max(...fine.map((change) => change.to)) - lo,
    );
  let lineFrom = after.lastIndexOf("\n", lo - 1) + 1;
  while (lineFrom <= hi && lineFrom < after.length) {
    let end = after.indexOf("\n", lineFrom) < 0 ? after.length : after.indexOf("\n", lineFrom);
    const content = after.slice(lineFrom, end);
    const previous = after.slice(0, lineFrom).replace(/\s+$/, "");
    // (A w: line whose syllables all went is empty too.)
    const empty = !content.trim() || /^w:\s*$/.test(content);
    const previousLine = after.slice(
      after.lastIndexOf("\n", lineFrom - 2) + 1,
      Math.max(0, lineFrom - 1),
    );
    // Only bar lines left (`|`, `:|`, `|]`): after a line ending on a bar line (their sign joins
    // it, so a final |] stays the music's end) or after no music, they go.
    const barsOnly =
      !empty &&
      tokenizeMusic(content, 0).every((token) => token.kind === "bar" || token.kind === "space");
    const previousBar = /(\[\||\|\]|:\|\]|:*\|+:*[0-9]*|:{2,})$/.exec(previous);
    const stray = barsOnly && (Boolean(previousBar) || lineKind(previousLine, true) !== "music");
    const touched = lineFrom <= hi && end >= lo;
    // (Never the blank line that keeps two tunes apart.)
    const separator = empty && !content && /^X:/.test(after.slice(end + 1));
    if (touched && !separator && (empty || stray) && lineKind(content, true) !== "field") {
      if (stray && previousBar) {
        const signs = tokenizeMusic(content, 0).filter(
          (token) => token.kind === "bar" && !PLAIN.test(token.text),
        );
        if (signs.length) {
          const joined = signs.reduce(
            (bar, sign) => joinBars(bar, sign.text),
            previousBar[1] as string,
          );
          const at = previous.length - (previousBar[1] as string).length;
          after = after.slice(0, at) + joined + after.slice(previous.length);
          const shift = joined.length - (previousBar[1] as string).length;
          lineFrom += shift;
          end += shift;
          hi += shift;
          if (caret > at) caret += shift;
        }
      }
      let to = end < after.length ? end + 1 : end;
      // A music line that goes takes its w: lines (their syllables were its notes').
      if (lineKind(content, true) !== "lyrics")
        while (after.startsWith("w:", to)) {
          const next = after.indexOf("\n", to);
          to = next < 0 ? after.length : next + 1;
        }
      const from = to === end && lineFrom > 0 ? lineFrom - 1 : lineFrom;
      after = after.slice(0, from) + after.slice(to);
      if (caret >= to) caret -= to - from;
      else if (caret > from) caret = from;
      // What follows moved up: the region the edit touched ends that much sooner.
      hi -= to - from;
      continue;
    }
    lineFrom = end + 1;
  }
  // As one change: from the first character that differs to the last.
  let start = 0;
  while (start < text.length && start < after.length && text[start] === after[start]) start += 1;
  let tail = 0;
  while (
    tail < text.length - start &&
    tail < after.length - start &&
    text[text.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const final = [
    { from: start, to: text.length - tail, insert: after.slice(start, after.length - tail) },
  ];
  const clip = selected.map((range) => copyText(text, range, file)).join("\n");
  return { changes: final, clip, caret, said };
}

/** Whether a copy holds a bar line. */
export function hasBars(clip: string): boolean {
  return clip
    .split("\n")
    .some((line) => tokenizeMusic(line, 0).some((token) => token.kind === "bar"));
}

/** The tokens of a place's line, and the ones just before and after a range on it. */
function around(text: string, range: Range) {
  const from = text.lastIndexOf("\n", range.from - 1) + 1;
  const to = text.indexOf("\n", range.to) < 0 ? text.length : text.indexOf("\n", range.to);
  const tokens = tokenizeMusic(text.slice(from, to), from).filter(
    (token) => token.kind !== "space",
  );
  return {
    tokens,
    before: tokens.filter((token) => token.to <= range.from).at(-1),
    after: tokens.find((token) => token.from >= range.to),
    lineTo: to,
  };
}

export type PasteFit = { changes: Change[]; said?: string } | { refused: string };

/**
 * What pasting music over a range writes, so the bars stay whole:
 * - whole bars (a copy ending in a bar line) go between bars: after notes they get a `| ` in
 *   front, before a bar line they lose their own, and pasted in the middle of a bar they go after
 *   it, said so; copied under another meter they take theirs and give the place's back after;
 * - a copy with no bar lines over a range holding some keeps them (like typing);
 * - never inside a tuplet, which would change its notes.
 * Null when the editor's own paste does just the same.
 */
export function pasteKeepingBars(
  text: string,
  ranges: Range[],
  clip: string,
  file: FileIndex = indexFile(text),
  source: { meter: string } | null = null,
): PasteFit | null {
  const music = ranges.every(
    (range) =>
      (range.from === range.to &&
        file.tunes.some((tune) => range.from >= tune.bodyFrom && range.from <= tune.to)) ||
      inMusic(text, [range], file),
  );
  if (!music) return null;
  for (const range of ranges) {
    const structure = structureOf(text, file, range.from);
    if (range.to > range.from && splitTuplet(structure, [range]))
      return {
        refused:
          "Pasting over part of a tuplet would leave it short: select all of its notes, or none.",
      };
    const within = structure.tuplets.find(
      ({ notes }) =>
        notes.length > 1 &&
        range.from > (notes[0] as number) &&
        range.from <= (notes.at(-1) as number),
    );
    if (within)
      return {
        refused: "Pasting inside a tuplet would change its notes: paste before or after it.",
      };
  }
  if (!hasBars(clip)) {
    if (ranges.every((range) => range.from === range.to)) return null;
    const kept = replaceKeepingBars(text, ranges, clip, file);
    return kept && !("refused" in kept) ? { changes: kept } : null;
  }
  const whole = /\|[ \t]*$/.test(clip);
  let said: string | undefined;
  let changed = false;
  const holdsRepeat = tokenizeMusic(clip.replace(/\n/g, " "), 0).some(
    (token) =>
      token.kind === "bar" && (barParts(token.text).start > 0 || barParts(token.text).end > 0),
  );
  const changes = ranges.map((range) => {
    let place = { ...range };
    // A single clicked note: the bars go in at it, as at a caret.
    if (whole && place.to > place.from) {
      const one = selectedNotes(text, [place], file);
      if (one.length === 1)
        place = { from: (one[0] as Picked).span.from, to: (one[0] as Picked).span.from };
    }
    let { before, after, lineTo } = around(text, place);
    const notes = (token?: MusicToken) =>
      Boolean(token) &&
      token?.kind !== "bar" &&
      !(keeper(token as MusicToken) && leads(token as MusicToken));
    // A mark of the bar line before (D.S., Fine) with the bar line after it: as the bar line.
    const barLater = (from: Range, next?: MusicToken) =>
      next?.kind === "bar"
        ? next
        : next && keeper(next) && !leads(next)
          ? around(text, from).tokens.find(
              (token) => token.from >= next.to && !(keeper(token) && !leads(token)),
            )
          : undefined;
    if (
      whole &&
      place.from !== place.to &&
      (notes(before) || (after && barLater(place, after)?.kind !== "bar"))
    ) {
      // Over part of a bar: replacing it would leave the bar short. After it, as from a caret
      // (after a repeat's sign or an ending's, not inside the repeat).
      const next = around(text, place).tokens.find(
        (token) => token.from >= place.to && token.kind === "bar",
      );
      const at = next ? (PLAIN.test(next.text) ? next.from : next.to) : lineTo;
      place = { from: at, to: at };
      ({ before, after } = around(text, place));
      said =
        "Pasted the bars after the bar the selection is in, so no bar is short; the selection was left as it was.";
    } else if (
      whole &&
      place.from === place.to &&
      notes(before) &&
      after &&
      barLater(place, after)?.kind !== "bar"
    ) {
      // In the middle of a bar: after it (after a repeat's sign, not inside the repeat).
      const next = around(text, place).tokens.find(
        (token) => token.from >= place.to && token.kind === "bar",
      );
      const at = next ? (PLAIN.test(next.text) ? next.from : next.to) : lineTo;
      place = { from: at, to: at };
      ({ before, after } = around(text, place));
      said = "Pasted the bars after the bar the caret was in, so no bar is split.";
    }
    // A copy holding a repeat never goes inside another: before it (from its first note) or after
    // its last ending, said so, as Insert › Repeat refuses to nest.
    if (holdsRepeat) {
      const voice =
        tuneTokens(text, file, place.from)
          .filter(({ token }) => token.from <= place.from)
          .at(-1)?.voice ??
        file.tunes.find((tune) => place.from >= tune.from && place.from <= tune.to)?.voices[0]
          ?.id ??
        "1";
      const region = repeatsOf(text, file, place.from, voice).find(
        (each) => place.from > each.from && place.from < each.to,
      );
      if (region) {
        const lead = tokenizeMusic(text.slice(region.from, place.from), region.from).some((token) =>
          starts(token),
        );
        const at = lead ? region.to : region.from;
        place = { from: at, to: at };
        ({ before, after } = around(text, place));
        said = `Pasted ${lead ? "after" : "before"} the repeat (bars ${region.first}–${region.last}): a repeat can't go inside another.`;
      }
    }
    let insert = clip;
    const extra: Change[] = [];
    if (whole) {
      const barAfter = barLater(place, after);
      const lead = tokenizeMusic(insert, 0).find((token) => token.kind !== "space");
      let prefix = "";
      if (notes(before)) {
        if (lead?.kind !== "bar") prefix = "| ";
      } else if (lead?.kind === "bar" && before?.kind === "bar" && !PLAIN.test(lead.text)) {
        // A repeat's start against the bar line before: the two make one (`:|` `|:` is `::`).
        extra.push({ from: before.from, to: before.to, insert: joinBars(before.text, lead.text) });
        insert = insert.slice(lead.to).replace(/^[ \t]+/, "");
      } else if (lead?.kind === "bar" && before)
        insert = insert.slice(lead.to).replace(/^[ \t]+/, "");
      let closing = "";
      const trailing = tokenizeMusic(insert, 0)
        .filter((token) => token.kind !== "space")
        .at(-1);
      if (barAfter?.kind === "bar" && trailing?.kind === "bar" && !PLAIN.test(trailing.text)) {
        // A repeat's end against the next bar line: the two make one (`:|` `|:` is `::`).
        extra.push({
          from: barAfter.from,
          to: barAfter.to,
          insert: joinBars(trailing.text, barAfter.text),
        });
        insert = insert.slice(0, trailing.from).replace(/[ \t]+$/, "");
      } else if (barAfter?.kind === "bar") insert = insert.replace(/\|[ \t]*$/, "");
      else if (/\|$/.test(insert)) {
        insert = insert.replace(/\|$/, "");
        closing = "|";
      }
      // Bars copied under another meter keep theirs, and the place's comes back after them.
      const reading = readingAt(text, file, place.from);
      let opened = "";
      if (source?.meter && reading?.meter && reading.meter !== source.meter) {
        opened = `[M:${source.meter}] `;
        if (closing) closing = `${closing} [M:${reading.meter}]`;
        else if (barAfter)
          extra.push({ from: barAfter.to, to: barAfter.to, insert: ` [M:${reading.meter}]` });
      }
      insert = `${prefix}${opened}${insert}${closing}`;
      changed = changed || insert !== clip || place.from !== range.from || extra.length > 0;
    }
    return [{ from: place.from, to: place.to, insert }, ...extra];
  });
  if (!changed) return null;
  return { changes: changes.flat(), ...(said ? { said } : {}) };
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

/** The notes a range selects, as written: from its first note's marks to its last note's tie. */
function notesSpan(text: string, range: Range, file: FileIndex): Range | null {
  const picked = selectedNotes(text, [range], file);
  const first = picked[0];
  const last = picked[picked.length - 1];
  if (!first || !last) return null;
  let from = first.span.from;
  const lineFrom = text.lastIndexOf("\n", from - 1) + 1;
  const before = tokenizeMusic(text.slice(lineFrom, from), lineFrom).filter(
    (token) => token.kind !== "space",
  );
  // A tuplet sign that opens the first note.
  if (before.at(-1)?.kind === "tuplet") from = (before.at(-1) as MusicToken).from;
  // Marks of the bar line (a segno before the first note) stay where they are.
  const own = tokenizeMusic(text.slice(from, first.event.from), from).filter(
    (token) => token.kind !== "space",
  );
  for (const token of own) {
    if (!keeper(token)) break;
    from = token.to;
  }
  while (/[ \t]/.test(text[from] ?? "")) from += 1;
  return { from, to: last.span.to };
}

/** The bar line a body of whole bars ends at (across a D.S. or Fine before it), or null. */
function wholeBarsEnd(text: string, body: Range): MusicToken | null {
  const { tokens } = around(text, body);
  const lead = tokens.filter((token) => token.to <= body.from);
  const opened = lead.map((token) => token.kind).lastIndexOf("bar");
  if (lead.slice(opened + 1).some((token) => starts(token))) return null;
  const next = tokens.find((token) => token.from >= body.to && !(keeper(token) && !leads(token)));
  return next?.kind === "bar" ? next : null;
}

const pitchOf = (token?: MusicToken) =>
  token?.kind === "note" ? `${token.accidental}${token.letter}${token.octave}` : "";

/**
 * Duplicate: a copy of the selected notes (as Copy takes them: no half slur, no short tuplet, no
 * tie out of it) right after them, or the bar at the caret after it. Whole bars go in as bars,
 * after their bar line (a D.S. or Fine before it included); other notes go after the tuplet the
 * last of them is in. A tie on the last note is kept on the copy when it ties to the same note,
 * and the original's tie goes when the copy doesn't start on its note. A voice selected across
 * V: blocks is one passage, copied once after its end.
 */
/** What Duplicate does: its edit, where the copies went (to select them), what it says. */
export type DuplicatePlan =
  | { changes: Change[]; copies: Change[]; said: string[] }
  | { refused: string };

export function duplicate(
  text: string,
  ranges: Range[],
  file: FileIndex = indexFile(text),
): DuplicatePlan {
  // Duplicate copies music: a text selection across other voices' lines or lyrics is refused.
  if (ranges.some((range) => range.to > range.from && !inMusic(text, [range], file)))
    return {
      refused:
        "Duplicate copies one voice's music: this selection crosses other lines (voices, lyrics or fields). Select within one voice, or in each voice's music.",
    };
  const changes: Change[] = [];
  const copies: Change[] = [];
  const said: string[] = [];
  const passages = passagesOf(text, ranges, file).filter((passage) => passage.ranges.length > 1);
  const joined = new Set(passages.flatMap((passage) => passage.ranges));
  const times = timed(text, file, (ranges[0] as Range).from);
  const byFrom = new Map(times.map((each) => [each.from, each]));
  const selectedVoices = new Set(
    selectedNotes(
      text,
      ranges.filter((range) => range.to > range.from),
      file,
    ).map((each) => each.event.voice),
  );
  let refused: string | null = null;
  const place = (body: Range, bodies: Range[]) => {
    // Bars with a repeat's signs or an ending inside them aren't duplicated (their copy would
    // scramble the play order); a whole repeat is.
    for (const each of bodies) {
      const inner = tokenizeMusic(text.slice(each.from, each.to), each.from).filter(
        (token) => token.kind === "bar" && !/^\|\|?$/.test(token.text),
      );
      if (inner.length && !copyText(text, each, file).startsWith("|:")) {
        refused =
          "Bars with a repeat's sign or an ending inside them aren't duplicated: duplicate the bars before or after it, or the whole repeat.";
        return;
      }
    }
    const structure = structureOf(text, file, body.from);
    const pieces = bodies.map((each) => copyText(text, each, file).replace(/\s*\|$/, ""));
    const bar = wholeBarsEnd(text, body);
    const written = pieces
      .map(
        (piece, at) =>
          piece + (at < bodies.length - 1 && wholeBarsEnd(text, bodies[at] as Range) ? "|" : ""),
      )
      .join(" ");
    // The notes duplicated: their time, and their syllables to bring along.
    const notes = selectedNotes(text, bodies, file);
    const span = notes.map((each) => byFrom.get(each.event.from)).filter(Boolean) as typeof times;
    const start = Math.min(...span.map((each) => each.start));
    const end = Math.max(...span.map((each) => each.end));
    let insertAt: number;
    let insert: string;
    const lineStart = text.lastIndexOf("\n", (bodies[0] as Range).from - 1) + 1;
    const lineEnd = bar
      ? text.indexOf("\n", bar.to) < 0
        ? text.length
        : text.indexOf("\n", bar.to)
      : -1;
    const wholeLines =
      bar &&
      bodies.length === 1 &&
      !tokenizeMusic(text.slice(lineStart, body.from), lineStart).some((token) => starts(token)) &&
      !text.slice(bar.to, lineEnd).trim();
    if (wholeLines) {
      // Whole lines: duplicated as new lines after them, their verses with them.
      const verses = versesUnder(text, lineEnd);
      const end = verses.at(-1)?.to ?? lineEnd;
      insertAt = end;
      insert = `\n${text.slice(lineStart, end)}`;
    } else if (bar) {
      const gap = /\s/.test(text[body.to] ?? "") ? " " : "";
      insertAt = body.to;
      insert = `${gap}|${gap}${written}`;
    } else {
      // After the tuplet the last note is in.
      let at = body.to;
      for (const { notes: inTuplet } of structure.tuplets)
        if (
          inTuplet.some((each) => each >= body.from && each < body.to) &&
          (inTuplet.at(-1) ?? 0) >= at
        ) {
          const last = structure.tokens.find(({ token }) => token.from === inTuplet.at(-1))?.token;
          const picked = last
            ? selectedNotes(text, [{ from: last.from, to: last.from + 1 }], file)[0]
            : undefined;
          at = Math.max(at, picked?.span.to ?? at);
        }
      // Ties: the last note's onto the copy's same note; the original's to the copy's first note.
      const tokens = structure.tokens.map(({ token }) => token);
      const inBody = tokens.filter((token) => token.from >= body.from && token.to <= at);
      const lastNote = [...inBody].reverse().find((token) => token.kind === "note");
      const tie = inBody.at(-1)?.kind === "tie" ? (inBody.at(-1) as MusicToken) : undefined;
      const firstNote = inBody.find((token) => token.kind === "note");
      const nextNote = tokens.find((token) => token.from >= at && token.kind === "note");
      insert = ` ${written}`;
      if (tie && pitchOf(nextNote) === pitchOf(lastNote)) insert += "-";
      if (tie && pitchOf(firstNote) !== pitchOf(lastNote))
        changes.push({ from: tie.from, to: tie.to, insert: "" });
      insertAt = at;
    }
    // The copy is written under the fields its notes were (a key or unit changed inside them is
    // in force after them, where it goes): those that differ there come first.
    const fromState = readingAt(text, file, (bodies[0] as Range).from);
    const thereState = readingAt(text, file, insertAt);
    if (fromState && thereState) {
      const fields: string[] = [];
      if (fromState.key.name !== thereState.key.name) fields.push(`[K:${keyLabel(fromState.key)}]`);
      if (fromState.unit.num * thereState.unit.den !== thereState.unit.num * fromState.unit.den)
        fields.push(`[L:${fromState.unit.num}/${fromState.unit.den}]`);
      if (fromState.meter !== thereState.meter) fields.push(`[M:${fromState.meter}]`);
      if (fields.length) {
        const lead = /^(\s*\|?\s*)/.exec(insert)?.[1] ?? "";
        insert = `${lead}${fields.join("")} ${insert.slice(lead.length)}`;
      }
    }
    const copy = { from: insertAt, to: insertAt, insert };
    changes.push(copy);
    copies.push(copy);
    // The copy's syllables, after the last duplicated note's (whole lines brought their own).
    if (!wholeLines)
      changes.push(
        ...lyricsAlong(
          text,
          file,
          notes.filter((each) => !each.event.rest).map((each) => each.event.from),
        ),
      );
    // The other voices sounding then get rests as long, at the same point, to stay in step.
    if (!Number.isFinite(start)) return;
    const others = [
      ...new Set(
        times
          .filter((each) => each.start < end - 1e-9 && each.end > start + 1e-9)
          .map((each) => each.voice),
      ),
    ].filter((voice) => !selectedVoices.has(voice));
    for (const voice of others) {
      const ending = times.find((each) => each.voice === voice && Math.abs(each.end - end) < 1e-9);
      if (!ending) {
        refused = `V:${voice} has a note sounding across where the copy would go: select that voice too, to duplicate in every voice.`;
        return;
      }
      const after = selectedNotes(text, [{ from: ending.from, to: ending.from + 1 }], file)[0];
      const at = after?.span.to ?? ending.to;
      const reading = readingAt(text, file, at);
      const unit = reading?.unit ?? frac(1, 8);
      const letter = restLetter(text, file, voice, at);
      const rest = (whole: number) => {
        const units = whole / (unit.num / unit.den);
        const den =
          [1, 2, 4, 8, 16, 3, 6, 12].find(
            (each) => Math.abs(units * each - Math.round(units * each)) < 1e-9,
          ) ?? 1;
        return `${letter}${formatLength(frac(Math.round(units * den), den))}`;
      };
      // Whole bars: a bar of rests for each; else one rest as long as the notes.
      const lengths: number[] = [];
      if (bar)
        // Each duplicated bar's length, block by block.
        for (const each of bodies) {
          const lines = tokenizeMusic(text.slice(each.from, each.to), each.from).filter(
            (token) => token.kind === "bar",
          );
          let last = each.from;
          for (const line of [...lines, { from: each.to }]) {
            const inside = span.filter((note) => note.from >= last && note.from < line.from);
            const length = inside.reduce((sum, note) => sum + note.end - note.start, 0);
            if (length > 0) lengths.push(length);
            last = line.from;
          }
        }
      else lengths.push(end - start);
      const gap = /\s/.test(text[at] ?? "") ? " " : "";
      changes.push({
        from: at,
        to: at,
        insert: bar ? `${gap}|${gap}${lengths.map(rest).join(" | ")}` : ` ${rest(end - start)}`,
      });
    }
    if (others.length)
      said.push(
        `Duplicated in ${[...selectedVoices].map((voice) => `V:${voice}`).join(" and ")}; rests in ${others.map((voice) => `V:${voice}`).join(" and ")} keep ${others.length === 1 ? "it" : "them"} in step.`,
      );
  };
  for (const passage of passages) {
    const bodies = passage.ranges
      .map((range) => notesSpan(text, range, file))
      .filter((body): body is Range => Boolean(body));
    const end = bodies[bodies.length - 1];
    if (end) place(end, bodies);
  }
  for (const range of ranges) {
    if (joined.has(range)) continue;
    if (range.from === range.to) {
      const target = barAround(text, range.from);
      const body = text.slice(target.from, target.to);
      const glue = /\s$/.test(body) ? "" : " ";
      const copy = { from: target.to, to: target.to, insert: `${glue}${body}` };
      changes.push(copy);
      copies.push(copy);
      continue;
    }
    const body = notesSpan(text, range, file);
    if (body) place(body, [body]);
  }
  if (refused) return { refused };
  return { changes, copies, said };
}

/** The syllables of some notes, put again after the last one's (for their copy). */
function lyricsAlong(text: string, file: FileIndex, notes: number[]): Change[] {
  const first = notes[0];
  if (first === undefined) return [];
  const from = text.lastIndexOf("\n", first - 1) + 1;
  const to = text.indexOf("\n", first) < 0 ? text.length : text.indexOf("\n", first);
  if (notes.some((each) => each >= to)) return [];
  const line = selectedNotes(text, [{ from, to }], file)
    .filter((each) => !each.event.rest && each.event.from >= from && each.event.from < to)
    .map((each) => each.event.from);
  const indices = notes.map((each) => line.indexOf(each)).filter((each) => each >= 0);
  // Each verse brings its own syllables of those notes.
  const changes: Change[] = [];
  for (const verse of versesUnder(text, to)) {
    const slots = lyricSlots(text.slice(verse.from, verse.to), verse.from);
    const own = indices.map((index) => slots[index]).filter(Boolean) as Range[];
    const last = own.at(-1);
    if (!last) continue;
    // Syllables of one word stay joined by their hyphen.
    const words = own
      .map((slot) => text.slice(slot.from, slot.to).trim())
      .map((word, at, all) => (at < all.length - 1 && !/-$/.test(word) ? `${word} ` : word))
      .join("");
    changes.push({
      from: last.to,
      to: last.to,
      insert: `${/-$/.test(text.slice(last.from, last.to)) ? "" : " "}${words}${/\s/.test(text[last.to] ?? "") ? "" : " "}`,
    });
  }
  return changes;
}

/** Each voice's events with their written start and end, in whole notes. */
function timed(text: string, file: FileIndex, at: number) {
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  const out: { voice: string; from: number; to: number; start: number; end: number }[] = [];
  if (!tune) return out;
  const clocks = new Map<string, number>();
  for (const item of tuneItems(text, tune, file)) {
    if (item.type !== "event") continue;
    const start = clocks.get(item.voice) ?? 0;
    const end = start + item.duration.num / item.duration.den;
    clocks.set(item.voice, end);
    out.push({ voice: item.voice, from: item.from, to: item.to, start, end });
  }
  return out;
}

/**
 * Insert › Bar line over a selection in several voices: one in each selected voice at the same
 * point, the end of the main range's last note. Refused when a voice has a note sounding across
 * that point. Null for a selection in one voice (the bar line goes after it).
 */
export function barLinesAcross(
  text: string,
  ranges: Range[],
  main: number,
  file: FileIndex = indexFile(text),
): Change[] | { refused: string } | null {
  const selected = ranges.filter((range) => range.to > range.from);
  const picked = selectedNotes(text, selected, file);
  const voices = [...new Set(picked.map((each) => each.event.voice))];
  if (voices.length < 2) return null;
  const mainRange = ranges[main]?.to !== ranges[main]?.from ? ranges[main] : selected.at(-1);
  const events = timed(text, file, (selected[0] as Range).from);
  const own = events.filter(
    (each) => mainRange && each.from >= mainRange.from && each.from < mainRange.to,
  );
  const time = own.at(-1)?.end;
  if (time === undefined) return null;
  const changes: Change[] = [];
  for (const voice of voices) {
    const ends = events.filter((each) => each.voice === voice);
    const at = ends.find((each) => Math.abs(each.end - time) < 1e-9);
    if (!at) {
      const across = ends.find((each) => each.start < time - 1e-9 && each.end > time + 1e-9);
      return {
        refused: `V:${voice} has ${across ? "a note sounding" : "no note ending"} where the bar line would go: shorten or split it there first, or select one voice.`,
      };
    }
    const after = selectedNotes(text, [{ from: at.from, to: at.from + 1 }], file)[0];
    changes.push(barLine(text, after?.span.to ?? at.to));
  }
  return changes;
}

/**
 * Insert › Second voice: a new bass voice of rests, bar for bar with the first voice (a pickup's
 * rest as long as the pickup, a bar under another meter as long as that bar), in the tune's unit,
 * added to %%score (or %%staves) when the tune has one.
 */
export function newVoice(
  text: string,
  at: number,
  file: FileIndex = indexFile(text),
): {
  changes: Change[];
  at: number;
  offset: number;
  first: number;
  rests: number[];
  said: string;
} | null {
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  if (!tune) return null;
  const ids = tune.voices.map((voice) => voice.id);
  const next = String(ids.length ? Math.max(0, ...ids.map((id) => Number(id) || 0)) + 1 : 2);
  const unit = parseUnit(tune.unit) ?? defaultUnit(tune.meter);
  const items = tuneItems(text, tune, file);
  const first = items.find((item) => item.type === "event")?.voice;
  const bars: number[] = [];
  let length = 0;
  let any = false;
  for (const item of items) {
    if (item.voice !== first) continue;
    if (item.type === "bar") {
      if (any) bars.push(length);
      length = 0;
      any = false;
    } else {
      length += item.duration.num / item.duration.den;
      any = true;
    }
  }
  if (any) bars.push(length);
  if (!bars.length)
    bars.push(
      meterLength(tune.meter)
        ? (meterLength(tune.meter) as Fraction).num / (meterLength(tune.meter) as Fraction).den
        : 1,
    );
  const rest = (whole: number) => {
    // In the unit: whole / unit, as a fraction of small numbers.
    const units = whole / (unit.num / unit.den);
    const den =
      [1, 2, 4, 8, 16, 3, 6, 12].find(
        (each) => Math.abs(units * each - Math.round(units * each)) < 1e-9,
      ) ?? 1;
    return `z${formatLength(frac(Math.round(units * den), den))}`;
  };
  const lines: string[] = [];
  for (let start = 0; start < bars.length; start += 4)
    lines.push(
      `${bars
        .slice(start, start + 4)
        .map(rest)
        .join(" | ")} |`,
    );
  const doc = text;
  const lead = doc.slice(0, tune.to).endsWith("\n") ? "" : "\n";
  const addition = `${lead}V:${next} clef=bass\n${lines.join("\n")}\n`;
  const changes: Change[] = [{ from: tune.to, to: tune.to, insert: addition }];
  if (!ids.length) changes.push({ from: tune.bodyFrom, to: tune.bodyFrom, insert: "V:1\n" });
  const score = /^%%(score|staves)(.*)$/m.exec(doc.slice(tune.from, tune.bodyFrom));
  let said = `Added V:${next}, a bass voice of ${bars.length} ${bars.length === 1 ? "bar" : "bars"} of rests, bar for bar with the first voice.`;
  if (score) {
    const lineEnd = tune.from + (score.index ?? 0) + score[0].length;
    changes.push({ from: lineEnd, to: lineEnd, insert: ` ${next}` });
    said += ` It is on its own staff in %%${score[1]}.`;
  } else if (ids.length > 1) said += " Each voice has its own staff (the tune has no %%score).";
  // The first rest selected (typing over the rests writes the voice bar by bar), and where each
  // rest is, from the voice's first line.
  const restsAt: number[] = [];
  let offset = lead.length + `V:${next} clef=bass\n`.length;
  for (const line of lines) {
    for (const match of line.matchAll(/z[0-9/]*/g)) restsAt.push(offset + (match.index ?? 0));
    offset += line.length + 1;
  }
  return {
    changes,
    at: tune.to,
    offset: lead.length + `V:${next} clef=bass\n`.length,
    first: rest(bars[0] as number).length,
    rests: restsAt,
    said,
  };
}

/*
 * Voices kept in step (as MuseScore does): in a tune with several voices, deleting notes in some
 * of them only leaves rests as long as the notes, and time goes only when every voice sounding
 * then is selected.
 */

/** A rest as long as an event is written ("z2", "z/"), its tuplet or broken rhythm kept around it. */
function restFor(text: string, event: { from: number; to: number }): string {
  const tokens = tokenizeMusic(text.slice(event.from, event.to), event.from);
  const head = tokens.find((token) => token.kind !== "space");
  if (head?.kind === "rest") return head.text;
  if (head?.kind === "note") return `z${head.length}`;
  const close = tokens.find((token) => token.kind === "chord-close");
  const inner = tokens.find((token) => token.kind === "note") as { length?: string } | undefined;
  return `z${close?.length || inner?.length || ""}`;
}

/**
 * Rests for a stretch of a bar, as notation programs write them (round 8, rule (b)): a whole bar
 * is one rest; else, from the stretch's start (`at`, in whole notes from the bar's start), the
 * longest plain or dotted value that fits and keeps to the beat: within one beat, or whole beats
 * from a beat its own length divides (a half rest on beat 1 or 3 of 4/4, never on 2).
 */
export function restPieces(at: number, length: number, beat: number, whole: boolean): number[] {
  const eps = 1e-9;
  if (whole) return [length];
  const pieces: number[] = [];
  let position = at;
  const end = at + length;
  const near = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
  while (end - position > eps) {
    const left = end - position;
    const fits = VALUES.find((value) => {
      if (value > left + eps) return false;
      if (value < beat - eps)
        return Math.floor((position + eps) / beat) === Math.floor((position + value - eps) / beat);
      return near(position / beat) && near(value / beat) && near(position / value);
    });
    const piece = fits ?? Math.min(left, VALUES.find((value) => value <= left + eps) ?? left);
    pieces.push(piece);
    position += piece;
  }
  return pieces;
}

/**
 * Notes deleted where time can't go (less than whole bars, or some voices only), bar by bar:
 * - in an over-full bar, notes simply go while the bar stays at least its length, and the one
 *   that would take it short leaves a rest of the shortfall;
 * - the rest become rests, written as notation programs write them (./restPieces), merged with
 *   the rests beside them: a bar cleared is one rest, a tuplet or a broken pair (`G>A`) deleted
 *   whole is one rest of its real length;
 * - never merged across a tuplet left, a chord symbol, a dynamic, a text or a fermata (each stays
 *   on its rest), or a bar line;
 * - a voice of spacers (`x`) gets spacers.
 * Their articulations and ties go (hairpins: ./hairpinsKept). Returns the changes, the notes
 * that went (`vanished`) and those made rests (`rested`).
 */
type RestPlan = { changes: Change[]; vanished: Range[]; rested: Set<number>; overFull: boolean };
function restChanges(text: string, file: FileIndex, picked: Picked[]): RestPlan {
  const plan: RestPlan = { changes: [], vanished: [], rested: new Set(), overFull: false };
  if (!picked.length) return plan;
  const at = (picked[0] as Picked).event.from;
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  if (!tune) return plan;
  const structure = structureOf(text, file, at);
  const chosen = new Set(picked.map((each) => each.event.from));
  const spans = new Map(
    selectedNotes(text, [{ from: tune.bodyFrom, to: tune.to }], file).map((each) => [
      each.event.from,
      each,
    ]),
  );
  // Each voice's bars, with their events.
  type Event = {
    from: number;
    to: number;
    span: Range;
    length: number;
    rest: string | null;
    unit: Fraction;
  };
  type Bar = { events: Event[]; meter: string; first: boolean };
  const voices = new Map<string, Bar[]>();
  for (const item of tuneItems(text, tune, file)) {
    const bars = voices.get(item.voice) ?? [];
    voices.set(item.voice, bars);
    let bar = bars[bars.length - 1];
    if (item.type === "bar") {
      if (bar?.events.length) bars.push({ events: [], meter: item.meter, first: false });
      continue;
    }
    if (!bar) {
      bar = { events: [], meter: item.meter, first: true };
      bars.push(bar);
    }
    const head = tokenizeMusic(text.slice(item.from, item.to), item.from).find(
      (token) => token.kind !== "space",
    );
    bar.events.push({
      from: item.from,
      to: item.to,
      span: spans.get(item.from)?.span ?? item,
      length: item.duration.num / item.duration.den,
      rest: item.rest && head?.kind === "rest" ? (head.text[0] as string) : null,
      unit: item.unit,
    });
  }
  const tupletOf = new Map<number, (typeof structure.tuplets)[number]>();
  for (const tuplet of structure.tuplets)
    for (const note of tuplet.notes) tupletOf.set(note, tuplet);
  const marked = (from: number, to: number) =>
    tokenizeMusic(text.slice(from, to), from).some((token) => restKeeps(token));
  const dropMarks = (from: number, to: number) => {
    for (const token of tokenizeMusic(text.slice(from, to), from))
      if (token.kind !== "space" && !restKeeps(token))
        plan.changes.push({ from: token.from, to: token.to, insert: "" });
  };
  const dropTies = (from: number, to: number) => {
    for (const token of tokenizeMusic(text.slice(from, to), from))
      if (token.kind === "tie") plan.changes.push({ from: token.from, to: token.to, insert: "" });
  };
  const eps = 1e-9;
  for (const bars of voices.values())
    bars.forEach((bar, index) => {
      if (!bar.events.some((each) => chosen.has(each.from))) return;
      // The bar's units: a note, chord or rest; a tuplet or broken pair taken whole is one.
      type Unit = {
        from: number;
        /** Where its marks start (a chord symbol, a dynamic…), before `from`. */
        lead: number;
        to: number;
        /** Its end with ties and the like after it. */
        end: number;
        length: number;
        picked: boolean;
        rest: string | null;
        /** Left as it is in place (a note in a tuplet kept, a broken rhythm's half). */
        fixed: boolean;
        members: number[];
        unit: Fraction;
      };
      const units: Unit[] = [];
      for (let i = 0; i < bar.events.length; i++) {
        const event = bar.events[i] as Event;
        const picks = chosen.has(event.from);
        const tuplet = tupletOf.get(event.from);
        if (tuplet) {
          const all = tuplet.notes.every((note) => chosen.has(note));
          const own = bar.events.filter((each) => tuplet.notes.includes(each.from));
          if (all && own.length === tuplet.notes.length && tuplet.notes[0] === event.from) {
            const last = own[own.length - 1] as Event;
            units.push({
              from: tuplet.sign.from,
              lead: tuplet.sign.from,
              to: last.span.to,
              end: last.span.to,
              length: own.reduce((sum, each) => sum + each.length, 0),
              picked: true,
              rest: null,
              fixed: false,
              members: own.map((each) => each.from),
              unit: event.unit,
            });
            i += own.length - 1;
            continue;
          }
          units.push({
            from: event.from,
            lead: event.span.from,
            to: event.to,
            end: event.span.to,
            length: event.length,
            picked: picks,
            rest: event.rest,
            fixed: true,
            members: [event.from],
            unit: event.unit,
          });
          continue;
        }
        const broken = tokenizeMusic(text.slice(event.to, event.span.to), event.to).some(
          (token) => token.kind === "broken",
        );
        const next = bar.events[i + 1];
        if (broken && next && picks && chosen.has(next.from) && !tupletOf.has(next.from)) {
          units.push({
            from: event.from,
            lead: event.span.from,
            to: next.to,
            end: next.span.to,
            length: event.length + next.length,
            picked: true,
            rest: null,
            fixed: false,
            members: [event.from, next.from],
            unit: event.unit,
          });
          i += 1;
          continue;
        }
        const previousBroken =
          i > 0 &&
          tokenizeMusic(
            text.slice((bar.events[i - 1] as Event).to, (bar.events[i - 1] as Event).span.to),
            (bar.events[i - 1] as Event).to,
          ).some((token) => token.kind === "broken");
        units.push({
          from: event.from,
          lead: event.span.from,
          to: event.to,
          end: event.span.to,
          length: event.length,
          picked: picks,
          rest: event.rest,
          fixed: broken || previousBroken,
          members: [event.from],
          unit: event.unit,
        });
      }
      // Over-full: notes go while the bar stays its length.
      const meter = meterLength(bar.meter);
      const full = meter ? meter.num / meter.den : null;
      const total = units.reduce((sum, unit) => sum + unit.length, 0);
      let spare = full !== null ? Math.max(0, total - full) : 0;
      const gone = new Set<Unit>();
      for (const unit of units) {
        if (spare <= eps || !unit.picked || unit.fixed) continue;
        plan.overFull = true;
        if (unit.length <= spare + eps) {
          gone.add(unit);
          spare -= unit.length;
          dropMarks(unit.lead, unit.from);
          // (One space of the two around it goes with it.)
          const space = /\s/.test(text[unit.lead - 1] ?? "") && /[ \t]/.test(text[unit.end] ?? "");
          plan.changes.push({ from: unit.from, to: unit.end + (space ? 1 : 0), insert: "" });
          plan.vanished.push({ from: unit.from, to: unit.end });
        } else {
          unit.length -= spare;
          spare = 0;
        }
      }
      // A voice of spacers keeps them: its own rests' letter, or its neighbouring bars'.
      const letterOf = (around: Bar | undefined) => {
        const rests = around?.events ?? [];
        return rests.length && rests.every((each) => each.rest === "x") ? "x" : null;
      };
      const letter = letterOf(bars[index - 1]) ?? letterOf(bars[index + 1]) ?? "z";
      // Runs of rests (picked, or there already) in the bar, then written as rests.
      const left = units.filter((unit) => !gone.has(unit));
      const kept = left.length;
      const startOf = new Map<Unit, number>();
      let clock = 0;
      for (const unit of left) {
        startOf.set(unit, clock);
        clock += unit.length;
      }
      // A short first bar (a pickup) keeps to the beat counted back from its end.
      const offset = bar.first && full !== null && clock < full - eps ? full - clock : 0;
      const beat = beatOf(bar.meter);
      let run: Unit[] = [];
      const write = () => {
        if (!run.some((unit) => unit.picked)) {
          run = [];
          return;
        }
        const first = run[0] as Unit;
        const last = run[run.length - 1] as Unit;
        const length = run.reduce((sum, unit) => sum + unit.length, 0);
        const own = run.find((unit) => unit.rest)?.rest ?? letter;
        const pieces = restPieces(
          (startOf.get(first) ?? 0) + offset,
          length,
          beat,
          run.length === kept,
        );
        const insert = pieces.map((piece) => `${own}${lengthText(piece, first.unit)}`).join(" ");
        dropMarks(first.lead, first.from);
        dropTies(last.to, last.end);
        if (insert !== text.slice(first.from, last.to))
          plan.changes.push({ from: first.from, to: last.to, insert });
        for (const unit of run) if (unit.picked) for (const at of unit.members) plan.rested.add(at);
        run = [];
      };
      for (const unit of left) {
        const restful = (unit.picked || unit.rest !== null) && !unit.fixed;
        if (!restful) {
          write();
          if (unit.picked) {
            // In place: a tuplet's note, a broken rhythm's half.
            dropMarks(unit.lead, unit.from);
            dropTies(unit.to, unit.end);
            plan.changes.push({
              from: unit.from,
              to: unit.to,
              insert: restFor(text, unit),
            });
            for (const at of unit.members) plan.rested.add(at);
          }
          continue;
        }
        // A mark that stays (a chord symbol, a dynamic…) starts its own rest.
        if (run.length && marked(unit.lead, unit.from)) write();
        run.push(unit);
      }
      write();
    });
  return plan;
}

/** A length in whole notes as written under a unit ("2", "3/2"). */
function lengthText(whole: number, unit: Fraction): string {
  return restOf(whole, unit).slice(1);
}

/**
 * Delete or Cut over notes in some voices only, in a tune with several: the notes become rests
 * of the same length (their marks and ties go, a broken rhythm or tuplet around them stays), so
 * the voices stay in step. Null when every voice sounding there is selected (time can go).
 */
/**
 * In a tune with several voices, the selected notes whose time can go: those where every voice
 * sounding then is selected too (each of its events over that time). Null with one voice (all).
 */
function timeCanGo(text: string, selected: Range[], file: FileIndex): Set<number> | null {
  const times = timed(text, file, (selected[0] as Range).from);
  if (new Set(times.map((each) => each.voice)).size < 2) return null;
  const picked = new Set(
    selectedNotes(text, selected, file)
      .filter((each) => each.whole)
      .map((each) => each.event.from),
  );
  const out = new Set<number>();
  for (const each of times) {
    if (!picked.has(each.from)) continue;
    const over = times.filter(
      (other) => other.start < each.end - 1e-9 && other.end > each.start + 1e-9,
    );
    if (over.every((other) => picked.has(other.from))) out.add(each.from);
  }
  return out;
}

function restsInstead(text: string, selected: Range[], file: FileIndex): CutPlan | null {
  const picked = selectedNotes(text, selected, file).filter(
    (each) => each.whole && !each.event.rest,
  );
  if (!picked.length) return null;
  const times = timed(text, file, (selected[0] as Range).from);
  const voices = new Set(times.map((each) => each.voice));
  if (voices.size < 2) return null;
  const at = new Map(times.map((each) => [each.from, each]));
  const chosenVoices = new Set(picked.map((each) => each.event.voice));
  const from = Math.min(...picked.map((each) => at.get(each.event.from)?.start ?? 0));
  const to = Math.max(...picked.map((each) => at.get(each.event.from)?.end ?? 0));
  const sounding = new Set(
    times
      .filter((each) => each.start < to - 1e-9 && each.end > from + 1e-9)
      .map((each) => each.voice),
  );
  // Time goes where every voice sounding then is selected (whole bars of each, then; the others
  // become rests in the main path); none: rests throughout.
  if ((timeCanGo(text, selected, file)?.size ?? 1) > 0) return null;
  const rests = restChanges(text, file, picked);
  const changes = rests.changes;
  const left = [...sounding]
    .filter((voice) => !chosenVoices.has(voice))
    .map((voice) => `V:${voice}`);
  const lyrics = lyricsFor(
    text,
    file,
    picked.map((each) => each.event.from),
    [],
  );
  const all = [
    ...changes,
    ...lyrics,
    ...hairpinsKept(text, file, (selected[0] as Range).from, rests.vanished, rests.rested),
  ].sort((a, b) => a.from - b.from);
  return {
    changes: all,
    clip: selected.map((range) => copyText(text, range, file)).join("\n"),
    caret: (picked[0] as (typeof picked)[number]).event.from,
    said: [
      left.length
        ? `Rests in place of the notes, so ${[...chosenVoices].map((voice) => `V:${voice}`).join(" and ")} stay${chosenVoices.size === 1 ? "s" : ""} in step with ${left.join(" and ")}: select every voice there to take the time out.`
        : "Rests in place of the notes, so the voices stay in step: select the same whole bars in every voice to take the time out.",
    ],
  };
}

/** The note slots of a w: line: each syllable, `_` or `*` (or a skipping `-`), with its place. */
function lyricSlots(words: string, offset: number): Range[] {
  const slots: Range[] = [];
  let i = 0;
  while (i < words.length) {
    const char = words[i] as string;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const from = i;
    if (char === "_" || char === "*" || char === "-" || char === "|") {
      i++;
      if (char !== "|") slots.push({ from: offset + from, to: offset + i });
      continue;
    }
    while (i < words.length && !/[\s\-_*|]/.test(words[i] as string)) {
      if (words[i] === "\\" && words[i + 1] === "-") i++;
      i++;
    }
    if (words[i] === "-") i++;
    slots.push({ from: offset + from, to: offset + i });
  }
  return slots;
}

/**
 * The lyrics of notes that go: their syllables come out of the w: line under their music line,
 * so the words after them stay on their notes. `added` puts `*` placeholders (one each) where
 * notes come in: [position in the music line, how many].
 */
/** Every verse under a music line: each w: line right after it, one after another. */
function versesUnder(text: string, lineTo: number): Range[] {
  const verses: Range[] = [];
  let next = lineTo + 1;
  while (next < text.length && text.startsWith("w:", next)) {
    const end = text.indexOf("\n", next) < 0 ? text.length : text.indexOf("\n", next);
    verses.push({ from: next + 2, to: end });
    next = end + 1;
  }
  return verses;
}

export function lyricsFor(
  text: string,
  file: FileIndex,
  gone: number[],
  added: [number, number, (string[][] | undefined)?][],
): Change[] {
  const changes: Change[] = [];
  const lines = new Map<number, { from: number; to: number }>();
  for (const at of [...gone, ...added.map(([at]) => at)]) {
    const from = text.lastIndexOf("\n", at - 1) + 1;
    const to = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    lines.set(from, { from, to });
  }
  for (const line of lines.values())
    for (const [verseIndex, verse] of versesUnder(text, line.to).entries()) {
      const wordsTo = verse.to;
      const slots = lyricSlots(text.slice(verse.from, verse.to), verse.from);
      const notes = selectedNotes(text, [{ from: line.from, to: line.to }], file)
        .filter(
          (each) => !each.event.rest && each.event.from >= line.from && each.event.from < line.to,
        )
        .map((each) => each.event.from);
      notes.forEach((note, index) => {
        const slot = slots[index];
        // The syllable and what separates it from the next.
        const next = slots[index + 1];
        if (slot && gone.includes(note))
          changes.push({ from: slot.from, to: next ? next.from : slot.to, insert: "" });
      });
      for (const [at, count, words] of added) {
        if (at < line.from || at > line.to) continue;
        const index = notes.filter((note) => note < at).length;
        const slot = slots[index];
        const place = slot ? slot.from : wordsTo;
        // The copy's own syllables for this verse, when it has them; else a `*` a note.
        const own = words?.[verseIndex];
        const syllables = own && own.length === count ? own : Array<string>(count).fill("*");
        changes.push({
          from: place,
          to: place,
          insert: `${slot ? "" : " "}${syllables.join(" ")}${slot ? " " : ""}`,
        });
      }
    }
  return changes;
}

/**
 * A copy of several music lines with their verses (w: lines), made one line for a music line
 * that has verses of its own: its lines joined with spaces (bar lines kept), and each verse's
 * syllables, line after line (a `*` a note where a line has none for it). Null for a copy of one
 * music line without verses, or with other fields in it.
 */
export function joinedClip(clip: string): { music: string; verses: string[][] } | null {
  const lines = clip.split("\n").filter((line) => line.trim());
  const groups: { music: string; verses: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith("w:")) {
      const last = groups[groups.length - 1];
      if (!last) return null;
      last.verses.push(line.slice(2));
    } else if (lineKind(line, true) === "music") groups.push({ music: line.trim(), verses: [] });
    else return null;
  }
  if (groups.length < 2 && !groups.some((group) => group.verses.length)) return null;
  const count = Math.max(0, ...groups.map((group) => group.verses.length));
  const verses: string[][] = [];
  for (let verse = 0; verse < count; verse++)
    verses.push(
      groups.flatMap((group) => {
        const notes = notesIn(group.music);
        const words = group.verses[verse] ?? "";
        const syllables = lyricSlots(words, 0)
          .map((slot) => words.slice(slot.from, slot.to))
          .slice(0, notes);
        return [...syllables, ...Array<string>(notes - syllables.length).fill("*")];
      }),
    );
  return { music: groups.map((group) => group.music).join(" "), verses };
}

/** How many notes (and chords) a copy holds: the syllables a paste of it needs. */
export function notesIn(clip: string): number {
  return clip
    .split("\n")
    .filter((line) => !/^[A-Za-z]:/.test(line))
    .reduce(
      (sum, line) =>
        sum +
        tokenizeMusic(line, 0).filter(
          (token) =>
            (token.kind === "note" && !token.inGrace && !token.inChord) ||
            token.kind === "chord-open",
        ).length,
      0,
    );
}

/**
 * The repeats a voice already has, each from its start (`|:`, or the tune's start) to the end of
 * its last ending, with its bars (numbered from 1).
 */
export function repeatsOf(
  text: string,
  file: FileIndex,
  at: number,
  voice: string,
): { from: number; to: number; first: number; last: number }[] {
  const tokens = tuneTokens(text, file, at).filter((each) => each.voice === voice);
  const regions: { from: number; to: number; first: number; last: number }[] = [];
  let bar = 1;
  let music = false;
  let start = { at: tokens[0]?.token.from ?? 0, bar: 1 };
  // After a repeat's end: whether its endings follow, and whether one is under way.
  let after = false;
  let ending = false;
  for (const { token } of tokens) {
    if (token.kind !== "bar") {
      if (starts(token)) music = true;
      continue;
    }
    if (music) bar += 1;
    music = false;
    const parts = barParts(token.text);
    const region = regions[regions.length - 1];
    if (after && region) {
      if (parts.ending) ending = true;
      if (ending) {
        region.to = token.to;
        region.last = bar - 1;
      }
      const section = parts.body === "|]" || parts.body === "||" || parts.start > 0;
      if (!ending || section || (parts.end && !parts.ending)) {
        if (!parts.end) after = false;
        ending = false;
      }
    }
    if (parts.end && !(after && ending)) {
      regions.push({ from: start.at, to: token.to, first: start.bar, last: bar - 1 });
      after = true;
      ending = Boolean(parts.ending);
    }
    if (parts.start) start = { at: token.from, bar };
    else if (parts.end) start = { at: token.to, bar };
  }
  return regions;
}

/** How long a copy lasts under a unit and meter, in whole notes, and each of its bars. */
function clipTiming(
  clip: string,
  unit: Fraction,
  meter: string,
): { total: number; bars: number[] } {
  const body = clip
    .split("\n")
    .filter((line) => !/^[A-Za-z]:/.test(line))
    .join("\n");
  const mini = `X:1\nM:${meter || "none"}\nL:${unit.num}/${unit.den}\nK:C\n${body}\n`;
  const file = indexFile(mini);
  const bars: number[] = [0];
  for (const item of tuneItems(mini, file.tunes[0] as TuneInfo, file)) {
    if (item.type === "bar") bars.push(0);
    else
      bars[bars.length - 1] = (bars[bars.length - 1] ?? 0) + item.duration.num / item.duration.den;
  }
  const filled = bars.filter((each) => each > 1e-9);
  return { total: filled.reduce((sum, each) => sum + each, 0), bars: filled };
}

/**
 * The rest a voice writes at a place (round 8, rule (d)): `x` where the voice is spacers there
 * (the event before or after it is an `x` rest), else `z`.
 */
export function restLetter(text: string, file: FileIndex, voice: string, at: number): "x" | "z" {
  const own = timed(text, file, at).filter((each) => each.voice === voice);
  const spacer = (event?: { from: number; to: number }) =>
    Boolean(event) && /^x/.test(text.slice(event?.from, event?.to).trimStart());
  const before = own.filter((each) => each.from < at).at(-1);
  const after = own.find((each) => each.from >= at);
  return spacer(before) || spacer(after) ? "x" : "z";
}
const lettered = (rest: string, letter: "x" | "z") =>
  letter === "x" ? rest.replace(/^z/, "x") : rest;

/** A rest as long as some whole notes, in a unit: "z8", "z3/2". */
function restOf(whole: number, unit: Fraction): string {
  const units = whole / (unit.num / unit.den);
  const den =
    [1, 2, 4, 8, 16, 3, 6, 12].find(
      (each) => Math.abs(units * each - Math.round(units * each)) < 1e-9,
    ) ?? 1;
  return `z${formatLength(frac(Math.round(units * den), den))}`;
}

/**
 * A paste into one voice of a tune with several keeps the voices in step, as MuseScore does:
 * - over a selection, it overwrites: whole bars over whole bars, bar for bar (rest bars for any
 *   the copy doesn't fill), or notes within one bar (a rest for the time left); a copy longer
 *   than the selection, or a selection across bars that isn't whole bars, is refused;
 * - at a caret or a single clicked note, it goes in, and the other voices get rests as long at
 *   the same point (or it is refused, naming a voice with a note sounding across it).
 * `insert` is the paste worked out for the place without this (the change ./paste would make).
 * Null in a tune with one voice.
 */
export function pasteInStep(
  text: string,
  file: FileIndex,
  range: Range,
  clip: string,
  insert: Change[],
): { changes: Change[]; said: string } | { refused: string } | null {
  const times = timed(text, file, range.from);
  const voices = [...new Set(times.map((each) => each.voice))];
  if (voices.length < 2) return null;
  const reading = readingAt(text, file, range.from);
  if (!reading) return null;
  const { total, bars } = clipTiming(clip, reading.unit, reading.meter);
  if (total < 1e-9) return null;
  const picked =
    range.to > range.from ? selectedNotes(text, [range], file).filter((each) => each.whole) : [];
  const voice =
    picked[0]?.event.voice ??
    tuneTokens(text, file, range.from)
      .filter(({ token }) => token.from <= range.from)
      .at(-1)?.voice ??
    (voices[0] as string);
  const byFrom = new Map(times.map((each) => [each.from, each]));
  const whole = /\|[ \t]*$/.test(clip);
  // A clicked note takes whole bars in at it; notes over it, from it, as over a selection.
  if (picked.length > 1 || (picked.length === 1 && !whole)) {
    // Over a selection: overwrite it.
    const first = picked[0] as Picked;
    const last = picked[picked.length - 1] as Picked;
    const start = byFrom.get(first.event.from)?.start ?? 0;
    const end = byFrom.get(last.event.from)?.end ?? start;
    const span = { from: first.span.from, to: last.span.to };
    const inner = tokenizeMusic(text.slice(span.from, span.to), span.from).filter(
      (token) => token.kind === "bar",
    );
    const body = clip.replace(/[ \t]*\|[ \t]*$/, "").trim();
    if (whole && copyText(text, range, file).endsWith("|")) {
      // Whole bars over whole bars: bar for bar.
      const selectedBars = inner.length + 1;
      if (bars.length > selectedBars)
        return {
          refused: `The copy is ${bars.length} bars and the selection ${selectedBars}: select ${bars.length} bars to paste over, or paste at a caret to put them in.`,
        };
      const lengths: number[] = [];
      let at = span.from;
      for (const bar of [...inner, { from: span.to, to: span.to }]) {
        const own = times.filter(
          (each) => each.voice === voice && each.from >= at && each.from < bar.from,
        );
        lengths.push(own.reduce((sum, each) => sum + each.end - each.start, 0));
        at = bar.to;
      }
      const rests = lengths.slice(bars.length).map((length) => restOf(length, reading.unit));
      return {
        changes: [{ ...span, insert: [body, ...rests].join(" | ") }],
        said: `Pasted over the selected bars in V:${voice}${rests.length ? `, rests in the ${rests.length === 1 ? "bar" : `${rests.length} bars`} the copy didn't fill` : ""}; the other voices are as they were.`,
      };
    }
    if (!inner.length && !/\|/.test(body)) {
      if (total > end - start + 1e-9)
        return {
          refused:
            "The copy lasts longer than the selection: select as many notes as it lasts, or paste at a caret to put it in.",
        };
      const left = end - start - total;
      return {
        changes: [
          { ...span, insert: left > 1e-9 ? `${body} ${restOf(left, reading.unit)}` : body },
        ],
        said: `Pasted over the selected notes in V:${voice}${left > 1e-9 ? ", a rest for the time left" : ""}; the other voices are as they were.`,
      };
    }
    return {
      refused:
        "In a tune with several voices, a paste over a selection replaces it: copy whole bars to paste over whole bars, or select within one bar.",
    };
  }
  // At a caret or one note: in, with rests in the other voices at the same point.
  const at = Math.min(...insert.map((change) => change.from));
  const next = times.find((each) => each.voice === voice && each.from >= at);
  const ownTimes = times.filter((each) => each.voice === voice);
  const time = next ? next.start : (ownTimes.at(-1)?.end ?? 0);
  const changes = [...insert];
  const others: string[] = [];
  for (const other of voices) {
    if (other === voice) continue;
    const theirs = times.filter((each) => each.voice === other);
    if (!theirs.length) continue;
    const ending = theirs.find((each) => Math.abs(each.end - time) < 1e-9);
    const starting = theirs.find((each) => Math.abs(each.start - time) < 1e-9);
    if (!ending && !starting) {
      if (time > (theirs.at(-1)?.end ?? 0) + 1e-9) continue;
      return {
        refused: `V:${other} has a note sounding across where the paste would go: paste at a bar line, or in every voice.`,
      };
    }
    const letter = restLetter(
      text,
      file,
      other,
      theirs.find((each) => each.end >= time - 1e-9)?.from ?? 0,
    );
    const rests = (
      whole ? bars.map((length) => restOf(length, reading.unit)) : [restOf(total, reading.unit)]
    ).map((rest) => lettered(rest, letter));
    if (ending) {
      const after = selectedNotes(text, [{ from: ending.from, to: ending.from + 1 }], file)[0];
      const spot = after?.span.to ?? ending.to;
      // Whole bars after the bar line there, written as the tune writes its bar lines.
      const bar = whole
        ? tokenizeMusic(
            text.slice(spot, text.indexOf("\n", spot) < 0 ? text.length : text.indexOf("\n", spot)),
            spot,
          ).find((token) => token.kind !== "space")
        : undefined;
      if (bar?.kind === "bar") {
        const spaced = /\s\|/.test(text.slice(spot - 1, bar.to));
        changes.push({
          from: bar.to,
          to: bar.to,
          insert: spaced ? ` ${rests.join(" | ")} |` : `${rests.join("|")}|`,
        });
      } else
        changes.push({
          from: spot,
          to: spot,
          insert: whole ? ` | ${rests.join(" | ")}` : ` ${rests.join(" ")}`,
        });
    } else if (starting) {
      const own = selectedNotes(text, [{ from: starting.from, to: starting.from + 1 }], file)[0];
      const spot = own?.span.from ?? starting.from;
      changes.push({
        from: spot,
        to: spot,
        insert: whole ? `${rests.join(" | ")} | ` : `${rests.join(" ")} `,
      });
    }
    others.push(`V:${other}`);
  }
  return {
    changes,
    said: `Pasted in V:${voice}${others.length ? `; rests in ${others.join(" and ")} keep ${others.length === 1 ? "it" : "them"} in step` : ""}.`,
  };
}

/** The place in another voice at the same written time as a place: where its note starts. */
export function samePoint(text: string, file: FileIndex, at: number, voice: string): number | null {
  const times = timed(text, file, at);
  const here = times.find((each) => each.from >= at);
  if (!here) return null;
  const theirs = times.filter((each) => each.voice === voice);
  const starting = theirs.find((each) => Math.abs(each.start - here.start) < 1e-9);
  if (starting)
    return (
      selectedNotes(text, [{ from: starting.from, to: starting.from + 1 }], file)[0]?.span.from ??
      starting.from
    );
  const ending = theirs.find((each) => Math.abs(each.end - here.start) < 1e-9);
  if (ending)
    return (
      selectedNotes(text, [{ from: ending.from, to: ending.from + 1 }], file)[0]?.span.to ??
      ending.to
    );
  return null;
}

/*
 * Placeholder rests (a new voice's, one a bar): typing over them writes the voice bar by bar.
 * The bar's rest shrinks to what is left of the bar as notes are typed in front of it, and goes
 * when the bar is full; at a full bar's end, the next note goes into the next bar, in place of
 * its placeholder.
 */

/** The bar around a place on its line: from after the bar line before to the bar line after. */
function barRange(text: string, at: number): { from: number; to: number; close?: MusicToken } {
  const lineFrom = text.lastIndexOf("\n", at - 1) + 1;
  const lineTo = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
  const tokens = joinedBars(tokenizeMusic(text.slice(lineFrom, lineTo), lineFrom));
  const before = tokens.filter((token) => token.kind === "bar" && token.to <= at).at(-1);
  const close = tokens.find((token) => token.kind === "bar" && token.from >= at);
  return {
    from: before ? before.to : lineFrom,
    to: close ? close.from : lineTo,
    ...(close ? { close } : {}),
  };
}

/** The placeholder rest's new length after typing in its bar: shorter, or gone when full. */
export function fillPlaceholder(
  text: string,
  file: FileIndex,
  caret: number,
  placeholders: number[],
): Change[] {
  const bar = barRange(text, caret);
  const rest = placeholders.find(
    (at) => at >= bar.from && at < bar.to && /^[zx]/.test(text.slice(at)),
  );
  if (rest === undefined) return [];
  const reading = readingAt(text, file, rest);
  const expected = reading ? meterLength(reading.meter) : null;
  if (!reading || !expected) return [];
  const token = tokenizeMusic(text.slice(rest, bar.to), rest)[0];
  if (token?.kind !== "rest") return [];
  const times = timed(text, file, rest).filter(
    (each) => each.from >= bar.from && each.from < bar.to,
  );
  const voice = times.find((each) => each.from === rest)?.voice;
  const filled = times
    .filter((each) => each.voice === voice && each.from !== rest)
    .reduce((sum, each) => sum + each.end - each.start, 0);
  const left = expected.num / expected.den - filled;
  if (left <= 1e-9) {
    // Full: the placeholder goes, with a space before it.
    const from = /\s/.test(text[rest - 1] ?? "") ? rest - 1 : rest;
    return [{ from, to: token.to, insert: "" }];
  }
  const written = restOf(left, reading.unit);
  return written === token.text ? [] : [{ from: rest, to: token.to, insert: written }];
}

/**
 * A `|` typed where only spaces are left before one of these bar lines: where the caret goes
 * instead, over it (and the space after it). Null: the `|` is typed.
 */
export function overBarLine(text: string, caret: number, bars: number[]): number | null {
  const bar = barRange(text, caret);
  if (!bar.close || !bars.includes(bar.close.from) || /\S/.test(text.slice(caret, bar.to)))
    return null;
  return text[bar.close.to] === " " ? bar.close.to + 1 : bar.close.to;
}

/** At a full bar's end before a bar line, the next bar's placeholder: where typing goes on. */
export function nextPlaceholder(
  text: string,
  caret: number,
  placeholders: number[],
): number | null {
  const bar = barRange(text, caret);
  if (!bar.close || caret < bar.to - 1 || /\S/.test(text.slice(caret, bar.to))) return null;
  if (placeholders.some((at) => at >= bar.from && at < bar.to)) return null;
  const following = barRange(text, bar.close.to + 1);
  const close = bar.close;
  return placeholders.find((at) => at >= close.to && at <= following.to) ?? null;
}

/** A copy's notes, rests and chords one by one, as written, with how long each lasts. */
type Piece = {
  text: string;
  /** In whole notes. */
  length: number;
  /** A rest (never tied). */
  rest: boolean;
  /**
   * Part of it, as long as given, written in values that can be drawn and tied (round 8, rule
   * (c)): with its marks when it's the first part, its tie onward unless the last. Null where it
   * can't be split (a tuplet's note, a broken rhythm's).
   */
  render: ((length: number, first: boolean, last: boolean, unit: Fraction) => string) | null;
  /** Split already: what's left is rendered, not written as it was. */
  cut?: boolean;
};

/** A length as plain or dotted values, largest first (5/8: a half and an eighth). */
function drawable(length: number): number[] {
  const out: number[] = [];
  let left = length;
  while (left > 1e-9) {
    const value = VALUES.find((each) => each <= left + 1e-9) ?? left;
    out.push(value);
    left -= value;
  }
  return out;
}

function piecesOf(clip: string, unit: Fraction, meter: string): Piece[] | null {
  const body = clip
    .split("\n")
    .filter((line) => !/^[A-Za-z]:/.test(line))
    .join(" ");
  const head = `X:1\nM:${meter || "none"}\nL:${unit.num}/${unit.den}\nK:C\n`;
  const mini = `${head}${body}\n`;
  const file = indexFile(mini);
  const tune = file.tunes[0] as TuneInfo;
  const tokens = tokenizeMusic(body, head.length);
  // (A copy with repeat signs or endings goes in at a bar line instead: ./paste.)
  if (tokens.some((token) => token.kind === "bar" && /[:0-9]/.test(token.text))) return null;
  const structure = structureOf(mini, file, head.length);
  const inTuplet = new Set(structure.tuplets.flatMap(({ notes }) => notes));
  // A tuplet's sign goes with its first note.
  const signs = new Map(
    structure.tuplets.map(({ sign, notes }) => [notes[0] ?? -1, sign.from] as const),
  );
  const pieces: Piece[] = [];
  for (const item of tuneItems(mini, tune, file)) {
    if (item.type !== "event") continue;
    const picked = selectedNotes(mini, [{ from: item.from, to: item.from + 1 }], file)[0];
    const found = picked?.span ?? item;
    const span = { from: Math.min(found.from, signs.get(item.from) ?? found.from), to: found.to };
    const text = mini.slice(span.from, span.to);
    const own = tokenizeMusic(text, span.from);
    const broken = own.some((token) => token.kind === "broken");
    const at = own.findIndex((token) => token.from >= item.from && token.kind !== "space");
    const lead = mini.slice(span.from, item.from);
    let render: Piece["render"] = null;
    const first = own[at];
    const isRest = first?.kind === "rest";
    if (!broken && !inTuplet.has(item.from) && first && !item.bars) {
      // The pitch (or rest, or chord) and what follows it, to write at any length.
      let head: string | null = null;
      let tail = "";
      if (first.kind === "rest" && /^[zx]$/.test(first.text[0] ?? ""))
        head = first.text[0] as string;
      else if (first.kind === "note") {
        head = `${first.accidental}${first.letter}${first.octave}`;
        tail = mini.slice(first.to, span.to).replace(/^-/, "");
      } else if (first.kind === "chord-open") {
        const close = own.find((token) => token.kind === "chord-close");
        const inner = own.filter(
          (token) =>
            token.kind === "note" && token.from > first.from && close && token.to <= close.from,
        );
        if (close && inner.every((token) => token.kind === "note" && !token.length)) {
          head = mini.slice(first.from, close.from + 1);
          tail = mini.slice(close.to, span.to).replace(/^-/, "");
        }
      }
      if (head !== null) {
        const sign = head;
        render = (length, opening, last, u) => {
          const parts = drawable(length).map((value) => `${sign}${lengthText(value, u)}`);
          const joined = isRest ? parts.join(" ") : parts.join("- ");
          return `${opening ? lead : ""}${joined}${isRest ? "" : last ? tail : "-"}`;
        };
      }
    }
    pieces.push({ text, length: item.duration.num / item.duration.den, rest: isRest, render });
  }
  return pieces;
}

/**
 * A paste over notes, as MuseScore does it: the copy overwrites forward from the selection's
 * first note for as long as it lasts, the tune's bar lines staying where they are (a note across
 * one is written tied over it); notes it runs over past the selection's end are replaced (the
 * notice says how many); rests fill the selection left, or the rest of the last bar it reaches.
 * In a tune with several voices, the others are untouched. Refused across a repeat sign or an
 * ending, past the end of the voice, or where a note would have to split a tuplet. Null when the
 * range selects no whole note.
 */
export function overwriteForward(
  text: string,
  file: FileIndex,
  range: Range,
  clip: string,
): { changes: Change[]; said: string } | { refused: string } | null {
  if (range.to <= range.from || !inMusic(text, [range], file)) return null;
  const picked = selectedNotes(text, [range], file).filter((each) => each.whole);
  if (!picked.length || !notesIn(clip)) return null;
  const first = picked[0] as Picked;
  const voice = first.event.voice;
  const reading = readingAt(text, file, first.event.from);
  const tune = file.tunes.find((each) => range.from >= each.from && range.from <= each.to);
  if (!reading || !tune) return null;
  const pieces = piecesOf(clip, reading.unit, reading.meter);
  if (!pieces) return null;
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  if (total < 1e-9) return null;
  // The voice's bars, each with its events and their times, and the bar line after it.
  type Event = { from: number; to: number; start: number; end: number; rest: boolean; span: Range };
  type Bar = {
    start: number;
    end: number;
    events: Event[];
    after?: { from: number; to: number; text: string };
  };
  const bars: Bar[] = [{ start: 0, end: 0, events: [] }];
  let clock = 0;
  const spans = new Map(
    selectedNotes(text, [{ from: tune.bodyFrom, to: tune.to }], file).map((each) => [
      each.event.from,
      each.span,
    ]),
  );
  for (const item of tuneItems(text, tune, file)) {
    if (item.voice !== voice) continue;
    const bar = bars[bars.length - 1] as Bar;
    if (item.type === "bar") {
      if (!bar.events.length && bar.after) {
        // Bar lines side by side (`|` `[1`): one.
        bar.after = {
          from: bar.after.from,
          to: item.to,
          text: text.slice(bar.after.from, item.to),
        };
        continue;
      }
      bar.after = { from: item.from, to: item.to, text: item.text };
      if (bar.events.length) bars.push({ start: clock, end: clock, events: [] });
      continue;
    }
    if (item.bars)
      bar.events.push({
        from: item.from,
        to: item.to,
        start: clock,
        end: Number.NaN,
        rest: true,
        span: item,
      });
    const end = clock + item.duration.num / item.duration.den;
    if (!item.bars)
      bar.events.push({
        from: item.from,
        to: item.to,
        start: clock,
        end,
        rest: item.rest,
        span: spans.get(item.from) ?? item,
      });
    clock = end;
    bar.end = end;
  }
  const real = bars.filter((bar) => bar.events.length);
  const lastPicked = picked[picked.length - 1] as Picked;
  const all = real.flatMap((bar) => bar.events);
  const startEvent = all.find((each) => each.from === first.event.from);
  const endEvent = all.find((each) => each.from === lastPicked.event.from);
  if (!startEvent || !endEvent) return null;
  const t0 = startEvent.start;
  const selEnd = endEvent.end;
  const t1 = t0 + total;
  const eps = 1e-9;
  // What goes: the events from the first note until the copy and the selection both end; a note
  // the copy only partly covers keeps the rest of its time as a rest. Notes after stay.
  const replaceEnd = Math.max(t1, selEnd);
  const voiceEnd = real.at(-1)?.end ?? 0;
  if (replaceEnd > voiceEnd + eps)
    return {
      refused:
        "The copy runs past the end of the voice: paste it at the end to add bars, or select further back.",
    };
  const goneEvents = all.filter((each) => each.start >= t0 - eps && each.start < replaceEnd - eps);
  if (goneEvents.some((each) => Number.isNaN(each.end)))
    return { refused: "The paste would run over a multi-bar rest: write its bars out first." };
  const tE = Math.max(replaceEnd, ...goneEvents.map((each) => each.end));
  const windows = real.filter((bar) => bar.end > t0 + eps && bar.start < tE - eps);
  for (const bar of windows.slice(0, -1))
    if (bar.after && /[:0-9]/.test(bar.after.text))
      return {
        refused:
          "The paste would run across a repeat sign or an ending: select up to it, or paste a shorter copy.",
      };
  const structure = structureOf(text, file, range.from);
  const gone = new Set(goneEvents.map((each) => each.from));
  if (
    structure.tuplets.some(
      ({ notes }) => notes.some((at) => gone.has(at)) && !notes.every((at) => gone.has(at)),
    )
  )
    return {
      refused: "The paste would cut a tuplet in two: select all of its notes, or paste elsewhere.",
    };
  // A tuplet replaced whole goes with its sign.
  const signs = new Map(
    structure.tuplets
      .filter(({ notes }) => notes.length && notes.every((at) => gone.has(at)))
      .map(({ sign, notes }) => [notes[0] as number, sign.from]),
  );
  // The voice's own rests: spacers in a spacer voice (rule (d)).
  const restsThere = goneEvents.filter((each) => each.rest);
  const letter =
    restsThere.length &&
    restsThere.every((each) => /^x/.test(text.slice(each.from, each.to).trimStart()))
      ? "x"
      : "z";
  const beat = beatOf(reading.meter);
  const changes: Change[] = [];
  const queue = [...pieces];
  let time = t0;
  let filled = false;
  for (const bar of windows) {
    const own = bar.events.filter((each) => gone.has(each.from));
    if (!own.length) continue;
    const from = Math.min(
      (own[0] as Event).span.from,
      signs.get((own[0] as Event).from) ?? Number.POSITIVE_INFINITY,
    );
    const to = (own[own.length - 1] as Event).span.to;
    if (text.slice(from, to).includes("\n"))
      return {
        refused: "The paste would run across a bar written over two lines: paste it bar by bar.",
      };
    const until = Math.min(bar.end, tE);
    // What the bar gets, each with its place in it (for grouping by the beat).
    const items: { text: string; start: number; length: number; rest: boolean }[] = [];
    while (time < until - eps && queue.length) {
      const piece = queue[0] as Piece;
      if (time + piece.length <= until + eps) {
        const written =
          piece.cut && piece.render
            ? piece.render(piece.length, false, true, reading.unit)
            : piece.text;
        items.push({
          text: written,
          start: time - bar.start,
          length: piece.length,
          rest: piece.rest,
        });
        time += piece.length;
        queue.shift();
        continue;
      }
      if (!piece.render)
        return {
          refused:
            "A note of the copy would cross a bar line where it can't be tied over (in a tuplet or broken rhythm): paste where its bars meet the tune's.",
        };
      const part = until - time;
      items.push({
        text: piece.render(part, !piece.cut, false, reading.unit),
        start: time - bar.start,
        length: part,
        rest: piece.rest,
      });
      queue[0] = { ...piece, length: piece.length - part, cut: true };
      time = until;
    }
    if (time < until - eps) {
      // Rests for the selection left, or what's left of a note the copy partly covered.
      const whole = Math.abs(time - bar.start) < eps && Math.abs(until - bar.end) < eps;
      let at = time - bar.start;
      for (const piece of restPieces(at, until - time, beat, whole)) {
        items.push({
          text: `${letter}${lengthText(piece, reading.unit)}`,
          start: at,
          length: piece,
          rest: true,
        });
        at += piece;
      }
      filled = true;
      time = until;
    }
    // Grouped by the beat: notes shorter than a beat within one beat are written together.
    let out = "";
    items.forEach((item, index) => {
      const previous = items[index - 1];
      const together =
        previous &&
        !previous.rest &&
        !item.rest &&
        previous.length < beat - eps &&
        item.length < beat - eps &&
        Math.floor((previous.start + eps) / beat) === Math.floor((item.start + eps) / beat);
      out += `${index && !together ? " " : ""}${item.text}`;
    });
    changes.push({ from, to, insert: out });
  }
  const over = goneEvents.filter((each) => !each.rest && each.start >= selEnd - eps).length;
  const partly = tE > replaceEnd + eps;
  const several = new Set(timed(text, file, range.from).map((each) => each.voice)).size > 1;
  const said = [
    `Pasted over the selection from its first note${several ? ` in V:${voice}` : ""}`,
    over ? `it ran on over ${over} more note${over === 1 ? "" : "s"}, replaced` : "",
    filled
      ? partly
        ? "a rest for the time left of the note it partly covered"
        : "rests fill the selection left"
      : "",
    several ? "the other voices are as they were" : "",
  ]
    .filter(Boolean)
    .join("; ");
  return { changes, said: `${said}.` };
}

/**
 * Where a paste on one clicked note goes in before it rather than over it (round 6): when the
 * note starts its bar and the copy is whole bars, each its full length. Null: it overwrites.
 */
export function insertsAtNote(
  text: string,
  file: FileIndex,
  range: Range,
  clip: string,
): number | null {
  if (range.to <= range.from || !/\|[ \t]*$/.test(clip.trimEnd())) return null;
  const picked = selectedNotes(text, [range], file).filter((each) => each.whole);
  const one = picked[0];
  if (picked.length !== 1 || !one) return null;
  const reading = readingAt(text, file, one.event.from);
  const length = meterLength(reading?.meter ?? "");
  if (!reading || !length) return null;
  const { bars } = clipTiming(clip, reading.unit, reading.meter);
  if (!bars.length || bars.some((bar) => Math.abs(bar - length.num / length.den) > 1e-9))
    return null;
  // The voice's last token before it, fields and marks aside: a bar line, or none.
  const before = tuneTokens(text, file, one.span.from).filter(
    ({ token, voice }) =>
      voice === one.event.voice &&
      token.to <= one.span.from &&
      !["inline-field", "decoration", "annotation", "chord-symbol", "space"].includes(token.kind),
  );
  const last = before.at(-1)?.token;
  return !last || last.kind === "bar" ? one.span.from : null;
}

/**
 * Hairpins kept whole by a cut (round 7): an end on a note that goes (with its bar, or made a
 * rest) moves to the nearest note left inside the hairpin; with none left, both ends go.
 * `gone` are the stretches cut away, `rested` the notes made rests.
 */
function hairpinsKept(
  text: string,
  file: FileIndex,
  at: number,
  gone: Range[],
  rested: Set<number>,
): Change[] {
  const tokens = tuneTokens(text, file, at);
  type Mark = { token: MusicToken; event: MusicToken | null };
  const pairs: { open: Mark; close: Mark; voice: string }[] = [];
  const opened = new Map<string, Mark>();
  const pending: { token: MusicToken; voice: string; open: boolean }[] = [];
  const events: { token: MusicToken; voice: string }[] = [];
  const owner = new Map<MusicToken, MusicToken | null>();
  for (const { token, voice } of tokens) {
    if (
      token.kind === "decoration" &&
      (HAIRPIN_OPEN.test(token.text) || HAIRPIN_CLOSE.test(token.text))
    )
      pending.push({ token, voice, open: HAIRPIN_OPEN.test(token.text) });
    else if (starts(token)) {
      events.push({ token, voice });
      for (const mark of pending.filter((each) => each.voice === voice))
        owner.set(mark.token, token);
      for (let index = pending.length - 1; index >= 0; index--)
        if ((pending[index] as (typeof pending)[number]).voice === voice) pending.splice(index, 1);
    }
  }
  for (const mark of pending) owner.set(mark.token, null);
  for (const { token, voice } of tokens) {
    if (token.kind !== "decoration") continue;
    const mark = { token, event: owner.get(token) ?? null };
    if (HAIRPIN_OPEN.test(token.text)) opened.set(voice, mark);
    else if (HAIRPIN_CLOSE.test(token.text)) {
      const open = opened.get(voice);
      if (open) pairs.push({ open, close: mark, voice });
      opened.delete(voice);
    }
  }
  const cut = (at: number) => gone.some((range) => at >= range.from && at < range.to);
  const lost = (mark: Mark) =>
    cut(mark.token.from) || !mark.event || cut(mark.event.from) || rested.has(mark.event.from);
  const changes: Change[] = [];
  for (const { open, close, voice } of pairs) {
    const openLost = lost(open);
    const closeLost = lost(close);
    if (!openLost && !closeLost) continue;
    const from = open.event?.from ?? open.token.from;
    const to = close.event?.from ?? close.token.to;
    const left = events.filter(
      ({ token, voice: own }) =>
        own === voice &&
        token.kind !== "rest" &&
        token.from >= from &&
        token.from <= to &&
        !cut(token.from) &&
        !rested.has(token.from),
    );
    // A mark that's still there (not cut away, not on a note made a rest: those go with it).
    const remove = (mark: Mark) => {
      if (!cut(mark.token.from) && !(mark.event && rested.has(mark.event.from)))
        changes.push({ from: mark.token.from, to: mark.token.to, insert: "" });
    };
    if (left.length < 2) {
      remove(open);
      remove(close);
      continue;
    }
    if (openLost) {
      remove(open);
      const first = (left[0] as (typeof left)[number]).token.from;
      changes.push({ from: first, to: first, insert: open.token.text });
    }
    if (closeLost) {
      remove(close);
      const last = (left[left.length - 1] as (typeof left)[number]).token.from;
      changes.push({ from: last, to: last, insert: close.token.text });
    }
  }
  return changes;
}

/**
 * ½×, 2× and a dot keep every bar its length, in any tune (round 7; one voice too since round 8,
 * rule (e)): halved, a bar's notes leave rests for the time they gave up, after them, by the
 * beat; doubled or dotted past the bar's length, it's refused, saying which bar. `changes` are
 * the lengths' own changes.
 */
export function lengthsInStep(
  text: string,
  file: FileIndex,
  changes: Change[],
  factor: number,
  label: string,
): { changes: Change[]; said?: string } | { refused: string } | null {
  const first = changes[0];
  if (!first) return null;
  const tune = file.tunes.find((each) => first.from >= each.from && first.from <= each.to);
  if (!tune) return null;
  type Event = { from: number; to: number; length: number; unit: Fraction };
  type Bar = { voice: string; number: number; events: Event[]; meter: string; total: number };
  const bars: Bar[] = [];
  const open = new Map<string, Bar>();
  const counts = new Map<string, number>();
  for (const item of tuneItems(text, tune, file)) {
    let bar = open.get(item.voice);
    if (!bar) {
      const number = (counts.get(item.voice) ?? 0) + 1;
      counts.set(item.voice, number);
      bar = { voice: item.voice, number, events: [], meter: item.meter, total: 0 };
      open.set(item.voice, bar);
      bars.push(bar);
    }
    if (item.type === "bar") {
      if (bar.events.length) open.delete(item.voice);
      continue;
    }
    const length = item.duration.num / item.duration.den;
    bar.events.push({ from: item.from, to: item.to, length, unit: item.unit });
    bar.total += length;
  }
  const several = new Set(bars.map((bar) => bar.voice)).size > 1;
  const changed = (event: Event) =>
    changes.some((change) => change.from >= event.from && change.from <= event.to);
  const out = [...changes];
  let rests = 0;
  for (const bar of bars) {
    const own = bar.events.filter(changed);
    if (!own.length) continue;
    const delta = own.reduce((sum, event) => sum + event.length, 0) * (factor - 1);
    const length = meterLength(bar.meter);
    const full = length ? length.num / length.den : null;
    if (delta > 1e-9 && full !== null && bar.total + delta > full + 1e-9)
      return {
        refused: several
          ? `${label} would overfill bar ${bar.number} of V:${bar.voice}, out of step with the other voices: make room in the bar first, or select fewer notes.`
          : `${label} would overfill bar ${bar.number}: make room in the bar first, or select fewer notes.`,
      };
    if (delta < -1e-9) {
      const last = own[own.length - 1] as Event;
      const span = selectedNotes(text, [{ from: last.from, to: last.from + 1 }], file)[0]?.span;
      const at = span?.to ?? last.to;
      // Where the rests start in the bar, the notes before them at their new lengths.
      const upTo = bar.events.slice(0, bar.events.indexOf(last) + 1);
      const position = upTo.reduce(
        (sum, event) => sum + (changed(event) ? event.length * factor : event.length),
        0,
      );
      const letter = restLetter(text, file, bar.voice, last.from);
      const written = restPieces(position, -delta, beatOf(bar.meter), false).map(
        (piece) => `${letter}${lengthText(piece, last.unit)}`,
      );
      out.push({ from: at, to: at, insert: ` ${written.join(" ")}` });
      rests += 1;
    }
  }
  return {
    changes: out.sort((a, b) => a.from - b.from || a.to - b.to),
    ...(rests
      ? {
          said: `${label}: a rest in ${rests === 1 ? "the bar" : `each of the ${rests} bars`} for the time given up, so ${several ? "the voices stay in step" : "every bar keeps its length"}.`,
        }
      : {}),
  };
}

/**
 * A pitch typed over one selected note, chord or rest re-pitches it in place (round 8, rule (a)):
 * its length, broken rhythm, tie, chord symbol and marks stay (`G6` + `A` is `A6`,
 * `"Am"!f![ACE]2` + `B` is `"Am"!f!B2`, `!pp!G>G` + `c` is `!pp!c>G`). The caret goes after the
 * letter, so `,` or `'` typed next set its octave. Null for anything else: typing replaces.
 */
export function repitch(
  text: string,
  ranges: Range[],
  typed: string,
  file: FileIndex = indexFile(text),
): { changes: Change[]; caret: number } | null {
  if (!/^[A-Ga-gz]$/.test(typed)) return null;
  const selected = ranges.filter((range) => range.to > range.from);
  if (selected.length !== 1 || !inMusic(text, selected, file)) return null;
  const picked = selectedNotes(text, selected, file);
  const one = picked[0];
  if (picked.length !== 1 || !one?.whole) return null;
  const tokens = tokenizeMusic(text.slice(one.event.from, one.event.to), one.event.from).filter(
    (token) => token.kind !== "space",
  );
  const head = tokens[0];
  if (!head) return null;
  if (head.kind === "note" || head.kind === "rest") {
    const to = head.lengthFrom;
    return { changes: [{ from: head.from, to, insert: typed }], caret: head.from + 1 };
  }
  if (head.kind === "chord-open") {
    const close = tokens.find((token) => token.kind === "chord-close");
    if (!close || close.kind !== "chord-close") return null;
    // A chord whose tones carry the length (`[A2C2]`): the first tone's.
    const inner = tokens.find(
      (token) => token.kind === "note" && token.from > head.from && token.to <= close.from,
    );
    const length = close.length || (inner?.kind === "note" ? inner.length : "");
    return {
      changes: [{ from: head.from, to: close.to, insert: `${typed}${length}` }],
      caret: head.from + 1,
    };
  }
  return null;
}
