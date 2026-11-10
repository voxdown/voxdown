/**
 * The formatter (§13, rule 8): tidies a file only when its author asks, and never changes who says
 * what. It writes names as the cast spells them, trims and collapses spaces, makes runs of blank
 * lines one, and puts a blank line around headings and scene breaks. Straight quotation marks
 * become curly ones only when asked, in the story's language.
 */
import { findNotes, joinLines, scanBlocks } from "./blocks";
import { type TextChange, applyChanges } from "./edit";
import { readFrontMatter } from "./front-matter";
import { type Token, lexLines } from "./inline";
import { type ScriptLine, lines } from "./lines";
import type { Item, Story } from "./model";
import { parse } from "./parse";
import { SourceText } from "./source";

export type FormatOptions = {
  /** Write every name as the cast spells it, or as the file first spells it. Default true. */
  names?: boolean;
  /** Spaces, blank lines and the file's last line break. Default true. */
  spacing?: boolean;
  /** `"curly"` turns straight quotation marks into the language's curly ones. Default `"keep"`. */
  quotes?: "keep" | "curly";
  /** The language for curly quotes, such as `en`, `de` or `fr`. Defaults to the front matter's. */
  language?: string;
};

/** Formats a file. An already formatted file comes back unchanged. */
export function format(source: string, options: FormatOptions = {}): string {
  let text = source;
  if (options.names !== false) text = applyChanges(text, nameChanges(parse(text)));
  if (options.quotes === "curly") {
    const before = parse(text);
    const curly = applyChanges(text, quoteChanges(before, options.language));
    // Curly marks follow slightly different rules (§5.5); keep the straight ones if who says
    // what would change.
    if (sameVoices(lines(before), lines(parse(curly)))) text = curly;
  }
  if (options.spacing !== false) {
    // Tidying spaces never changes who says what: where it would (a stray mark at a line's edge
    // that turns text into a scene break, say), the spacing is left as it was.
    // Tidying can turn a line into a heading or a scene break, which then wants blank lines of
    // its own: tidy again until nothing changes, so formatting a formatted file changes nothing.
    let spaced = spacing(text);
    for (let round = 0; round < 4; round++) {
      const again = spacing(spaced);
      if (again === spaced) break;
      spaced = again;
    }
    if (sameVoices(lines(parse(text)), lines(parse(spaced)))) text = spaced;
  }
  return text;
}

/** `@clown` becomes `@Clown` when that is how the cast writes it (§5.2). */
function nameChanges(story: Story): TextChange[] {
  const changes: TextChange[] = [];
  const marks = [
    ...story.groups.flatMap((group) => (group.mark ? [group.mark] : [])),
    ...allItems(story).filter((item) => item.kind === "mark"),
  ];
  for (const mark of marks) {
    if (mark.kind !== "mark") continue;
    const written = story.source.slice(mark.nameRange.from, mark.nameRange.to);
    if (written !== mark.speaker) changes.push({ ...mark.nameRange, insert: mark.speaker });
  }
  return changes;
}

function allItems(story: Story): Item[] {
  return story.blocks.flatMap((block) => {
    if (block.kind === "break") return [];
    const blockLines = block.kind === "heading" ? [block.line] : block.lines;
    return blockLines.flatMap((line) => line.items);
  });
}

// Spacing

function spacing(source: string): string {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const story = parse(source);
  const text = new SourceText(source);
  const eol = /\r\n/.test(source) ? "\r\n" : "\n";
  const front = story.frontMatter;
  // The front matter is kept exactly as written; the story starts on the line after it.
  const firstBody = front ? text.position(front.range.to).line : 0;
  const structural = new Set<number>();
  for (const block of story.blocks) {
    if (block.kind === "heading" || block.kind === "break") {
      structural.add(text.position(block.range.from).line - 1);
    }
  }
  const out: string[] = front ? [source.slice(bom.length, front.range.to), ""] : [];
  const ended = () => out.length === 0 || out[out.length - 1] === "";
  for (let index = firstBody; index < text.lines.length; index++) {
    const line = text.lines[index] as (typeof text.lines)[number];
    const raw = source.slice(index === 0 ? bom.length : line.from, line.to);
    // A stray carriage return or byte order mark at a line's edge is spacing too.
    const tidy = raw.replace(/^[ \t\r\uFEFF]+|[ \t\r\uFEFF]+$/g, "").replace(/[ \t]{2,}|\t/g, " ");
    if (tidy === "") {
      if (!ended()) out.push("");
    } else if (structural.has(index)) {
      if (!ended()) out.push("");
      out.push(tidy, "");
    } else {
      out.push(tidy);
    }
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  // A file without front matter must not start with `---` once tidied, or it would have some:
  // it keeps a blank line before it.
  if (!front && /^-{3,}$/.test(out[0] ?? "")) out.unshift("");
  return out.length === 0 ? bom : `${bom}${out.join(eol)}${eol}`;
}

// Quotation marks

type Style = { open: string; close: string; innerOpen: string; innerClose: string };

const STYLES: Record<string, Style> = {
  en: { open: "“", close: "”", innerOpen: "‘", innerClose: "’" },
  de: { open: "„", close: "“", innerOpen: "‚", innerClose: "‘" },
  fr: { open: "«", close: "»", innerOpen: "“", innerClose: "”" },
};

function styleFor(language: string | undefined): Style {
  const primary = (language ?? "en").toLowerCase().split(/[-_]/)[0] ?? "en";
  return STYLES[primary] ?? (STYLES.en as Style);
}

/**
 * Straight marks the parser reads as quotes become the language's quotes; an apostrophe becomes
 * ’. Inches (`6"`), escaped marks and everything inside marks, sounds, notes and instructions are
 * left as written.
 */
function quoteChanges(story: Story, language: string | undefined): TextChange[] {
  const style = styleFor(language ?? story.meta.language);
  const source = story.source;
  const skip = markRanges(story);
  const tokens = lexedTokens(source);
  const changes: TextChange[] = [];
  const decided = new Set<number>();
  for (const token of tokens) {
    if (token.type !== "open" && token.type !== "close") continue;
    if (token.char !== '"' && token.char !== "'") continue;
    const double = token.char === '"';
    const insert =
      token.type === "open"
        ? double
          ? style.open
          : style.innerOpen
        : double
          ? style.close
          : style.innerClose;
    changes.push({ ...token.range, insert });
    decided.add(token.range.from);
  }
  for (let i = story.frontMatter?.range.to ?? 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if ((char !== '"' && char !== "'") || decided.has(i) || inside(skip, i)) continue;
    const before = source[i - 1];
    const after = source[i + 1];
    if (char === '"') {
      if (before !== undefined && /\d/.test(before)) continue;
      const opens = before === undefined || /[\s([{—–-]/u.test(before) || isOpening(before);
      changes.push({ from: i, to: i + 1, insert: opens ? style.open : style.close });
    } else {
      const opens =
        (before === undefined || /[\s([{—–-]/u.test(before) || isOpening(before)) &&
        after !== undefined &&
        /[\p{L}\p{N}]/u.test(after) &&
        closesLater(source, i);
      changes.push({ from: i, to: i + 1, insert: opens ? style.innerOpen : "’" });
    }
  }
  return changes;
}

const OPENING = new Set(["“", "‘", "„", "‚", "«", "‹", "「", "『"]);
function isOpening(char: string): boolean {
  return OPENING.has(char);
}

/** Whether a straight `'` at `at` is closed later on its line by one that ends a word. */
function closesLater(source: string, at: number): boolean {
  for (let i = at + 1; i < source.length && source[i] !== "\n"; i++) {
    if (source[i] !== "'") continue;
    const before = source[i - 1] ?? "";
    const after = source[i + 1] ?? "";
    if (/\S/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
  }
  return false;
}

/** Where marks, directions, sounds, notes, instructions and images are: never reworded. */
function markRanges(story: Story): Array<{ from: number; to: number }> {
  const ranges = allItems(story)
    .filter((item) => item.kind !== "speech")
    .map((item) => item.range);
  for (const group of story.groups) {
    ranges.push(group.range);
    if (group.closeRange) ranges.push(group.closeRange);
  }
  return ranges.sort((a, b) => a.from - b.from);
}

function inside(ranges: ReadonlyArray<{ from: number; to: number }>, at: number): boolean {
  return ranges.some((range) => at >= range.from && at < range.to);
}

/** Every token of every paragraph and heading, lexed as the parser lexes them. */
function lexedTokens(source: string): Token[] {
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

function sameVoices(a: readonly ScriptLine[], b: readonly ScriptLine[]): boolean {
  return (
    a.length === b.length &&
    a.every((line, i) => {
      const other = b[i] as ScriptLine;
      return (
        line.kind === other.kind &&
        line.speaker === other.speaker &&
        line.direction === other.direction
      );
    })
  );
}
