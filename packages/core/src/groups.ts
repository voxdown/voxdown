/**
 * Groups (§7): what an opening line says, and what a group gives the lines inside it.
 */
import type { NoteSpan } from "./blocks";
import { cleanText } from "./chars";
import { VISIBILITY_NAMES, lexLine } from "./inline";
import type { Group, Instruction, Mark, Note, Visibility } from "./model";
import type { Names } from "./names";
import type { Range } from "./source";
import type { Warn } from "./warnings";

/**
 * Reads a group's opening line. It holds no story text: a character mark, instructions such as
 * `{book only}`, and the direction, which is everything else, with optional parentheses (§7).
 */
export function readGroupLine(
  source: string,
  range: Range,
  content: Range,
  notes: readonly NoteSpan[],
  names: Names,
  warn: Warn,
): Group {
  const group: Group = { range, closeRange: null, instructions: [], notes: [] };
  const direction: Range[] = [];
  for (const token of lexLine(source, content, notes, warn)) {
    if (token.type === "mark" && !group.mark) {
      const nameRange = token.nameRange;
      const speaker = names.use(token.name, nameRange);
      group.mark = toMark(speaker, { from: token.range.from, to: nameRange.to }, nameRange);
      group.character = speaker;
      if (token.range.to > nameRange.to) direction.push({ from: nameRange.to, to: token.range.to });
    } else if (token.type === "instruction") {
      const instruction: Instruction = {
        kind: "instruction",
        name: token.name,
        value: token.value,
        raw: token.raw,
        range: token.range,
      };
      group.instructions.push(instruction);
      const visibility = visibilityOf(instruction.name);
      if (visibility && !group.visibility) group.visibility = visibility;
    } else if (token.type === "note") {
      const note: Note = { kind: "note", text: token.text, range: token.range };
      group.notes.push(note);
    } else {
      direction.push(token.range);
    }
  }
  const text = unwrap(
    cleanText(direction.map((part) => source.slice(part.from, part.to)).join("")),
  );
  const directionRange = trimmedSpan(source, direction);
  if (text && directionRange) {
    group.direction = text;
    group.directionRange = directionRange;
  }
  return group;
}

/** The voice of everything unmarked: the innermost group's character, else the narrator (§7.2). */
export function baseSpeaker(groups: readonly Group[], narrator: string): string {
  for (let i = groups.length - 1; i >= 0; i--) {
    const character = groups[i]?.character;
    if (character !== undefined) return character;
  }
  return narrator;
}

/**
 * The direction groups give a speaker with none of their own: the innermost group that applies to
 * them and has a direction (§6.4). A group with a character applies only to that character.
 */
export function groupDirection(groups: readonly Group[], speaker: string): string | null {
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group?.direction === undefined) continue;
    if (group.character === undefined || group.character === speaker) return group.direction;
  }
  return null;
}

/** The visibility of a paragraph or heading: its own instruction, else its innermost group's. */
export function resolveVisibility(
  instructions: readonly Instruction[],
  groups: readonly Group[],
): Visibility {
  for (const instruction of instructions) {
    const visibility = visibilityOf(instruction.name);
    if (visibility) return visibility;
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    const visibility = groups[i]?.visibility;
    if (visibility) return visibility;
  }
  return "both";
}

export function visibilityOf(name: string): Visibility | null {
  if (!VISIBILITY_NAMES.has(name)) return null;
  return name === "book only" ? "book" : name === "audio only" ? "audio" : "hidden";
}

function toMark(speaker: string, range: Range, nameRange: Range): Mark {
  return { kind: "mark", speaker, direction: null, range, nameRange };
}

/** `(whispering)` and `whispering` mean the same on a group line. */
function unwrap(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    if (depth === 0 && i < text.length - 1) return text;
  }
  return text.slice(1, -1).trim();
}

/** From the first to the last non-space character of some ranges. */
function trimmedSpan(source: string, parts: readonly Range[]): Range | null {
  const solid = parts.filter((part) => source.slice(part.from, part.to).trim() !== "");
  const first = solid[0];
  const last = solid[solid.length - 1];
  if (!first || !last) return null;
  const head = source.slice(first.from, first.to);
  const tail = source.slice(last.from, last.to);
  return {
    from: first.from + head.length - head.trimStart().length,
    to: last.to - (tail.length - tail.trimEnd().length),
  };
}
