/**
 * The lossless writer (§13). A story is written back from its source, so an unchanged story gives
 * back the same bytes. Fields changed in place on the model are written as the edits in `edit.ts`
 * make them: only the marks that changed are rewritten, and nothing else moves.
 */
import {
  type TextChange,
  applyChanges,
  renameCharacter,
  setDirection,
  setFullName,
  setMeta,
  setSpeaker,
} from "./edit";
import type { Block, Item, Story } from "./model";
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
  return applyChanges(story.source, changesFrom(story));
}

/** The text changes that would write a story's in-place edits back to its source. */
export function changesFrom(story: Story): TextChange[] {
  const original = parse(story.source);
  const changes: TextChange[] = [];

  for (const field of ["title", "subtitle", "author", "language"] as const) {
    if (story.meta[field] !== original.meta[field]) {
      changes.push(...setMeta(original, field, story.meta[field] ?? null));
    }
  }

  if (story.cast.length !== original.cast.length) shapeError("cast members");
  story.cast.forEach((member, index) => {
    const before = original.cast[index];
    if (!before) return;
    if (member.name !== before.name)
      changes.push(...setFullName(original, before.handle, member.name));
    if (member.handle !== before.handle) {
      changes.push(...renameCharacter(original, before.handle, member.handle));
    }
  });

  if (story.blocks.length !== original.blocks.length) shapeError("blocks");
  story.blocks.forEach((block, index) => {
    const before = original.blocks[index] as Block;
    if (block.kind !== before.kind) shapeError("blocks");
    if (block.kind === "heading" && before.kind === "heading" && block.level !== before.level) {
      const hashes = { from: before.range.from, to: before.range.from + before.level };
      changes.push({ ...hashes, insert: "#".repeat(Math.min(6, Math.max(1, block.level))) });
    }
    const lines =
      block.kind === "break" ? [] : block.kind === "heading" ? [block.line] : block.lines;
    const linesBefore =
      before.kind === "break" ? [] : before.kind === "heading" ? [before.line] : before.lines;
    if (lines.length !== linesBefore.length) shapeError("lines");
    lines.forEach((line, lineIndex) => {
      const items = line.items;
      const itemsBefore = linesBefore[lineIndex]?.items ?? [];
      if (items.length !== itemsBefore.length) shapeError("items");
      items.forEach((item, itemIndex) => {
        changes.push(...itemChanges(original, itemsBefore[itemIndex] as Item, item));
      });
    });
  });
  return dedupe(changes);
}

function itemChanges(original: Story, before: Item, after: Item): TextChange[] {
  if (before.kind !== after.kind) shapeError("items");
  switch (after.kind) {
    case "speech": {
      if (before.kind !== "speech") return [];
      const out: TextChange[] = [];
      if (after.speaker !== before.speaker)
        out.push(...setSpeaker(original, before, after.speaker));
      if (after.ownDirection !== before.ownDirection) {
        out.push(...setDirection(original, before, after.ownDirection));
      }
      return out;
    }
    case "sound":
    case "vocal": {
      if (before.kind !== after.kind || after.description === before.description) return [];
      const open = original.source.indexOf("[", before.range.from);
      return [
        { from: open + 1, to: before.range.to - 1, insert: escapeBrackets(after.description) },
      ];
    }
    case "note": {
      if (before.kind !== "note" || after.text === before.text) return [];
      return [{ from: before.range.from + 2, to: before.range.to - 2, insert: ` ${after.text} ` }];
    }
    case "instruction": {
      if (before.kind !== "instruction" || after.value === before.value) return [];
      const raw = after.value === null ? `{${before.name}}` : `{${before.name} ${after.value}}`;
      return [{ ...before.range, insert: raw }];
    }
    default:
      return [];
  }
}

function escapeBrackets(text: string): string {
  return text.replace(/([[\]\\])/g, "\\$1");
}

/** The same change asked for twice, by two fields that agree, is made once. */
function dedupe(changes: TextChange[]): TextChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    const key = `${change.from}:${change.to}:${change.insert}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shapeError(what: string): never {
  throw new Error(
    `write() follows changes to fields only, but the story's ${what} were added or removed. Use the edit functions to add or remove marks.`,
  );
}
