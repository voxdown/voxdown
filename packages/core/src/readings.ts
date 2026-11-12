/**
 * The two readings of a file (§12): the spoken script, everything heard in order with its voice,
 * and the book text, the printed story as plain Markdown. Both are derived from the same model,
 * so they cannot drift apart.
 */
import { hasLetterOrDigit, removeEscapes } from "./chars";
import { visibilityOf } from "./groups";
import type { Block, Item, Line, Story, Visibility } from "./model";

/** The spoken script, written as in the spec's examples (§3, §12.1). */
export function spokenScript(story: Story): string {
  return story.blocks
    .map((block) => scriptLines(story.source, block))
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}

/** The book text: the file without its marks, sounds, notes and instructions (§12.2). */
export function bookText(story: Story): string {
  const chunks: string[] = [];
  for (const block of story.blocks) {
    if (block.kind === "break") {
      chunks.push(story.source.slice(block.range.from, block.range.to).trim());
    } else if (block.visibility === "both" || block.visibility === "book") {
      const lines = block.kind === "heading" ? [block.line] : block.lines;
      const text = lines
        .map((line) => bookLine(story.source, line))
        .filter((printed) => printed !== "")
        .join("\n");
      if (text) chunks.push(block.kind === "heading" ? `${"#".repeat(block.level)} ${text}` : text);
    }
  }
  return chunks.join("\n\n");
}

function scriptLines(source: string, block: Block): string[] {
  if (block.kind === "break") return ["---"];
  const heard = block.visibility === "both" || block.visibility === "audio";
  if (block.kind === "heading") {
    const hashes = "#".repeat(block.level);
    if (!heard) {
      const printed = bookLine(source, block.line);
      return printed ? [`${hashes} ${printed} {${label(block.visibility)}}`] : [];
    }
    return block.line.items.flatMap((item) => {
      const line = scriptLine(item);
      if (line === null) return [];
      return item.kind === "speech" ? [`${hashes} ${line}`] : [line];
    });
  }
  return block.lines.flatMap((line) => {
    const lines = line.items.map(scriptLine).filter((text): text is string => text !== null);
    if (heard) return lines;
    // Listed but not heard: the printed line, then anything kept in place (§12.1).
    const printed = bookLine(source, line);
    const kept = line.items
      .filter((item) => item.kind === "note" || item.kind === "instruction")
      .map(scriptLine)
      .filter((text): text is string => text !== null);
    return [...(printed ? [`{${label(block.visibility)}} ${printed}`] : []), ...kept];
  });
}

/** One item as a line of the spoken script, or null when it is not listed. */
function scriptLine(item: Item): string | null {
  switch (item.kind) {
    case "speech":
      return hasLetterOrDigit(item.text)
        ? `${voice(item.speaker, item.direction)}: ${item.text}`
        : null;
    case "vocal":
      return `${voice(item.speaker, item.direction)} [${item.description}]`;
    case "sound":
      return `[${item.description}]`;
    case "instruction":
      if (visibilityOf(item.name)) return null;
      return item.value === null ? `{${item.name}}` : `{${item.name} ${item.value}}`;
    case "note":
      return item.text ? `%% ${item.text} %%` : null;
    case "image":
      return item.link === undefined
        ? `![${item.alt}](${item.src})`
        : `[![${item.alt}](${item.src})](${item.link})`;
    case "mark":
    case "direction":
    case "end":
      return null;
  }
}

function voice(speaker: string, direction: string | null): string {
  return direction === null ? speaker : `${speaker} (${direction})`;
}

function label(visibility: Visibility): string {
  return visibility === "hidden" ? "hidden" : "book only";
}

const NOT_PRINTED: ReadonlySet<Item["kind"]> = new Set([
  "mark",
  "direction",
  "end",
  "sound",
  "vocal",
  "instruction",
  "note",
]);

/**
 * A line as printed: its source without marks, directions, sounds, notes and instructions, and
 * without escapes' backslashes. Where a removed mark leaves two spaces, one remains (§12.2).
 */
export function bookLine(source: string, line: Line): string {
  // Pieces joined once at the end, and whether the text so far ends in a space kept on the side:
  // a long line of many marks stays linear.
  const printed: string[] = [];
  let spaced = false;
  let at = line.range.from;
  let joint = false;
  const append = (to: number) => {
    let piece = removeEscapes(source.slice(at, to));
    if (joint && spaced) piece = piece.replace(/^[ \t]+/, "");
    if (piece !== "") {
      printed.push(piece);
      spaced = /[ \t]$/.test(piece);
    }
  };
  for (const item of line.items) {
    if (!NOT_PRINTED.has(item.kind) || item.range.from < at) continue;
    append(item.range.from);
    at = item.range.to;
    joint = true;
  }
  append(line.range.to);
  return printed.join("").trim();
}
