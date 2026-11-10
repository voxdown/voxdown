/**
 * Edits that follow the spec's rules for tools (§13): each returns the smallest set of text
 * changes that makes it, and never touches the author's spacing, quotation marks or line breaks
 * elsewhere. Apply them with `applyChanges`, then parse again.
 */
import { baseSpeaker } from "./groups";
import { scanName } from "./inline";
import type { Block, Group, Item, Line, Speech, Story, Vocal } from "./model";
import { nameKey } from "./names";
import { parse } from "./parse";
import type { Range } from "./source";
import { readYaml } from "./yaml";

/** Replace `from`–`to` with `insert`. An insertion has `from === to`. */
export type TextChange = { from: number; to: number; insert: string };

/** Applies changes made against the same text. Overlapping changes are an error. */
export function applyChanges(source: string, changes: readonly TextChange[]): string {
  const sorted = changes
    .map((change, order) => ({ ...change, order }))
    .sort((a, b) => a.from - b.from || a.to - b.to || a.order - b.order);
  let out = "";
  let at = 0;
  for (const change of sorted) {
    if (change.from < at) throw new RangeError("Two changes overlap.");
    out += source.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return out + source.slice(at);
}

/** Whether a word can be written after `@` as a name (§5.2): exactly what the parser reads as one. */
export function isName(name: string): boolean {
  return name.length > 0 && scanName(name, 0, name.length) === name.length;
}

function checkName(name: string): void {
  if (!isName(name)) {
    throw new RangeError(
      `“${name}” can't be written after @: a name is one word, starting with a letter.`,
    );
  }
}

/** The cast's spelling of a name, else the name as given (§13.3). */
function spelled(story: Story, name: string): string {
  if (nameKey(name) === nameKey(story.meta.narrator)) return story.meta.narrator;
  return story.cast.find((member) => nameKey(member.handle) === nameKey(name))?.handle ?? name;
}

/** Parentheses inside a direction must balance (§6.1); unbalanced ones are escaped. */
function directionText(direction: string): string {
  let depth = 0;
  for (const char of direction) {
    if (char === "(") depth++;
    else if (char === ")" && --depth < 0) break;
  }
  return depth === 0 ? direction : direction.replace(/([()])/g, "\\$1");
}

type Place = { block: Block; line: Line; groups: readonly Group[] };

/** The block and line an item is on. */
function place(story: Story, item: Item): Place {
  for (const block of story.blocks) {
    if (block.kind === "break") continue;
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    for (const line of lines) {
      if (line.items.includes(item)) return { block, line, groups: block.groups };
    }
  }
  throw new RangeError("That item is not part of this story.");
}

const speechesOf = (line: Line) =>
  line.items.filter((item): item is Speech => item.kind === "speech");

/** Whether a `@(…)` is this stretch's own: just before it with only spaces between, or inside it. */
function ownDirectionMark(story: Story, speech: Speech): Range | null {
  const mark = speech.directionMark;
  if (!mark) return null;
  const inside = mark.range.from >= speech.range.from && mark.range.to <= speech.range.to;
  const before =
    mark.range.to <= speech.range.from &&
    story.source.slice(mark.range.to, speech.range.from).trim() === "";
  return inside || before ? mark.range : null;
}

/** Whether a speech's mark gave a sound of the character's before it on its line: `@Wanda [gasp] “…”`. */
function sharesMark(line: Line, speech: Speech): boolean {
  return line.items.some(
    (item) =>
      item.kind === "vocal" &&
      item.mark !== undefined &&
      item.mark === speech.mark &&
      item.range.from < speech.range.from,
  );
}

/**
 * The stretches of one quote that runs over several lines (§5.7), in order. A mark can't go between
 * them, so an edit to one is an edit to all, made where the quote's mark is.
 */
function quoteLines(story: Story, speech: Speech): Speech[] {
  const { block } = place(story, speech);
  if (block.kind !== "paragraph") return [speech];
  const lines = block.lines.map(speechesOf);
  const at = (target: Speech) => lines.findIndex((stretches) => stretches.includes(target));
  // The last stretch of one line and the first of the next, inside one open quote.
  const joined = (a: Speech | undefined, b: Speech | undefined) =>
    a !== undefined &&
    b !== undefined &&
    a.quoted &&
    b.quoted &&
    !a.closeQuote &&
    !b.openQuote &&
    a.mark === b.mark &&
    at(b) === at(a) + 1 &&
    lines[at(a)]?.at(-1) === a &&
    lines[at(b)]?.[0] === b;
  const all = lines.flat();
  let from = all.indexOf(speech);
  let to = from;
  while (joined(all[from - 1], all[from])) from--;
  while (joined(all[to], all[to + 1])) to++;
  return all.slice(from, to + 1);
}

/** Whether a speech is the first stretch its mark gives on its line. */
function firstOfMark(line: Line, speech: Speech): boolean {
  return !speechesOf(line).some(
    (other) =>
      other !== speech && other.mark === speech.mark && other.range.from < speech.range.from,
  );
}

/** The speeches later on the line that carry this one on (§5.6), directly or through each other. */
function carriedOn(line: Line, speech: Speech): Speech[] {
  const chain: Speech[] = [];
  let last: Speech = speech;
  for (const other of speechesOf(line)) {
    if (other.range.from <= speech.range.from || !other.quoted) continue;
    if (other.continued && other.speaker === last.speaker && ownsChain(line, last, other)) {
      chain.push(other);
      last = other;
    } else if (!other.continued) {
      // Another speech ended later; quotes after it carry that one on instead.
      if (other.mark !== speech.mark) break;
    }
  }
  return chain;
}

/** Whether `later` carries on `earlier`: no other quoted speech ended between them. */
function ownsChain(line: Line, earlier: Speech, later: Speech): boolean {
  return !speechesOf(line).some(
    (other) =>
      other.quoted &&
      other !== earlier &&
      other.range.from > earlier.range.from &&
      other.range.from < later.range.from,
  );
}

/** A mark for `speaker` with an optional direction, as §13.3 writes it. */
function markText(speaker: string, direction: string | null): string {
  return direction ? `@${speaker} (${directionText(direction)})` : `@${speaker}`;
}

/**
 * Gives a stretch of speech or narration to another character (§13.4). The name is written as
 * the cast spells it. Later quotes on the line that carried the speech on keep their speaker.
 * Like every edit here, it changes only what it says it does: where that can't be done without
 * changing other words or voices, it returns no changes.
 */
export function setSpeaker(story: Story, speech: Speech, name: string): TextChange[] {
  // A quote over several lines is one speech: no mark can go between its lines (§5.7).
  const quote = quoteLines(story, speech);
  const first = quote[0] as Speech;
  const key = nameKey(name);
  // The stretch may split: given to a character, narration that holds a quote gives the quote and
  // keeps the rest of its words. Each of its words goes to the new speaker or stays, said as
  // before, and one at least goes.
  const promise: Promise = {
    inside: (was, now) =>
      (nameKey(now.speaker) === key || sameName(now.speaker, was.speaker)) &&
      now.direction === was.direction,
    wanted: (was, now) => ({
      speaker: nameKey(now.speaker) === key ? now.speaker : was.speaker,
      direction: was.direction,
    }),
    some: (now) => now.some((char) => nameKey(char.speaker) === key),
  };
  // The new mark goes directly before the quote it gives (§13.3), or else before the words.
  const opens = quoteWithin(story, first);
  if (opens !== undefined) {
    const made = settled(story, quote, speakerChanges(story, first, name, opens), promise);
    if (made.length > 0) return made;
  }
  return settled(story, quote, speakerChanges(story, first, name), promise);
}

const OPENERS = new Set(['"', "'", "“", "‘", "„", "‚", "«", "»", "‹", "「", "『"]);

/** In narration nothing marks, where the first quote it holds opens. */
function quoteWithin(story: Story, speech: Speech): number | undefined {
  if (speech.quoted || speech.mark || speech.directionMark) return undefined;
  const source = story.source;
  const { line } = place(story, speech);
  const others = line.items.filter((item) => item !== speech).map((item) => item.range);
  for (let at = speech.textRange.from + 1; at < speech.textRange.to; at++) {
    const char = source[at] as string;
    if (!OPENERS.has(char) || /[\p{L}\p{N}\\]/u.test(source[at - 1] as string)) continue;
    if (others.some((range) => at >= range.from && at < range.to)) continue;
    return at;
  }
  return undefined;
}

function speakerChanges(
  story: Story,
  speech: Speech,
  name: string,
  quoteAt?: number,
): TextChange[] {
  checkName(name);
  const speaker = spelled(story, name);
  if (nameKey(speaker) === nameKey(speech.speaker)) return [];
  const { line, groups } = place(story, speech);
  const changes: TextChange[] = [];
  const keep = (other: Speech) => {
    const own = ownDirectionMark(story, other);
    if (own) {
      changes.push({ ...own, insert: markText(speech.speaker, other.ownDirection) });
    } else if (other.openQuote) {
      const insert = `${markText(speech.speaker, other.ownDirection)} `;
      changes.push({ from: other.openQuote.from, to: other.openQuote.from, insert });
    }
  };
  const own = ownDirectionMark(story, speech);
  const toBase = nameKey(speaker) === nameKey(baseSpeaker(groups, story.meta.narrator));
  if (speech.mark && !speech.continued && firstOfMark(line, speech) && !sharesMark(line, speech)) {
    const mark = speech.mark;
    if (toBase && !speech.quoted) {
      // Narration needs no mark: `@Gerald (dry) Well.` becomes `@(dry) Well.`
      if (mark.directionRange) {
        changes.push({ from: mark.range.from, to: mark.directionRange.from, insert: "@" });
      } else {
        changes.push({ ...removeWithSpace(story.source, mark.range), insert: "" });
      }
    } else {
      changes.push({ ...mark.nameRange, insert: speaker });
    }
  } else if (own) {
    // `@(quieter) “Oh dear.”` becomes `@Gerald (quieter) “Oh dear.”`; `@()Well` becomes `@Gerald Well`.
    const spaced =
      speech.ownDirection === null && !/^\s/.test(story.source.slice(own.to, own.to + 1));
    changes.push({
      ...own,
      insert: `${markText(speaker, speech.ownDirection)}${spaced ? " " : ""}`,
    });
  } else {
    // A quote carried on from a mark keeps how it is said: `@Zed (yawning) “Very.”`.
    const at = speech.openQuote?.from ?? quoteAt ?? speech.textRange.from;
    changes.push({ from: at, to: at, insert: `${markText(speaker, speech.ownDirection)} ` });
  }
  // Words that open with `(` would read as the new mark's direction: `@Gerald \(sighs)`.
  if (!speech.quoted && quoteAt === undefined && story.source[speech.textRange.from] === "(") {
    const at = speech.textRange.from;
    changes.push({ from: at, to: at, insert: "\\" });
  }
  carriedOn(line, speech).forEach(keep);
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Sets how a stretch is said (§13.3), or removes its own direction with `null` (§13.5). A
 * direction a group gives can't be removed this way; give the stretch another one instead.
 */
export function setDirection(story: Story, speech: Speech, direction: string | null): TextChange[] {
  const quote = quoteLines(story, speech);
  const changes = directionChanges(story, quote[0] as Speech, direction);
  const value = direction?.trim() || null;
  return settled(story, quote, changes, {
    inside: (was, now) =>
      sameName(now.speaker, was.speaker) && (value === null || now.direction === value),
    wanted: (was, now) => ({ speaker: was.speaker, direction: value ?? now.direction }),
  });
}

// What an edit may change: every character a listener hears, and who says it and how

/** Spaces, quotation marks and escapes' backslashes are not words: marks may move them about. */
const NOT_WORDS = /[\s"'“”‘’„‚«»‹›「」『』\\]/u;

type Voice = { speaker: string; direction: string | null };

/** One character a listener hears, in speech or in a character's sound, and who says it and how. */
type Heard = Voice & {
  char: string;
  /** Where it is in the source. */
  at: number;
  item: Speech | Vocal;
  /** Whether it is the first character heard of its item, so a mark can go before the item. */
  first: boolean;
  /** Whether it belongs to the stretch being edited. */
  target: boolean;
};

function heard(story: Story, target: readonly Item[] = []): Heard[] {
  const out: Heard[] = [];
  for (const line of allLines(story)) {
    // Marks, directions, instructions and notes can sit inside a stretch's range: not heard.
    const unheard = line.items
      .filter((item) => item.kind !== "speech" && item.kind !== "vocal")
      .map((item) => item.range);
    for (const item of line.items) {
      let from: number;
      let to: number;
      if (item.kind === "speech") ({ from, to } = item.textRange);
      else if (item.kind === "vocal") {
        from = story.source.indexOf("[", item.range.from) + 1;
        to = item.range.to - 1;
      } else continue;
      let first = true;
      for (let at = from; at < to; at++) {
        const char = story.source[at] as string;
        if (NOT_WORDS.test(char)) continue;
        if (item.kind === "speech" && unheard.some((range) => at >= range.from && at < range.to)) {
          continue;
        }
        out.push({ char, at, item, first, target: target.includes(item), ...voiceOf(item) });
        first = false;
      }
    }
  }
  return out;
}

const voiceOf = (item: Speech | Vocal): Voice => ({
  speaker: item.speaker,
  direction: item.direction,
});
const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

type Promise = {
  /** Whether a character of the edited stretch is said as the edit promises. */
  inside: (was: Heard, now: Heard) => boolean;
  /** The voice to give it back when it isn't. */
  wanted: (was: Heard, now: Heard) => Voice;
  /** Whether the edited stretch's characters, taken together, show the edit was made. */
  some?: (now: Heard[]) => boolean;
};

/**
 * Makes an edit keep its promise. After the changes, every character heard must be the same and
 * in the same order, the edited stretch's said as `promise` says, and every other one said by the
 * same character in the same way. A mark can reach further than its stretch (words without quotes
 * run to the end of the line, a direction to the next speech, a quote carries over lines and
 * paragraphs), so wherever a voice changed, a mark of its own gives it back: `@Narrator`,
 * `@Gerald (yawning)`, `@(quieter)` or `@()`. If that can't be done, there are no changes.
 */
function settled(
  story: Story,
  target: readonly Speech[],
  changes: TextChange[],
  promise: Promise,
): TextChange[] {
  if (changes.length === 0) return changes;
  const before = heard(story, target);
  let current = changes;
  for (let round = 0; round < 16; round++) {
    const result = kept(story, before, current, promise);
    if (result === "broken") return [];
    if (result === "kept") return tidied(story, before, current, promise);
    const { edited, now, voice } = result;
    const fix = giveBack(edited, now, voice);
    const next = fix && editAt(current, fix.at, fix.at, fix.insert);
    if (!next) return [];
    current = next;
  }
  return [];
}

type Missed = { edited: Story; now: Heard; voice: Voice };

/**
 * Whether the changes keep the promise: "kept", "broken" (words changed, or the edit didn't
 * happen), or the first character said wrongly and the voice it should have.
 */
function kept(
  story: Story,
  before: readonly Heard[],
  changes: TextChange[],
  promise: Promise,
): "kept" | "broken" | Missed {
  let edited: Story;
  try {
    edited = parse(applyChanges(story.source, changes));
  } catch {
    return "broken";
  }
  const after = heard(edited);
  if (after.length !== before.length || after.some((now, i) => now.char !== before[i]?.char)) {
    return "broken";
  }
  const wrong = before.findIndex((was, i) => {
    const now = after[i] as Heard;
    return was.target
      ? !promise.inside(was, now)
      : !sameName(now.speaker, was.speaker) || now.direction !== was.direction;
  });
  if (wrong >= 0) {
    const was = before[wrong] as Heard;
    const now = after[wrong] as Heard;
    return { edited, now, voice: was.target ? promise.wanted(was, now) : voiceOf(was.item) };
  }
  const edits = after.filter((_, i) => before[i]?.target);
  return !promise.some || promise.some(edits) ? "kept" : "broken";
}

/**
 * The changes with nothing left over: a mark the edit left claiming nothing is removed (as §13.5
 * removes a mark no longer needed), and so is a mark given back that turns out not to be needed.
 * Each removal is kept only if the promise still holds.
 */
function tidied(
  story: Story,
  before: readonly Heard[],
  changes: TextChange[],
  promise: Promise,
): TextChange[] {
  const idleBefore = story.warnings.filter((warning) => warning.code === "idle-mark").length;
  let current = changes;
  for (let round = 0; round < 8; round++) {
    const edited = parse(applyChanges(story.source, current));
    const idle = edited.warnings.filter((warning) => warning.code === "idle-mark");
    if (idle.length <= idleBefore) break;
    let removed = false;
    for (const warning of idle) {
      const range = removeWithSpace(edited.source, warning.range);
      const next = editAt(current, range.from, range.to, "");
      if (next && kept(story, before, next, promise) === "kept") {
        current = next;
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  // Marks given back that another one already covers.
  for (const change of [...current]) {
    if (change.from !== change.to || !change.insert.startsWith("@")) continue;
    const marks = change.insert.match(/@(?:\([^)]*\)|[^\s(]+(?: \([^)]*\))?) \\?/g) ?? [];
    if (marks.length < 2 && current.length < 2) continue;
    for (const mark of marks) {
      const insert = change.insert.replace(mark, "");
      const next = current.map((other) => (other === change ? { ...other, insert } : other));
      if (insert === change.insert) continue;
      const without = next.filter((other) => other.from !== other.to || other.insert !== "");
      if (kept(story, before, without, promise) === "kept") {
        current = without;
        break;
      }
    }
  }
  return current;
}

/**
 * Where a speech or a character's sound is among everything heard, by its first character: edits
 * never move words, so this finds the same item again after other edits. -1 for an item with no
 * words in it. (For the writer; not part of the package's API.)
 */
export function heardIndex(story: Story, item: Speech | Vocal): number {
  return heard(story).findIndex((char) => char.item === item);
}

/** Whether two stories have the same words heard, each said by the same character in the same way. */
export function sameHearing(a: Story, b: Story): boolean {
  return sameHeard(heard(a), heard(b));
}

/** The same characters, each said by the same character in the same way. */
function sameHeard(first: readonly Heard[], second: readonly Heard[]): boolean {
  return (
    first.length === second.length &&
    first.every((was, i) => {
      const now = second[i] as Heard;
      return (
        now.char === was.char &&
        sameName(now.speaker, was.speaker) &&
        now.direction === was.direction
      );
    })
  );
}

/** The speech or sound whose first character is at `index` among everything heard. */
export function heardItem(story: Story, index: number): Speech | Vocal | undefined {
  return heard(story)[index]?.item;
}

/** Where, and with what mark, a character heard gets `voice` back: before its stretch or sound. */
function giveBack(story: Story, char: Heard, voice: Voice): { at: number; insert: string } | null {
  const source = story.source;
  const item = char.item;
  let at: number;
  if (char.first) {
    at = item.kind === "speech" ? (item.openQuote?.from ?? item.textRange.from) : item.range.from;
  } else {
    // Within a stretch, a mark needs no letter or digit straight before it (§5.2).
    at = char.at;
    if (/[\p{L}\p{N}]/u.test(source[at - 1] ?? "")) return null;
  }
  const direction = voice.direction ? `@(${directionText(voice.direction)})` : "@()";
  const sameSpeaker = sameName(voice.speaker, item.speaker);
  let insert =
    item.kind === "speech" && sameSpeaker
      ? `${direction} `
      : `${markText(spelled(story, voice.speaker), voice.direction)} `;
  // Words that open with `(` would read as a new name's direction.
  if (!sameSpeaker && source[at] === "(") insert += "\\";
  return { at, insert };
}

/**
 * Adds a change given in the places of the text the changes make (`from`–`to` replaced by
 * `insert`) to the changes, which are made against the original. A change next to or inside
 * another's own text edits that text; one that crosses its edge can't be made.
 */
function editAt(
  changes: TextChange[],
  from: number,
  to: number,
  insert: string,
): TextChange[] | null {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let delta = 0;
  for (const [index, change] of sorted.entries()) {
    const start = change.from + delta;
    const end = start + change.insert.length;
    const within = from >= start && to <= end && (from === to ? change.insert.length > 0 : true);
    if (from === to ? from < start : to <= start) break;
    if (within) {
      // In this change's own text, or at its edges: edit that text.
      const text = change.insert;
      sorted[index] = {
        ...change,
        insert: text.slice(0, from - start) + insert + text.slice(to - start),
      };
      return sorted;
    }
    if (from < end && to > start) return null;
    delta += change.insert.length - (change.to - change.from);
  }
  const at = from - delta;
  return [...sorted, { from: at, to: at + (to - from), insert }].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

/** The changes for a new direction, before the stretches after it are kept as they were. */
function directionChanges(story: Story, speech: Speech, direction: string | null): TextChange[] {
  const value = direction?.trim() || null;
  if (value === speech.ownDirection) return [];
  const { line, groups } = place(story, speech);
  const own = ownDirectionMark(story, speech);
  // A mark that also gives a sound of the character's before this stretch keeps its direction.
  const markFirst =
    speech.mark && !speech.continued && firstOfMark(line, speech) && !sharesMark(line, speech);

  if (value !== null) {
    const text = directionText(value);
    if (own) return [{ from: own.from + 2, to: own.to - 1, insert: text }];
    if (markFirst && speech.mark) {
      const range = speech.mark.directionRange;
      if (range) return [{ from: range.from + 1, to: range.to - 1, insert: text }];
      const at = speech.mark.nameRange.to;
      return [{ from: at, to: at, insert: ` (${text})` }];
    }
    const at = speech.openQuote?.from ?? speech.textRange.from;
    return [{ from: at, to: at, insert: `@(${text}) ` }];
  }

  if (speech.ownDirection === null) return [];
  if (own) {
    // Without its `@(…)`, the stretch would fall back to its mark's or the carried direction.
    const fallback =
      speech.mark && !speech.continued
        ? previousOfMark(line, speech)
        : carriedDirection(line, speech);
    return fallback === null
      ? [{ ...removeWithSpace(story.source, own), insert: "" }]
      : [{ ...own, insert: "@()" }];
  }
  if (markFirst && speech.mark?.directionRange) {
    const mark = speech.mark;
    const needed =
      speech.quoted ||
      nameKey(speech.speaker) !== nameKey(baseSpeaker(groups, story.meta.narrator));
    if (!needed) return [{ ...removeWithSpace(story.source, mark.range), insert: "" }];
    const directionRange = mark.directionRange as Range;
    return [{ from: mark.nameRange.to, to: directionRange.to, insert: "" }];
  }
  // A direction carried over from the speech this one carries on.
  if (speech.openQuote) {
    const at = speech.openQuote.from;
    return [{ from: at, to: at, insert: "@() " }];
  }
  return [];
}

function allLines(story: Story): Line[] {
  return story.blocks.flatMap((block) =>
    block.kind === "break" ? [] : block.kind === "heading" ? [block.line] : block.lines,
  );
}

/** The direction a stretch of a mark's speech would have without its `@(…)`: the one before. */
function previousOfMark(line: Line, speech: Speech): string | null {
  const before = speechesOf(line).filter(
    (other) => other.mark === speech.mark && other.range.from < speech.range.from,
  );
  const previous = before[before.length - 1];
  return previous ? previous.ownDirection : (speech.mark?.direction ?? null);
}

/** The direction a carried-on speech would have without a `@(…)` of its own. */
function carriedDirection(line: Line, speech: Speech): string | null {
  if (!speech.continued) return null;
  const before = speechesOf(line).filter(
    (other) => other.quoted && other.range.to <= speech.range.from,
  );
  return before[before.length - 1]?.ownDirection ?? null;
}

/** A range widened by one space after it, or else one before it (§13.5). */
function removeWithSpace(source: string, range: Range): Range {
  if (source[range.to] === " ") return { from: range.from, to: range.to + 1 };
  if (source[range.from - 1] === " ") return { from: range.from - 1, to: range.to };
  return range;
}

/**
 * Renames a character's short name, the word after `@` (§13.6): in the cast, the `narrator:` key
 * and every mark. Their full name is left alone.
 */
export function renameCharacter(story: Story, from: string, to: string): TextChange[] {
  checkName(to);
  const key = nameKey(from);
  if (key === nameKey(to)) return [];
  const known = [
    story.meta.narrator,
    ...story.cast.map((member) => member.handle),
    ...heard(story).map((char) => char.speaker),
  ];
  if (known.some((name) => nameKey(name) === nameKey(to))) {
    throw new RangeError(`There is already a character called “${to}”.`);
  }
  const changes: TextChange[] = [];
  const marks = [
    ...story.groups.flatMap((group) => (group.mark ? [group.mark] : [])),
    ...story.blocks.flatMap((block) => {
      if (block.kind === "break") return [];
      const lines = block.kind === "heading" ? [block.line] : block.lines;
      return lines.flatMap((line) => line.items.filter((item) => item.kind === "mark"));
    }),
  ];
  for (const mark of marks) {
    if (mark.kind === "mark" && nameKey(mark.speaker) === key) {
      changes.push({ ...mark.nameRange, insert: to });
    }
  }
  let narratorKey = false;
  for (const entry of frontMatterKeys(story)) {
    if (
      entry.path.length === 2 &&
      entry.path[0] === "cast" &&
      nameKey(entry.path[1] ?? "") === key
    ) {
      changes.push({ ...entry.range, insert: to });
    }
    if (entry.path.length === 1 && entry.path[0] === "narrator") {
      narratorKey = true;
      const value = valueRange(story.source, entry.range);
      if (nameKey(story.source.slice(value.from, value.to).replace(/^["']|["']$/g, "")) === key)
        changes.push({ ...value, insert: to });
    }
  }
  // The narrator renamed: narration follows only if the front matter names them.
  if (key === nameKey(story.meta.narrator) && !narratorKey) {
    changes.push(...setMeta(story, "narrator", to));
  }
  const sorted = changes.sort((a, b) => a.from - b.from);
  // Every word still said by the same character, now under the new name, and in the same way.
  const after = heard(parse(applyChanges(story.source, sorted)));
  const before = heard(story);
  const same =
    after.length === before.length &&
    before.every((was, i) => {
      const now = after[i] as Heard;
      const speaker = nameKey(was.speaker) === key ? to : was.speaker;
      return (
        now.char === was.char && sameName(now.speaker, speaker) && now.direction === was.direction
      );
    });
  return same ? sorted : [];
}

/**
 * Sets a character's full name in the cast (§4.3, §13.6), adding the cast or the character to
 * the front matter when they aren't there yet. Nothing in the story changes.
 */
export function setFullName(story: Story, handle: string, name: string): TextChange[] {
  checkName(handle);
  const keys = frontMatterKeys(story);
  const entry = keys.find(
    (k) =>
      k.path.length === 2 && k.path[0] === "cast" && nameKey(k.path[1] ?? "") === nameKey(handle),
  );
  if (!entry) {
    const written = spelled(story, handle);
    const value = name === written ? "" : ` ${yamlScalar(name)}`;
    return addToFrontMatter(story, ["cast"], `${written}:${value}`);
  }
  const value = valueRange(story.source, entry.range);
  const current = story.source.slice(value.from, value.to);
  const nameKeyEntry = keys.find(
    (k) =>
      k.path.length === 3 &&
      k.path[0] === "cast" &&
      k.path[1] === entry.path[1] &&
      k.path[2] === "name",
  );
  if (nameKeyEntry) {
    return [{ ...replaceValue(story.source, nameKeyEntry.range), insert: ` ${yamlScalar(name)}` }];
  }
  const hasChildren = keys.some(
    (k) => k.path.length === 3 && k.path[0] === "cast" && k.path[1] === entry.path[1],
  );
  if (hasChildren) {
    const child = keys.find(
      (k) => k.path.length === 3 && k.path[0] === "cast" && k.path[1] === entry.path[1],
    ) as YamlEntry;
    const indent = lineIndent(story.source, child.range.from);
    const at = lineStart(story.source, child.range.from);
    return [{ from: at, to: at, insert: `${indent}name: ${yamlScalar(name)}${eol(story)}` }];
  }
  if (current.trim() === "" && name === entry.path[1]) return [];
  return [{ ...replaceValue(story.source, entry.range), insert: ` ${yamlScalar(name)}` }];
}

/** Book details in the front matter: `title`, `subtitle`, `author`, `language`, `narrator`… */
export function setMeta(story: Story, key: string, value: string | null): TextChange[] {
  const entry = frontMatterKeys(story).find((k) => k.path.length === 1 && k.path[0] === key);
  if (entry) {
    if (value === null) {
      const from = lineStart(story.source, entry.range.from);
      const end = replaceValue(story.source, entry.range).to;
      const to = story.source.indexOf("\n", end);
      return [{ from, to: to < 0 ? end : to + 1, insert: "" }];
    }
    return [{ ...replaceValue(story.source, entry.range), insert: ` ${yamlScalar(value)}` }];
  }
  if (value === null) return [];
  return addToFrontMatter(story, [], `${key}: ${yamlScalar(value)}`);
}

/**
 * Adds a sound after the word at `offset` (§13.3): one space, then the sound. An offset inside a
 * word moves to its end; inside a mark, a direction, an instruction, a note or another sound, past
 * it; and the sound never goes straight after a mark, where it would be the character's own
 * (§8.2), nor in the front matter. Returns no changes if the story would then be heard differently.
 */
export function insertSound(story: Story, offset: number, description: string): TextChange[] {
  const source = story.source;
  inText(source, offset);
  if (description.trim() === "") return [];
  const items = allLines(story).flatMap((line) => line.items);
  let at = Math.max(offset, bodyStart(story));
  // A word ends at a space, or where a mark starts.
  const marks = new Map(
    items.flatMap((item) =>
      item.kind === "mark" || item.kind === "direction"
        ? [[item.range.from, item.range.to] as const]
        : [],
    ),
  );
  for (let moved = true; moved; ) {
    moved = false;
    while (at < source.length && !/\s/.test(source[at] as string) && !marks.has(at)) at++;
    for (const item of items) {
      if (item.kind === "speech") continue;
      if (item.range.from < at && at < item.range.to) {
        at = item.range.to;
        moved = true;
      } else if ((item.kind === "mark" || item.kind === "direction") && item.range.to === at) {
        // After a mark, the sound follows the first word the mark gives, past any other mark.
        let next = at;
        while (source[next] === " " || source[next] === "\t") next++;
        const end = marks.get(next);
        if (end !== undefined) {
          at = end;
          moved = true;
        } else if (next > at && next < source.length && !/\s/.test(source[next] as string)) {
          at = next;
          moved = true;
        }
      }
    }
  }
  const insert = ` [${description.trim().replace(/([[\]\\])/g, "\\$1")}]`;
  const changes = [{ from: at, to: at, insert }];
  const after = parse(applyChanges(source, changes));
  const added = allLines(after)
    .flatMap((line) => line.items)
    .some((item) => item.kind === "sound" && item.range.from === at + 1);
  return added && sameHearing(story, after) ? changes : [];
}

/**
 * Puts a page turn, pause, note or any other line on a line of its own before the line holding
 * `offset` (§13.3), as in `{page}`, `{pause 2s}` or `%% Slowly. %%`: never in the front matter or
 * inside a note, with the line ending of the lines around it, and before a paragraph as a paragraph
 * of its own. Returns no changes if the rest of the story would then be heard differently.
 */
export function insertLine(story: Story, offset: number, text: string): TextChange[] {
  const source = story.source;
  inText(source, offset);
  let at = Math.max(lineStart(source, offset), bodyStart(story));
  for (const item of allLines(story).flatMap((line) => line.items)) {
    if (item.kind === "note" && item.range.from < at && at < item.range.to) {
      at = Math.max(lineStart(source, item.range.from), bodyStart(story));
    }
  }
  const end = source.indexOf("\n", at);
  const ending =
    end >= 0
      ? source[end - 1] === "\r"
        ? "\r\n"
        : "\n"
      : at > 0
        ? source[at - 2] === "\r"
          ? "\r\n"
          : "\n"
        : eol(story);
  // Before a paragraph's first line, the line is a paragraph of its own, so a quote that the
  // paragraph carries on still does (§5.7). After front matter that ends the file without a line
  // break, it goes after a new one.
  const opens = at === bodyStart(story) || /\n[ \t]*\r?\n$/.test(source.slice(0, at));
  const insert =
    at === source.length && at > 0 && !source.endsWith("\n")
      ? `${ending}${text}`
      : opens && at < source.length
        ? `${text}${ending}${ending}`
        : `${text}${ending}`;
  const changes = [{ from: at, to: at, insert }];
  const after = parse(applyChanges(source, changes));
  const rest = heard(after).filter((char) => char.at < at || char.at >= at + insert.length);
  return sameHeard(heard(story), rest) ? changes : [];
}

function inText(source: string, offset: number): void {
  if (!(Number.isInteger(offset) && offset >= 0 && offset <= source.length)) {
    throw new RangeError(`There is no offset ${offset} in a text of ${source.length} characters.`);
  }
}

/** Where the story itself starts: after the front matter's closing line, or a byte order mark. */
function bodyStart(story: Story): number {
  const front = story.frontMatter;
  if (!front) return story.source.startsWith("\uFEFF") ? 1 : 0;
  const end = story.source.indexOf("\n", front.range.to);
  return end < 0 ? story.source.length : end + 1;
}

// Front matter

type YamlEntry = { path: readonly string[]; range: Range };

function frontMatterKeys(story: Story): YamlEntry[] {
  const front = story.frontMatter;
  if (!front) return [];
  const rawFrom = story.source.indexOf("\n", front.range.from) + 1;
  return readYaml(front.raw, rawFrom).keys;
}

function eol(story: Story): string {
  return /\r\n/.test(story.source) ? "\r\n" : "\n";
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

function lineIndent(source: string, offset: number): string {
  const start = lineStart(source, offset);
  return /^[ \t]*/.exec(source.slice(start))?.[0] ?? "";
}

/** What follows `key:` on its line, without a comment. */
function valueRange(source: string, key: Range): Range {
  const colon = source.indexOf(":", key.to);
  let end = source.indexOf("\n", colon);
  if (end < 0) end = source.length;
  if (source[end - 1] === "\r") end--;
  let text = source.slice(colon + 1, end);
  const comment = /(^|\s)#/.exec(text);
  if (comment) text = text.slice(0, comment.index);
  const lead = text.length - text.trimStart().length;
  return { from: colon + 1 + lead, to: colon + 1 + text.trimEnd().length };
}

/**
 * From just after `key:` to the end of its value, continuation lines included. A value on one
 * line ends before a comment after it, so the comment stays.
 */
function replaceValue(source: string, key: Range): Range {
  const colon = source.indexOf(":", key.to);
  const indent = lineIndent(source, key.from).length;
  let end = source.indexOf("\n", colon);
  if (end < 0) end = source.length;
  const lineEnd = end;
  for (;;) {
    if (end >= source.length) break;
    const next = source.indexOf("\n", end + 1);
    const lineText = source.slice(end + 1, next < 0 ? source.length : next).replace(/\r$/, "");
    const lineIndentLength = /^[ \t]*/.exec(lineText)?.[0].length ?? 0;
    if (lineText.trim() === "" || lineIndentLength <= indent || lineText.trim() === "---") break;
    end = next < 0 ? source.length : next;
    if (next < 0) break;
  }
  if (source[end - 1] === "\r") end--;
  if (end <= lineEnd) {
    // One line: up to the value's end, leaving any comment and the spaces before it.
    const value = valueRange(source, key);
    const comment = /(^|\s)#/.test(source.slice(colon + 1, end));
    if (comment) return { from: colon + 1, to: Math.max(colon + 1, value.to) };
  }
  return { from: colon + 1, to: end };
}

/** Adds a line to the front matter: at the top level, or at the end of a top-level map. */
function addToFrontMatter(story: Story, path: readonly string[], text: string): TextChange[] {
  const nl = eol(story);
  const front = story.frontMatter;
  const parent = path[0];
  if (!front) {
    const body = parent ? `${parent}:${nl}  ${text}` : text;
    const bom = story.source.startsWith("﻿") ? 1 : 0;
    return [{ from: bom, to: bom, insert: `---${nl}${body}${nl}---${nl}${nl}` }];
  }
  const closing = lineStart(story.source, front.range.to);
  if (!parent) return [{ from: closing, to: closing, insert: `${text}${nl}` }];
  const keys = frontMatterKeys(story);
  const top = keys.find((k) => k.path.length === 1 && k.path[0] === parent);
  if (!top) return [{ from: closing, to: closing, insert: `${parent}:${nl}  ${text}${nl}` }];
  const children = keys.filter((k) => k.path[0] === parent && k.path.length === 2);
  const first = children[0];
  const indent = first ? lineIndent(story.source, first.range.from) : "  ";
  // After the map's last line: the next top-level key, or the closing `---`.
  const nextTop = keys.find((k) => k.path.length === 1 && k.range.from > top.range.from);
  const at = nextTop ? lineStart(story.source, nextTop.range.from) : closing;
  return [{ from: at, to: at, insert: `${indent}${text}${nl}` }];
}

/** A YAML value written plainly when that reads back as the same text, else double-quoted. */
export function yamlScalar(value: string): string {
  const plain =
    value !== "" &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/: |:$| #|[\n\r\t]/.test(value) &&
    !/^(?:null|~|true|false|yes|no|on|off)$/i.test(value) &&
    !/^[-+]?(?:\.?\d)/.test(value);
  if (plain) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}
