/** Every token of a file's paragraphs and headings, lexed as the parser lexes them. */
import { findNotes, joinLines, scanBlocks } from "./blocks";
import { readFrontMatter } from "./front-matter";
import { type Token, lexLines } from "./inline";
import { onForget, remembering } from "./session";
import { SourceText } from "./source";

/**
 * The tokens of every paragraph and heading, in order: where quotes open and close (`open` and
 * `close`), even inside narration that no mark gives to anyone, which the model keeps as one
 * stretch.
 */
export function lexedTokens(source: string): Token[] {
  // An edit asks for the same text's tokens several times: the last few are kept while it works.
  for (const [text, tokens] of recent) if (text === source) return tokens;
  const tokens = lex(source);
  if (remembering()) {
    recent.unshift([source, tokens]);
    if (recent.length > 4) recent.pop();
  }
  return tokens;
}

const recent: Array<[string, Token[]]> = [];
onForget(() => {
  recent.length = 0;
});

function lex(source: string): Token[] {
  const text = new SourceText(source);
  const ignore = () => {};
  const front = readFrontMatter(text, ignore);
  const bodyFrom = text.lines[front.bodyLine]?.from ?? source.length;
  const notes = findNotes(source, bodyFrom, ignore);
  const tokens: Token[] = [];
  for (const block of scanBlocks(source, joinLines(text.lines, front.bodyLine, notes))) {
    const ranges =
      block.kind === "paragraph" ? block.lines : block.kind === "heading" ? [block.content] : [];
    for (const line of lexLines(source, ranges, notes, ignore)) {
      for (const token of line.tokens) tokens.push(token);
    }
  }
  return tokens;
}
