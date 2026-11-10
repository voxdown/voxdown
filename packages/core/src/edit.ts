/**
 * Edits that follow the spec's rules for tools (§13): each returns the smallest set of text
 * changes that makes it, and never touches the author's spacing, quotation marks or line breaks
 * elsewhere. Apply them with `applyChanges`, then parse again.
 */
import { baseSpeaker } from "./groups";
import type { Block, Group, Item, Line, Speech, Story } from "./model";
import { nameKey } from "./names";
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

/** Whether a word can be written after `@` as a name (§5.2). */
export function isName(name: string): boolean {
  return NAME.test(name);
}
const NAME = /^[\p{L}][\p{L}\p{M}\p{N}_-]*(?:['’][\p{L}][\p{L}\p{M}\p{N}_-]*)*$/u;

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
 */
export function setSpeaker(story: Story, speech: Speech, name: string): TextChange[] {
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
  if (speech.mark && !speech.continued && firstOfMark(line, speech)) {
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
    // `@(quieter) “Oh dear.”` becomes `@Gerald (quieter) “Oh dear.”`.
    changes.push({ ...own, insert: markText(speaker, speech.ownDirection) });
  } else {
    const at = speech.openQuote?.from ?? speech.textRange.from;
    changes.push({ from: at, to: at, insert: `@${speaker} ` });
  }
  carriedOn(line, speech).forEach(keep);
  return changes;
}

/**
 * Sets how a stretch is said (§13.3), or removes its own direction with `null` (§13.5). A
 * direction a group gives can't be removed this way; give the stretch another one instead.
 */
export function setDirection(story: Story, speech: Speech, direction: string | null): TextChange[] {
  const value = direction?.trim() || null;
  if (value === speech.ownDirection) return [];
  const { line, groups } = place(story, speech);
  const own = ownDirectionMark(story, speech);
  const markFirst = speech.mark && !speech.continued && firstOfMark(line, speech);

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
  for (const entry of frontMatterKeys(story)) {
    if (
      entry.path.length === 2 &&
      entry.path[0] === "cast" &&
      nameKey(entry.path[1] ?? "") === key
    ) {
      changes.push({ ...entry.range, insert: to });
    }
    if (entry.path.length === 1 && entry.path[0] === "narrator") {
      const value = valueRange(story.source, entry.range);
      if (nameKey(story.source.slice(value.from, value.to).replace(/^["']|["']$/g, "")) === key)
        changes.push({ ...value, insert: to });
    }
  }
  return changes.sort((a, b) => a.from - b.from);
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
 * word moves to its end.
 */
export function insertSound(story: Story, offset: number, description: string): TextChange[] {
  const source = story.source;
  let at = offset;
  while (at < source.length && !/\s/.test(source[at] as string)) at++;
  const text = description.replace(/([[\]\\])/g, "\\$1");
  return [{ from: at, to: at, insert: ` [${text}]` }];
}

/**
 * Puts a page turn, pause, note or any other line on a line of its own before the line holding
 * `offset` (§13.3), as in `{page}`, `{pause 2s}` or `%% Slowly. %%`.
 */
export function insertLine(story: Story, offset: number, text: string): TextChange[] {
  const at = lineStart(story.source, offset);
  return [{ from: at, to: at, insert: `${text}${eol(story)}` }];
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

/** From just after `key:` to the end of its value, continuation lines included. */
function replaceValue(source: string, key: Range): Range {
  const colon = source.indexOf(":", key.to);
  const indent = lineIndent(source, key.from).length;
  let end = source.indexOf("\n", colon);
  if (end < 0) return { from: colon + 1, to: source.length };
  for (;;) {
    const next = source.indexOf("\n", end + 1);
    const lineText = source.slice(end + 1, next < 0 ? source.length : next).replace(/\r$/, "");
    const lineIndentLength = /^[ \t]*/.exec(lineText)?.[0].length ?? 0;
    if (lineText.trim() === "" || lineIndentLength <= indent || lineText.trim() === "---") break;
    end = next < 0 ? source.length : next;
    if (next < 0) break;
  }
  if (source[end - 1] === "\r") end--;
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
