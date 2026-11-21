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
import { type Change, type Range, barAround, passagesOf } from "./commands";
import { markOf } from "./playorder";
import { selectedNotes } from "./selected";
import { readingAt } from "./stepentry";
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
  /** Its tokens, spaces left out. */
  tokens: MusicToken[];
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
function keptInside(text: string, range: Range, structure: Structure, selected: Range[]): Range[] {
  const kept: Range[] = [];
  for (const line of linesOf(text, range)) {
    for (const token of line.tokens)
      if (
        token.to > range.from &&
        token.from < range.to &&
        (token.kind === "bar" ||
          keeper(token) ||
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
    const kept = keptInside(text, range, structure, selected);
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
  if (token.kind === "inline-field") return /^\[[KMLQP]:/.test(token.text);
  if (token.kind === "annotation" && /^"\^/.test(token.text)) return true;
  return jumpMark(token) !== null;
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
function tuneTokens(text: string, file: FileIndex, at: number) {
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  const out: { token: MusicToken; voice: string }[] = [];
  if (!tune) return out;
  let voice = "";
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
  if (range.to <= range.from || !inMusic(text, [range], file)) return written;
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
  return `${out}${/\s/.test(text[range.to] ?? "") ? " " : ""}|`;
}

/** Parts of a bar line: `:|2` is an end of repeat, a bar, and the 2nd ending. */
function barParts(text: string) {
  const match = /^(:*)(\[\||\|\]|\|\||\||)(:*)\[?([0-9][0-9,-]*)?$/.exec(text);
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
  const start = c.body === "|]" || whole ? 0 : o.start || c.start;
  let ending = c.ending;
  let said: string | undefined;
  const section = c.body === "|]" || c.body === "||" || c.start > 0;
  if (o.ending) {
    if (!c.end && section) said = `The ${ordinal(o.ending)} ending went with its last bar.`;
    else if (!c.end) ending = c.ending || o.ending;
    else if (!c.ending) said = `The ${ordinal(o.ending)} ending went with its last bar.`;
    else if (
      o.ending === "1" &&
      c.ending === "2" &&
      !/(^|[^0-9])3/.test(after.split("\n")[0] ?? "")
    ) {
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
  if (!o.start || parts.some((part) => part.start)) return refused;
  // Body and 1st ending: the 2nd ending's bars now follow, played once.
  if (
    c.end &&
    c.ending === "2" &&
    !ends &&
    endings.join() === "1" &&
    !/(^|[^0-9])3/.test(after.split("\n")[0] ?? "")
  )
    return {
      text: "|",
      said: "The repeat went with its 1st ending; the 2nd ending's bars now play once.",
    };
  // The whole repeat with all its endings.
  if (!c.end && !c.ending && ends === 1 && endings.includes("1") && endings.length >= 2)
    return { text: close, said: "The repeat went with its endings." };
  return refused;
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
  if (!selected.length || !inMusic(text, selected, file)) return null;
  const structure = structureOf(text, file, (selected[0] as Range).from);
  if (splitTuplet(structure, selected))
    return { refused: "This would cut a tuplet in two: select all of its notes, or none." };
  const picked = chosen(text, selected, file);
  const changes: Change[] = [];
  const said: string[] = [];
  const lines = new Map<number, Line>();
  for (const range of selected) for (const line of linesOf(text, range)) lines.set(line.from, line);
  const removed: Range[] = [];
  const carets: { at: number; offset: number }[] = [];
  for (const line of lines.values()) {
    const segments = segmentsOf(line, eventsOn(text, line, file));
    const touches = (segment: Segment) =>
      selected.some((range) => segment.to > range.from && segment.from < range.to);
    const whole = (segment: Segment) =>
      touches(segment) && segment.events.length > 0 && segment.events.every((at) => picked.has(at));
    for (let at = 0; at < segments.length; at++) {
      const segment = segments[at] as Segment;
      if (!touches(segment)) continue;
      if (!whole(segment)) {
        // Part of a bar: the selected text, less its keepers and slur ends whose pair stays.
        for (const range of selected) {
          const from = Math.max(range.from, segment.from);
          const to = Math.min(range.to, segment.to);
          if (to <= from) continue;
          let piece = from;
          for (const token of segment.tokens) {
            if (token.from < from || token.to > to) continue;
            const pair = structure.slurs.get(token.from);
            const kept = keeper(token) || (token.kind === "slur" && !inside(pair ?? -1, selected));
            if (!kept) continue;
            if (token.from > piece) changes.push({ from: piece, to: token.from, insert: "" });
            piece = token.to;
          }
          if (to > piece) changes.push({ from: piece, to, insert: "" });
          removed.push({ from, to });
          carets.push({ at: from, offset: 0 });
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
      let bar: string;
      const innerBars = run.slice(0, -1).map((segment) => (segment.close as MusicToken).text);
      if (innerBars.some((each) => !/^\|\|?$/.test(each))) {
        const merged = mergeRun(O?.text ?? "", innerBars, C?.text ?? "", C ? text.slice(C.to) : "");
        if ("refused" in merged) return merged;
        bar = merged.text;
        if (merged.said) said.push(merged.said);
      } else if (O && C) {
        if (PLAIN.test(O.text) && PLAIN.test(C.text)) bar = "|";
        else if (PLAIN.test(O.text)) bar = C.text;
        else if (PLAIN.test(C.text)) bar = O.text;
        else {
          const inner = run.slice(0, -1).map((segment) => (segment.close as MusicToken).text);
          const merged = mergeRun(O.text, inner, C.text, text.slice(C.to));
          if ("refused" in merged) return merged;
          bar = merged.text;
          if (merged.said) said.push(merged.said);
        }
      } else if (C) bar = PLAIN.test(C.text) ? "" : C.text;
      else bar = O ? O.text : "";
      const insert = [before.join(" "), bar, after.join(" ").replace(/\( /g, "(")]
        .filter(Boolean)
        .join(" ");
      let to = span.to;
      if (!O && !insert) while (to < line.to && /[ \t]/.test(text[to] as string)) to += 1;
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
  // A music line left with nothing but spaces goes, with its line break.
  const sorted = changes.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const line of lines.values()) {
    let left = "";
    let at = line.from;
    for (const change of sorted) {
      if (change.to <= line.from || change.from >= line.to) continue;
      left += text.slice(at, Math.max(at, change.from)) + change.insert;
      at = Math.max(at, change.to);
    }
    left += text.slice(Math.min(at, line.to), line.to);
    if (!left.trim() && sorted.some((change) => change.from < line.to && change.to > line.from)) {
      for (let k = sorted.length - 1; k >= 0; k--) {
        const change = sorted[k] as Change;
        if (change.from >= line.from && change.to <= line.to) sorted.splice(k, 1);
      }
      const to = line.to < text.length ? line.to + 1 : line.to;
      const from = to === line.to && line.from > 0 ? line.from - 1 : line.from;
      sorted.push({ from, to, insert: "" });
    }
  }
  const final = sorted
    .sort((a, b) => a.from - b.from)
    .map((change) => (change.insert ? change : { ...change, insert: apart(text, change) }));
  const clip = selected.map((range) => copyText(text, range, file)).join("\n");
  // The caret, in the text after the cut.
  const first = carets.sort((a, b) => a.at - b.at)[0] ?? {
    at: (selected[0] as Range).from,
    offset: 0,
  };
  const caret =
    final
      .filter((change) => change.to <= first.at && change.from < first.at)
      .reduce((pos, change) => pos + change.insert.length - (change.to - change.from), first.at) +
    first.offset;
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
  const changes = ranges.map((range) => {
    let place = { ...range };
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
      place.from === place.to &&
      notes(before) &&
      after &&
      barLater(place, after)?.kind !== "bar"
    ) {
      // In the middle of a bar: after it.
      const next = around(text, place).tokens.find(
        (token) => token.from >= place.to && token.kind === "bar",
      );
      const at = next ? next.from : lineTo;
      place = { from: at, to: at };
      ({ before, after } = around(text, place));
      said = "Pasted the bars after the bar the caret was in, so no bar is split.";
    }
    let insert = clip;
    const extra: Change[] = [];
    if (whole) {
      const barAfter = barLater(place, after);
      const lead = tokenizeMusic(insert, 0).find((token) => token.kind !== "space");
      let prefix = "";
      if (notes(before)) {
        if (lead?.kind !== "bar") prefix = "| ";
      } else if (lead?.kind === "bar" && before)
        insert = insert.slice(lead.to).replace(/^[ \t]+/, "");
      let closing = "";
      if (barAfter?.kind === "bar") insert = insert.replace(/\|[ \t]*$/, "");
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
      if (closing && after && !/^\s/.test(text.slice(place.to))) insert += " ";
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
export function duplicate(
  text: string,
  ranges: Range[],
  file: FileIndex = indexFile(text),
): Change[] {
  const changes: Change[] = [];
  const passages = passagesOf(text, ranges, file).filter((passage) => passage.ranges.length > 1);
  const joined = new Set(passages.flatMap((passage) => passage.ranges));
  const place = (body: Range, bodies: Range[]) => {
    const structure = structureOf(text, file, body.from);
    const pieces = bodies.map((each) => copyText(text, each, file).replace(/\s*\|$/, ""));
    const bar = wholeBarsEnd(text, body);
    const written = pieces
      .map(
        (piece, at) =>
          piece + (at < bodies.length - 1 && wholeBarsEnd(text, bodies[at] as Range) ? "|" : ""),
      )
      .join(" ");
    if (bar) {
      const gap = /\s/.test(text[body.to] ?? "") ? " " : "";
      changes.push({ from: body.to, to: body.to, insert: `${gap}|${gap}${written}` });
      return;
    }
    // After the tuplet the last note is in.
    let at = body.to;
    for (const { notes } of structure.tuplets)
      if (notes.some((each) => each >= body.from && each < body.to) && (notes.at(-1) ?? 0) >= at) {
        const last = structure.tokens.find(({ token }) => token.from === notes.at(-1))?.token;
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
    let insert = ` ${written}`;
    // The copy's last note ties on to the note the original tied to, when it's the same note.
    if (tie && pitchOf(nextNote) === pitchOf(lastNote)) insert += "-";
    // The original's tie now meets the copy's first note: kept only if it's the same.
    if (tie && pitchOf(firstNote) !== pitchOf(lastNote))
      changes.push({ from: tie.from, to: tie.to, insert: "" });
    changes.push({ from: at, to: at, insert });
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
      changes.push({ from: target.to, to: target.to, insert: `${glue}${body}` });
      continue;
    }
    const body = notesSpan(text, range, file);
    if (body) place(body, [body]);
  }
  return changes;
}
