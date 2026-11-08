/**
 * A flat list of syntax ranges for highlighting. Tokens are sorted by position. They can nest:
 * an escape can sit inside a direction or a note.
 */
import { isEscapable } from "./chars";
import type { Item, Mark, Story } from "./model";
import type { Range } from "./source";

export type TokenKind =
  | "mark"
  | "name"
  | "direction"
  | "sound"
  | "vocal"
  | "instruction"
  | "note"
  | "group"
  | "heading"
  | "break"
  | "frontmatter"
  | "escape"
  | "quote";

/**
 * `mark` is the `@` sign and `name` the name after it. `quote` is a speech's own quotation mark.
 * `speaker` is set on the tokens that belong to a character.
 */
export type SyntaxToken = { kind: TokenKind; range: Range; speaker?: string };

export function tokens(story: Story): SyntaxToken[] {
  const found: SyntaxToken[] = [];
  const add = (kind: TokenKind, range: Range, speaker?: string) => {
    found.push(speaker === undefined ? { kind, range } : { kind, range, speaker });
  };
  const addMark = (mark: Mark) => {
    add("mark", { from: mark.range.from, to: mark.range.from + 1 }, mark.speaker);
    add("name", mark.nameRange, mark.speaker);
    if (mark.directionRange) add("direction", mark.directionRange, mark.speaker);
  };
  const addItem = (item: Item) => {
    const at = { from: item.range.from, to: item.range.from + 1 };
    const rest = { from: item.range.from + 1, to: item.range.to };
    switch (item.kind) {
      case "mark":
        addMark(item);
        break;
      case "direction":
        add("mark", at);
        add("direction", rest);
        break;
      case "vocal":
        if (!item.mark) add("mark", at, item.speaker);
        add("vocal", item.mark ? item.range : rest, item.speaker);
        break;
      case "speech":
        if (item.openQuote) add("quote", item.openQuote, item.speaker);
        if (item.closeQuote) add("quote", item.closeQuote, item.speaker);
        break;
      case "sound":
      case "instruction":
      case "note":
        add(item.kind, item.range);
        break;
      case "image":
        break;
    }
  };

  if (story.frontMatter) add("frontmatter", story.frontMatter.range);
  for (const group of story.groups) {
    add("group", leadingRun(story.source, group.range, ":"));
    if (group.closeRange) add("group", leadingRun(story.source, group.closeRange, ":"));
    if (group.mark) addMark(group.mark);
    if (group.directionRange) add("direction", group.directionRange, group.character);
    for (const instruction of group.instructions) add("instruction", instruction.range);
    for (const note of group.notes) add("note", note.range);
  }
  for (const block of story.blocks) {
    if (block.kind === "break") {
      add("break", block.range);
    } else if (block.kind === "heading") {
      add("heading", leadingRun(story.source, block.range, "#"));
      block.line.items.forEach(addItem);
    } else {
      for (const line of block.lines) line.items.forEach(addItem);
    }
  }
  const source = story.source;
  for (let i = story.frontMatter?.range.to ?? 0; i < source.length; i++) {
    if (source[i] === "\\" && isEscapable(source[i + 1])) {
      add("escape", { from: i, to: i + 2 });
      i++;
    }
  }
  return found.sort((a, b) => a.range.from - b.range.from || b.range.to - a.range.to);
}

/** The run of `char` at the start of a range, such as a heading's `##`. */
function leadingRun(source: string, range: Range, char: string): Range {
  let to = range.from;
  while (to < range.to && source[to] === char) to++;
  return { from: range.from, to };
}
