/**
 * The lossless writer (§13). A story is written back from its source, so an unchanged story gives
 * back the same bytes. Fields changed in place on the model are written as the edits in `edit.ts`
 * make them, one after another, each on the text the ones before it made: only the marks that
 * changed are rewritten, and nothing else moves.
 */
import {
  type TextChange,
  applyChanges,
  heardIndex,
  heardItem,
  renameCharacter,
  sameHearing,
  setDirection,
  setFullName,
  setMeta,
  setSpeaker,
} from "./edit";
import type { Block, Item, Line, Speech, Story, Vocal } from "./model";
import { nameKey } from "./names";
import { parse } from "./parse";

/**
 * Writes a story back to text. These fields may be changed in place before writing:
 *
 * - a speech's `speaker` and `ownDirection`;
 * - a sound's or a vocal sound's `description`, a note's `text`, an instruction's `value`;
 * - a heading's `level`;
 * - `meta.title`, `subtitle`, `author` and `language`;
 * - a cast member's `name` (the full name) and `handle` (renames the character everywhere).
 *
 * Adding or removing items is done with the edit functions (`setSpeaker`, `insertSound`, …) on
 * the text instead. A story whose shape no longer matches its source is an error.
 */
export function write(story: Story): string {
  const original = parse(story.source);
  checkShape(story, original);
  let text = story.source;
  // What the edits wrote, kept up to date as later edits move it.
  let written: Span[] = [];
  // Each change is made on the text the ones before made, then read back: one that can't be made
  // as asked is an error, never a change quietly left out or one that does something else.
  const edit = (
    make: (current: Story) => TextChange[],
    made?: (now: Story, before: Story, changes: TextChange[]) => boolean,
    what?: string,
  ) => {
    const current = parse(text);
    const changes = make(current);
    const next = applyChanges(text, changes);
    if (made && !made(parse(next), current, changes)) {
      throw new RangeError(`write() can't make this change as asked: ${what}.`);
    }
    written = afterChanges(written, changes);
    text = next;
  };

  for (const field of ["title", "subtitle", "author", "language"] as const) {
    if (story.meta[field] !== original.meta[field]) {
      edit((current) => setMeta(current, field, story.meta[field] ?? null));
    }
  }
  story.cast.forEach((member, index) => {
    const before = original.cast[index];
    if (!before) return;
    if (member.name !== before.name) {
      edit((current) => setFullName(current, before.handle, member.name));
    }
    if (member.handle !== before.handle) {
      edit((current) => renameCharacter(current, before.handle, member.handle));
    }
  });

  // Headings, sounds, notes and instructions are found again by their place among their kind,
  // speeches and a character's sounds by their first word: edits add marks, never these.
  const pairs = itemPairs(story, original);
  story.blocks.forEach((block, index) => {
    const before = original.blocks[index] as Block;
    if (block.kind === "heading" && before.kind === "heading" && block.level !== before.level) {
      edit((current) => {
        const heading = current.blocks[index];
        if (heading?.kind !== "heading") shapeError("blocks");
        const hashes = { from: heading.range.from, to: heading.range.from + heading.level };
        if (!Number.isInteger(block.level) || block.level < 1 || block.level > 6) {
          throw new RangeError(`write() can't make a heading of level ${block.level}: 1 to 6.`);
        }
        return [{ ...hashes, insert: "#".repeat(block.level) }];
      });
    }
  });
  for (const [after, before] of pairs) {
    if (after.kind === "speech" && before.kind === "speech") {
      if (after.speaker !== before.speaker) {
        edit(
          (current) => setSpeaker(current, find(current, original, before), after.speaker),
          // The edit checks its own result (narration that holds a quote gives the quote): it
          // is made unless it declined, or there was nothing to do.
          (_, current, changes) =>
            changes.length > 0 ||
            nameKey(find(current, original, before).speaker) === nameKey(after.speaker),
          `“${before.text}” said by ${after.speaker}`,
        );
      }
      if (after.ownDirection !== before.ownDirection) {
        const direction = after.ownDirection?.trim() || null;
        edit(
          (current) => setDirection(current, find(current, original, before), direction),
          (_, current, changes) =>
            changes.length > 0 || find(current, original, before).ownDirection === direction,
          `“${before.text}” said ${direction ?? "with no direction of its own"}`,
        );
      }
    }
  }
  const counted = new Map<Item["kind"], number>();
  for (const [after, before] of pairs) {
    const nth = counted.get(before.kind) ?? 0;
    counted.set(before.kind, nth + 1);
    const changed =
      ((after.kind === "sound" || after.kind === "vocal") &&
        before.kind === after.kind &&
        after.description !== before.description) ||
      (after.kind === "note" && before.kind === "note" && after.text !== before.text) ||
      (after.kind === "instruction" &&
        before.kind === "instruction" &&
        after.value !== before.value);
    if (!changed) continue;
    const nthOf = (of: Story) => itemsOf(of).filter((other) => other.kind === before.kind)[nth];
    edit(
      (current) => {
        const item = nthOf(current);
        if (!item) shapeError("items");
        return contentChanges(current, item, after);
      },
      // The item reads back as asked, and nothing else was added, removed or is heard differently.
      (now, current) =>
        sameContent(nthOf(now), after) &&
        sameKinds(now, current) &&
        (after.kind === "vocal" || sameHearing(now, current)),
      `the ${before.kind}'s new ${before.kind === "note" ? "text" : before.kind === "instruction" ? "value" : "description"}`,
    );
  }
  return withoutSpareMarks(text, written);
}

/**
 * Edits made one after another can leave a mark one of them needed and a later one made spare. A
 * mark whose name the edits wrote is taken out (or, with a direction, cut to `@(…)`) if every word
 * is still said by the same character in the same way. The author's own marks stay.
 */
function withoutSpareMarks(text: string, spans: readonly Span[]): string {
  if (spans.length === 0) return text;
  const goal = parse(text);
  let current = text;
  let story = goal;
  let written = spans;
  // Each mark an edit inserted whole is tried once, in order; a name an edit replaced in the
  // author's own mark is the author's mark still.
  for (let tried = 0; ; ) {
    const mark = itemsOf(story).filter(
      (item): item is Extract<Item, { kind: "mark" }> =>
        item.kind === "mark" &&
        written.some((span) => span.from <= item.range.from && item.range.to <= span.to),
    )[tried];
    if (!mark) break;
    const found = shorter(current, mark).find((option) =>
      sameHearing(goal, parse(applyChanges(current, [option]))),
    );
    if (!found) {
      tried++;
      continue;
    }
    written = afterChanges(written, [found]);
    current = applyChanges(current, [found]);
    story = parse(current);
    // A mark cut to its direction is no longer a mark: the next one now has its place.
  }
  return current;
}

type Span = { from: number; to: number };

/** Spans moved by changes, with what the changes inserted added. */
function afterChanges(spans: readonly Span[], changes: readonly TextChange[]): Span[] {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  const at = (offset: number) => {
    let delta = 0;
    for (const change of sorted) {
      if (offset <= change.from) break;
      if (offset < change.to) return change.from + delta + change.insert.length;
      delta += change.insert.length - (change.to - change.from);
    }
    return offset + delta;
  };
  const moved = spans.map((span) => ({
    from: at(span.from),
    to: Math.max(at(span.from), at(span.to)),
  }));
  let delta = 0;
  for (const change of sorted) {
    const from = change.from + delta;
    moved.push({ from, to: from + change.insert.length });
    delta += change.insert.length - (change.to - change.from);
  }
  return moved;
}

/** Taking a mark out (with one space), or cutting it to its direction. */
function shorter(text: string, mark: Extract<Item, { kind: "mark" }>): TextChange[] {
  const end = text[mark.range.to] === " " ? mark.range.to + 1 : mark.range.to;
  const options: TextChange[] = [{ from: mark.range.from, to: end, insert: "" }];
  if (mark.directionRange) {
    options.push({ from: mark.nameRange.from, to: mark.directionRange.from, insert: "" });
  }
  return options;
}

/** The text changes that would write a story's in-place edits back to its source: the smallest, line by line. */
export function changesFrom(story: Story): TextChange[] {
  return diffChanges(story.source, write(story));
}

function itemsOf(story: Story): Item[] {
  return story.blocks.flatMap((block) => linesOf(block).flatMap((line) => line.items));
}

function linesOf(block: Block): Line[] {
  return block.kind === "break" ? [] : block.kind === "heading" ? [block.line] : block.lines;
}

/** Each item of the edited model with the item it was in the source, in order. */
function itemPairs(story: Story, original: Story): Array<[Item, Item]> {
  const after = itemsOf(story);
  const before = itemsOf(original);
  return after.map((item, index) => [item, before[index] as Item]);
}

/** The speech or character's sound in the current text that was `item` in the original. */
function find(current: Story, original: Story, item: Speech): Speech {
  const index = heardIndex(original, item);
  const found = index >= 0 ? heardItem(current, index) : undefined;
  if (found?.kind === "speech") return found;
  // No words to find it by: the same place among the speeches.
  const speeches = (of: Story) =>
    itemsOf(of).filter((other): other is Speech => other.kind === "speech");
  const same = speeches(current)[speeches(original).indexOf(item)];
  if (!same) shapeError("items");
  return same;
}

/** A sound's description, a note's text or an instruction's value, written over the old one. */
function contentChanges(current: Story, item: Item, after: Item): TextChange[] {
  if (
    (item.kind === "sound" || item.kind === "vocal") &&
    (after.kind === "sound" || after.kind === "vocal")
  ) {
    const open = current.source.indexOf("[", item.range.from);
    return [{ from: open + 1, to: item.range.to - 1, insert: escapeBrackets(after.description) }];
  }
  if (item.kind === "note" && after.kind === "note") {
    return [{ from: item.range.from + 2, to: item.range.to - 2, insert: ` ${after.text} ` }];
  }
  if (item.kind === "instruction" && after.kind === "instruction") {
    const value = after.value?.replace(/([{}\\])/g, "\\$1");
    const raw = value === undefined ? `{${item.name}}` : `{${item.name} ${value}}`;
    return [{ ...item.range, insert: raw }];
  }
  return [];
}

function checkShape(story: Story, original: Story): void {
  if (story.cast.length !== original.cast.length) shapeError("cast members");
  if (story.blocks.length !== original.blocks.length) shapeError("blocks");
  story.blocks.forEach((block, index) => {
    const before = original.blocks[index] as Block;
    if (block.kind !== before.kind) shapeError("blocks");
    const lines = linesOf(block);
    const linesBefore = linesOf(before);
    if (lines.length !== linesBefore.length) shapeError("lines");
    lines.forEach((line, lineIndex) => {
      const itemsBefore = linesBefore[lineIndex]?.items ?? [];
      if (line.items.length !== itemsBefore.length) shapeError("items");
      line.items.forEach((item, itemIndex) => {
        if (item.kind !== itemsBefore[itemIndex]?.kind) shapeError("items");
      });
    });
  });
}

function escapeBrackets(text: string): string {
  return text.replace(/([[\]\\])/g, "\\$1");
}

const spaced = (text: string) => text.replace(/\s+/g, " ").trim();

/** Whether an item written back reads as the model asked. */
function sameContent(item: Item | undefined, after: Item): boolean {
  if (!item || item.kind !== after.kind) return false;
  if (
    (item.kind === "sound" || item.kind === "vocal") &&
    (after.kind === "sound" || after.kind === "vocal")
  ) {
    return item.description === spaced(after.description) && item.description !== "";
  }
  if (item.kind === "note" && after.kind === "note") return item.text === spaced(after.text);
  if (item.kind === "instruction" && after.kind === "instruction") {
    return item.value === (after.value === null ? null : spaced(after.value) || null);
  }
  return false;
}

function sameKinds(a: Story, b: Story): boolean {
  const kinds = (story: Story) =>
    itemsOf(story)
      .map((item) => item.kind)
      .join(" ");
  return a.blocks.length === b.blocks.length && kinds(a) === kinds(b);
}

function shapeError(what: string): never {
  throw new Error(
    `write() follows changes to fields only, but the story's ${what} were added or removed. Use the edit functions to add or remove marks.`,
  );
}

/**
 * Small changes that turn `a` into `b`: the lines lined up (see `align`), and each changed line,
 * or run of added and removed ones, narrowed to the characters that differ.
 */
export function diffChanges(a: string, b: string): TextChange[] {
  if (a === b) return [];
  const linesA = splitLines(a);
  const linesB = splitLines(b);
  // The lines both share at the start and the end are set aside first.
  let head = 0;
  while (head < linesA.length && head < linesB.length && linesA[head] === linesB[head]) head++;
  let tail = 0;
  while (
    tail < linesA.length - head &&
    tail < linesB.length - head &&
    linesA[linesA.length - 1 - tail] === linesB[linesB.length - 1 - tail]
  ) {
    tail++;
  }
  const middleA = linesA.slice(head, linesA.length - tail);
  const middleB = linesB.slice(head, linesB.length - tail);
  const script = align(middleA, middleB);
  const changes: TextChange[] = [];
  let offsetA = linesA.slice(0, head).reduce((sum, line) => sum + line.length, 0);
  let atA = 0;
  let atB = 0;
  const change = (removed: string, added: string) => {
    // Narrowed to where the two differ.
    let start = 0;
    while (start < removed.length && start < added.length && removed[start] === added[start])
      start++;
    let end = 0;
    while (
      end < removed.length - start &&
      end < added.length - start &&
      removed[removed.length - 1 - end] === added[added.length - 1 - end]
    ) {
      end++;
    }
    changes.push({
      from: offsetA + start,
      to: offsetA + removed.length - end,
      insert: added.slice(start, added.length - end),
    });
    offsetA += removed.length;
  };
  let i = 0;
  while (i < script.length) {
    const step = script[i];
    if (step === "=") {
      offsetA += (middleA[atA++] as string).length;
      atB++;
      i++;
    } else if (step === "~") {
      // A line changed within: a change of its own.
      change(middleA[atA++] as string, middleB[atB++] as string);
      i++;
    } else {
      let removed = "";
      let added = "";
      while (i < script.length && (script[i] === "-" || script[i] === "+")) {
        if (script[i] === "-") removed += middleA[atA++] as string;
        else added += middleB[atB++] as string;
        i++;
      }
      change(removed, added);
    }
  }
  return changes;
}

/** Lines with their line breaks, so joining them gives the text back. */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Whether two lines are one line changed within: most of them, at the start and end, the same. */
function similar(a: string, b: string): boolean {
  if (a.trim() === "" || b.trim() === "") return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  return (start + end) * 2 >= Math.max(a.length, b.length);
}

/**
 * How `a`'s lines become `b`'s: "=" keeps a line, "~" changes one within, "-" removes one and "+"
 * adds one. The writer changes lines within and only now and then adds or removes one, so lines
 * are lined up as they come, looking a little ahead where some were added or removed: linear in
 * the text, however many lines changed.
 */
function align(a: readonly string[], b: readonly string[]): Array<"=" | "~" | "-" | "+"> {
  const script: Array<"=" | "~" | "-" | "+"> = [];
  const AHEAD = 16;
  const matches = (x: string | undefined, y: string | undefined) =>
    x !== undefined && y !== undefined && (x === y || similar(x, y));
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        script.push("=");
        i++;
        j++;
        continue;
      }
      if (similar(a[i] as string, b[j] as string)) {
        script.push("~");
        i++;
        j++;
        continue;
      }
    }
    let added = 0;
    for (let q = 1; q <= AHEAD && j + q < b.length && !added; q++) {
      if (matches(a[i], b[j + q])) added = q;
    }
    let removed = 0;
    for (let p = 1; p <= AHEAD && i + p < a.length && !removed; p++) {
      if (matches(a[i + p], b[j])) removed = p;
    }
    if (added && (!removed || added <= removed)) {
      for (let q = 0; q < added; q++) script.push("+");
      j += added;
    } else if (removed) {
      for (let p = 0; p < removed; p++) script.push("-");
      i += removed;
    } else {
      if (i < a.length) {
        script.push("-");
        i++;
      }
      if (j < b.length) {
        script.push("+");
        j++;
      }
    }
  }
  return script;
}
