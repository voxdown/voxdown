/**
 * The lossless writer (§13). A story is written back from its source, so an unchanged story gives
 * back the same bytes. Fields changed in place on the model are written as the edits in `edit.ts`
 * make them, one after another, each on the text the ones before it made: only the marks that
 * changed are rewritten, and nothing else moves.
 */
import { escapeReferences } from "./chars";
import {
  type TextChange,
  applyChanges,
  heardIndex,
  heardItem,
  heardVoices,
  parsed,
  renameCharacter,
  sameHearing,
  setDirection,
  setFullName,
  setMeta,
  setSpeaker,
} from "./edit";
import type { Block, Item, Line, Speech, Story, Vocal } from "./model";
import { nameKey } from "./names";
import { session } from "./session";

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
 * the text instead. A story whose shape no longer matches its source is an error, and so is a
 * change to any other field (a `RangeError`), rather than one quietly left unwritten.
 */
export function write(story: Story): string {
  return session(() => writeNow(story));
}

function writeNow(story: Story): string {
  const original = parsed(story.source);
  checkShape(story, original);
  checkWritable(story, original);
  let text = story.source;
  // What the edits wrote, kept up to date as later edits move it.
  let written: Span[] = [];
  let changeCount = 0;
  // Each word a speaker change gave, by its place among what is heard (edits never move words).
  const given: Array<{ index: number; speaker: string; what: string }> = [];
  // Each change is made on the text the ones before made, then read back: one that can't be made
  // as asked is an error, never a change quietly left out or one that does something else.
  const edit = (
    make: (current: Story) => TextChange[],
    made?: (now: Story, before: Story, changes: TextChange[]) => boolean,
    what?: string,
  ) => {
    const current = parsed(text);
    const changes = make(current);
    const next = applyChanges(text, changes);
    if (made && !made(parsed(next), current, changes)) {
      throw new RangeError(`write() can't make this change as asked: ${what}.`);
    }
    written = afterChanges(written, changes, changeCount++);
    text = next;
  };

  // Each detail and cast change reads back as asked, or is an error: never quietly left out.
  for (const field of ["title", "subtitle", "author", "language"] as const) {
    if (story.meta[field] !== original.meta[field]) {
      const asked = story.meta[field]?.trim() || undefined;
      edit(
        (current) => setMeta(current, field, story.meta[field] ?? null),
        (now) => now.meta[field] === asked,
        `meta.${field} set to “${story.meta[field] ?? ""}”`,
      );
    }
  }
  story.cast.forEach((member, index) => {
    const before = original.cast[index];
    if (!before) return;
    if (member.name !== before.name) {
      edit(
        (current) => setFullName(current, before.handle, member.name),
        (now) =>
          now.cast.find((other) => nameKey(other.handle) === nameKey(before.handle))?.name ===
          member.name.trim(),
        `${before.handle}'s full name set to “${member.name}”`,
      );
    }
    if (member.handle !== before.handle) {
      edit(
        (current) => renameCharacter(current, before.handle, member.handle),
        (now) => now.cast[index]?.handle === member.handle,
        `${before.handle} renamed ${member.handle}`,
      );
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
          // is made unless it declined, or there was nothing to do. The words it gave are kept,
          // so that later changes can't take them back.
          (now, current, changes) => {
            const was = heardVoices(current);
            heardVoices(now).forEach((voice, index) => {
              if (
                nameKey(voice.speaker) === nameKey(after.speaker) &&
                nameKey(was[index]?.speaker ?? "") !== nameKey(after.speaker)
              ) {
                given.push({ index, speaker: after.speaker, what: before.text });
              }
            });
            return (
              changes.length > 0 ||
              nameKey(find(current, original, before).speaker) === nameKey(after.speaker)
            );
          },
          `“${before.text}” said by ${after.speaker}`,
        );
      }
      if (after.ownDirection !== before.ownDirection) {
        const direction = after.ownDirection?.replace(/\s+/g, " ").trim() || null;
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
  const done = withoutSpareMarks(text, written);
  // Changes made one after another can undo each other (two stretches of one quote given to two
  // characters): every word each one gave must still be said as it gave it.
  if (given.length > 0) {
    const voices = heardVoices(parsed(done));
    for (const { index, speaker, what } of given) {
      if (nameKey(voices[index]?.speaker ?? "") !== nameKey(speaker)) {
        throw new RangeError(
          `write() can't make these changes together: “${what}” said by ${speaker} is undone by another.`,
        );
      }
    }
  }
  return done;
}

/**
 * Edits made one after another can leave a mark one of them needed and a later one made spare. A
 * mark whose name the edits wrote is taken out (or, with a direction, cut to `@(…)`) if every word
 * is still said by the same character in the same way. The author's own marks stay.
 */
function withoutSpareMarks(text: string, spans: readonly Span[]): string {
  if (spans.length === 0) return text;
  const goal = parsed(text);
  let current = text;
  let story = goal;
  let written = spans;
  // Each mark an edit inserted whole is tried once, in order; a name an edit replaced in the
  // author's own mark is the author's mark still.
  for (let tried = 0; ; ) {
    const mark = itemsOf(story).filter(
      (item): item is Extract<Item, { kind: "mark" }> =>
        item.kind === "mark" &&
        written.some(
          (span) =>
            span.from <= item.range.from &&
            item.range.to <= span.to &&
            nearAnother(story, span, written),
        ),
    )[tried];
    if (!mark) break;
    const found = shorter(current, mark).find((option) =>
      sameHearing(goal, parsed(applyChanges(current, [option]))),
    );
    if (!found) {
      tried++;
      continue;
    }
    written = afterChanges(written, [found]);
    current = applyChanges(current, [found]);
    story = parsed(current);
    // A mark cut to its direction is no longer a mark: the next one now has its place.
  }
  return current;
}

/** What an edit wrote, and which of the writer's changes it was. */
type Span = { from: number; to: number; change?: number };

/**
 * Whether another of the writer's changes wrote near this one: in its paragraph, or a few on
 * either side, where a speech carried over paragraphs could join them (§5.7). Only there can one
 * change make another's mark spare, so marks far from any other aren't read again.
 */
function nearAnother(story: Story, span: Span, written: readonly Span[]): boolean {
  const blockAt = (at: number) => {
    let low = 0;
    let high = story.blocks.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((story.blocks[middle] as Block).range.from <= at) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const here = blockAt(span.from);
  return written.some(
    (other) =>
      other.change !== undefined &&
      other.change !== span.change &&
      Math.abs(blockAt(other.from) - here) <= 3,
  );
}

/** Spans moved by changes, with what the changes inserted added (as `change`'s). */
function afterChanges(
  spans: readonly Span[],
  changes: readonly TextChange[],
  change?: number,
): Span[] {
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
  const moved: Span[] = spans.map((span) => ({
    ...span,
    from: at(span.from),
    to: Math.max(at(span.from), at(span.to)),
  }));
  let delta = 0;
  for (const made of sorted) {
    const from = made.from + delta;
    moved.push({
      from,
      to: from + made.insert.length,
      ...(change === undefined ? {} : { change }),
    });
    delta += made.insert.length - (made.to - made.from);
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
    return [
      {
        from: item.range.from + 2,
        to: item.range.to - 2,
        insert: ` ${escapeReferences(after.text)} `,
      },
    ];
  }
  if (item.kind === "instruction" && after.kind === "instruction") {
    const value =
      after.value === null ? undefined : escapeReferences(after.value.replace(/([{}\\])/g, "\\$1"));
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

/**
 * Throws for a field changed on the model that the writer doesn't write: a vocal sound's speaker,
 * a speech's text, the narrator, a group's direction… so that no change is quietly left out.
 */
function checkWritable(story: Story, original: Story): void {
  const refuse = (what: string) => {
    throw new RangeError(`write() can't change ${what}; use the edit functions on the text.`);
  };
  for (const key of ["narrator", "version"] as const) {
    if (story.meta[key] !== original.meta[key]) refuse(`meta.${key}`);
  }
  story.cast.forEach((member, index) => {
    if (member.about !== original.cast[index]?.about) refuse(`a cast member's about`);
  });
  if (story.groups.length !== original.groups.length) shapeError("groups");
  story.groups.forEach((group, index) => {
    const before = original.groups[index];
    for (const key of ["character", "direction", "visibility"] as const) {
      if (group[key] !== before?.[key]) refuse(`a group's ${key}`);
    }
  });
  story.blocks.forEach((block, index) => {
    const before = original.blocks[index] as Block;
    if (
      block.kind !== "break" &&
      before.kind !== "break" &&
      block.visibility !== before.visibility
    ) {
      refuse("a block's visibility");
    }
  });
  const fixed: Partial<Record<Item["kind"], readonly string[]>> = {
    speech: ["text", "quoted"],
    vocal: ["speaker", "direction"],
    image: ["alt", "src", "link"],
    mark: ["speaker", "direction"],
    direction: ["direction"],
    instruction: ["name"],
  };
  for (const [after, before] of itemPairs(story, original)) {
    for (const key of fixed[after.kind] ?? []) {
      const field = key as keyof typeof after;
      if (after[field] !== before[field as keyof typeof before]) refuse(`a ${after.kind}'s ${key}`);
    }
    // A speech's direction follows from its own (`ownDirection`), which is what is written.
    if (
      after.kind === "speech" &&
      before.kind === "speech" &&
      after.direction !== before.direction &&
      after.ownDirection === before.ownDirection
    ) {
      refuse("a speech's direction (set its ownDirection)");
    }
  }
}

function escapeBrackets(text: string): string {
  return escapeReferences(text.replace(/([[\]\\])/g, "\\$1"));
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
  const script = lineUp(middleA, middleB);
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

/** How many characters of two lines differ, their shared start and end aside. */
function differing(a: string, b: string): number {
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
  return a.length + b.length - 2 * (start + end);
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

type Step = "=" | "~" | "-" | "+";

/**
 * How `a`'s lines become `b`'s, as cheaply as can be found quickly: exactly (`cheapest`) where
 * that is quick; otherwise lined up first on the lines each has once, in the order both have them
 * (as patience diff does), and each part between them in turn; and as they come (`align`) where a
 * long part has none.
 */
function lineUp(a: readonly string[], b: readonly string[], depth = 0): Step[] {
  const exact = cheapest(a, b, 250_000);
  if (exact) return exact;
  // Parts within parts only so deep, so text made to split one line at a time stays quick.
  const anchors = depth < 12 ? uniqueInBoth(a, b) : [];
  if (anchors.length === 0) return align(a, b);
  const script: Step[] = [];
  let i = 0;
  let j = 0;
  for (const [x, y] of [...anchors, [a.length, b.length] as const]) {
    for (const step of lineUp(a.slice(i, x), b.slice(j, y), depth + 1)) script.push(step);
    if (x < a.length) script.push("=");
    i = x + 1;
    j = y + 1;
  }
  return script;
}

/**
 * The lines `a` and `b` each have once, as pairs of where they are, the most of them that come in
 * the same order in both.
 */
function uniqueInBoth(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const counts = new Map<string, [number, number, number]>();
  a.forEach((line, i) => {
    const count = counts.get(line);
    if (count) count[0]++;
    else counts.set(line, [1, 0, i]);
  });
  const pairs: Array<[number, number]> = [];
  const inB = new Map<string, number>();
  b.forEach((line, j) => {
    const count = counts.get(line);
    if (!count) return;
    count[1]++;
    inB.set(line, j);
  });
  for (const [line, [inA, timesB, i]] of counts) {
    if (inA === 1 && timesB === 1) pairs.push([i, inB.get(line) as number]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  // The longest run of pairs rising in `b` too (patience sorting).
  const tops: number[] = [];
  const back = new Int32Array(pairs.length);
  for (const [n, [, y]] of pairs.entries()) {
    let low = 0;
    let high = tops.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((pairs[tops[mid] as number] as [number, number])[1] < y) low = mid + 1;
      else high = mid;
    }
    back[n] = low > 0 ? (tops[low - 1] as number) : -1;
    tops[low] = n;
  }
  const chosen: Array<[number, number]> = [];
  for (
    let n = tops.length > 0 ? (tops[tops.length - 1] as number) : -1;
    n >= 0;
    n = back[n] as number
  ) {
    chosen.push(pairs[n] as [number, number]);
  }
  return chosen.reverse();
}

/**
 * The cheapest way, in characters, `a`'s lines become `b`'s: each line added or removed costs its
 * length, and a line changed within costs what differs. Lines are lined up within a band about
 * the diagonal, wide enough for the lines added or removed and as many again: null if that is more
 * pairs than `budget`.
 */
function cheapest(a: readonly string[], b: readonly string[], budget: number): Step[] | null {
  const n = a.length;
  const m = b.length;
  const SLACK = 64;
  const lo = Math.max(-n, Math.min(0, m - n) - SLACK);
  const hi = Math.min(m, Math.max(0, m - n) + SLACK);
  const width = hi - lo + 1;
  if ((n + 1) * width > budget) return null;
  // The cost of each pair, row by row, and the way each was reached: 1 along, 2 a line
  // removed, 3 a line added.
  const way = new Uint8Array((n + 1) * width);
  let previous = new Float64Array(width).fill(Number.POSITIVE_INFINITY);
  let row = new Float64Array(width);
  for (let i = 0; i <= n; i++) {
    row.fill(Number.POSITIVE_INFINITY);
    for (let k = 0; k < width; k++) {
      const j = i + k + lo;
      if (j < 0 || j > m) continue;
      if (i === 0 && j === 0) {
        row[k] = 0;
        continue;
      }
      let cost = Number.POSITIVE_INFINITY;
      let how = 0;
      if (i > 0 && k + 1 < width) {
        cost = (previous[k + 1] as number) + (a[i - 1] as string).length;
        how = 2;
      }
      if (j > 0 && k > 0) {
        const added = (row[k - 1] as number) + (b[j - 1] as string).length;
        if (added < cost) {
          cost = added;
          how = 3;
        }
      }
      if (i > 0 && j > 0) {
        const x = a[i - 1] as string;
        const y = b[j - 1] as string;
        const before = previous[k] as number;
        // What differs is at least what one is longer by: only worked out if it could do.
        if (x === y ? before <= cost : before + Math.abs(x.length - y.length) < cost) {
          const along = x === y ? before : before + differing(x, y);
          if (along <= cost) {
            cost = along;
            how = 1;
          }
        }
      }
      row[k] = cost;
      way[i * width + k] = how;
    }
    [previous, row] = [row, previous];
  }
  const script: Step[] = [];
  let i = n;
  let k = m - n - lo;
  while (i > 0 || k + lo + i > 0) {
    const how = way[i * width + k];
    if (how === 1) {
      script.push(a[i - 1] === b[i - 1 + k + lo] ? "=" : "~");
      i--;
    } else if (how === 2) {
      script.push("-");
      i--;
      k++;
    } else {
      script.push("+");
      k--;
    }
  }
  return script.reverse();
}

/**
 * How `a`'s lines become `b`'s: "=" keeps a line, "~" changes one within, "-" removes one and "+"
 * adds one. The writer changes lines within and only now and then adds or removes one, so lines
 * are lined up as they come, looking a little ahead where they part: linear in the text, however
 * many lines changed.
 */
function align(a: readonly string[], b: readonly string[]): Step[] {
  const script: Step[] = [];
  const AHEAD = 16;
  let i = 0;
  let j = 0;
  const push = (step: Step, count: number) => {
    for (let n = 0; n < count; n++) script.push(step);
  };
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
    // Where the two meet again, a little ahead, and what each way there costs in characters:
    // lines added, lines removed, or lines replaced up to the next they share; a line only like
    // the one it meets costs what differs. Less what then runs on the same, so a way that meets
    // for longer beats one that parts again at once.
    let best = { cost: Number.POSITIVE_INFINITY, removed: 1, added: 1 };
    const consider = (removed: number, added: number, cost: number) => {
      let score = cost;
      for (let run = 0; run < AHEAD; run++) {
        const x = a[i + removed + run];
        if (x === undefined || x !== b[j + added + run]) break;
        score -= x.length;
      }
      if (score < best.cost) best = { cost: score, removed, added };
    };
    const length = (lines: readonly string[], from: number, count: number) => {
      let sum = 0;
      for (let n = from; n < from + count; n++) sum += (lines[n] as string).length;
      return sum;
    };
    for (let k = 1; k <= AHEAD; k++) {
      const x = a[i + k];
      const y = b[j + k];
      if (x === undefined && y === undefined) break;
      if (x !== undefined && x === y) {
        consider(k, k, length(a, i, k) + length(b, j, k));
        break;
      }
    }
    for (let q = 1; q <= AHEAD && j + q < b.length && i < a.length; q++) {
      const y = b[j + q] as string;
      if (a[i] !== y && !similar(a[i] as string, y)) continue;
      consider(0, q, length(b, j, q) + differing(a[i] as string, y));
      break;
    }
    for (let p = 1; p <= AHEAD && i + p < a.length && j < b.length; p++) {
      const x = a[i + p] as string;
      if (x !== b[j] && !similar(x, b[j] as string)) continue;
      consider(p, 0, length(a, i, p) + differing(x, b[j] as string));
      break;
    }
    // Nothing met within reach: a line goes for a line.
    const removed = Math.min(best.removed, a.length - i);
    const added = Math.min(best.added, b.length - j);
    push("-", removed);
    push("+", added);
    i += removed;
    j += added;
  }
  return script;
}
