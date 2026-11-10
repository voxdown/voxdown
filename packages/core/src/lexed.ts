/** Every token of a file's paragraphs and headings, lexed as the parser lexes them. */
import { findNotes, joinLines, scanBlocks } from "./blocks";
import { readFrontMatter } from "./front-matter";
import { type Token, lexLines } from "./inline";
import { SourceText } from "./source";

/**
 * The tokens of every paragraph and heading, in order: where quotes open and close (`open` and
 * `close`), even inside narration that no mark gives to anyone, which the model keeps as one
 * stretch.
 */
export function lexedTokens(source: string): Token[] {
  const text = new SourceText(source);
  const ignore = () => {};
  const front = readFrontMatter(text, ignore);
  const bodyFrom = text.lines[front.bodyLine]?.from ?? source.length;
  const notes = findNotes(source, bodyFrom, ignore);
  const tokens: Token[] = [];
  for (const block of scanBlocks(source, joinLines(text.lines, front.bodyLine, notes))) {
    const ranges =
      block.kind === "paragraph" ? block.lines : block.kind === "heading" ? [block.content] : [];
    for (const line of lexLines(source, ranges, notes, ignore)) tokens.push(...line.tokens);
  }
  return tokens;
}
