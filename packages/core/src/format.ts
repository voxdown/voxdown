import { type TextChange, applyChanges, hearingDifferences, sameHearing } from "./edit";
import { lexedTokens } from "./lexed";
import { type ScriptLine, lines } from "./lines";
import type { Item, Story } from "./model";
import { parse } from "./parse";
/**
 * The formatter (§13, rule 8): tidies a file only when its author asks, and never changes who says
 * what. It writes names as the cast spells them, trims and collapses spaces, makes runs of blank
 * lines one, and puts a blank line around headings and scene breaks. Straight quotation marks
 * become curly ones only when asked, in the story's language. The front matter, group lines and
 * each line's line ending stay as written.
 */
import { session } from "./session";
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
  return session(() => formatNow(source, options));
}

function formatNow(source: string, options: FormatOptions): string {
  let text = source;
  if (options.names !== false) text = applyChanges(text, nameChanges(parse(text)));
  // Each step keeps what it can: a line whose change would make anyone say anything differently
  // keeps its old form, and the rest of the file is still tidied. A step runs until it settles,
  // so formatting a formatted file changes nothing.
  for (let round = 0; round < 8; round++) {
    const before = text;
    if (options.quotes === "curly") {
      const story = parse(text);
      text = guarded(text, story, byLine(text, quoteChanges(story, options.language)));
    }
    if (options.spacing !== false) {
      // Line by line. Tidying can turn a line into a heading or a scene break, which then wants
      // blank lines of its own: the next round gives them.
      text = guarded(text, parse(text), spacingRuns(text));
    }
    if (text === before) break;
  }
  return text;
}

/** The story's blocks, and each heading's level: tidying never makes a heading a paragraph. */
function shapeOf(story: Story): string {
  return story.blocks
    .map((block) => (block.kind === "heading" ? `h${block.level}` : block.kind))
    .join(" ");
}

/** Every character but spaces, with quotation marks and apostrophes as one: what may never change. */
function wordsOf(text: string): string {
  return text.replace(/["'“”‘’„‚«»‹›]/g, "'").replace(/\s+/g, "");
}

/** Changes in runs, one per line: a quote's marks are decided together. */
function byLine(text: string, changes: readonly TextChange[]): TextChange[][] {
  const runs = new Map<number, TextChange[]>();
  for (const change of changes) {
    const line = text.lastIndexOf("\n", change.from - 1);
    const run = runs.get(line);
    if (run) run.push(change);
    else runs.set(line, [change]);
  }
  return [...runs.values()];
}

/**
 * The text with as many runs of changes made as keep its words, and who says what and how, exactly
 * as before. All of them are tried at once; where a word would be heard differently, the runs of
 * its line are left out (then, if that isn't enough, of its paragraph), and the rest tried again,
 * so a long file with a few lines that can't change takes a few readings, not one per line. What
 * that can't settle is narrowed down by halves.
 */
function guarded(text: string, story: Story, runs: readonly TextChange[][]): string {
  const words = wordsOf(text);
  const shape = shapeOf(story);
  const rows = lines(story);
  const lineStarts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    lineStarts.push(at + 1);
  const lineOf = (at: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((lineStarts[middle] as number) <= at) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  // The block holding an offset, by halves: blocks come in order.
  const blockOf = (at: number) => {
    let low = 0;
    let high = story.blocks.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = (story.blocks[middle] as Story["blocks"][number]).range;
      if (at < range.from) high = middle - 1;
      else if (at > range.to) low = middle + 1;
      else return middle;
    }
    return -1;
  };
  const runLines = runs.map((run) => lineOf((run[0] as TextChange).from));
  const runBlocks = runs.map((run) => blockOf((run[0] as TextChange).from));
  let left = runs.map((_, index) => index);
  const widened = new Set<number>();
  for (let round = 0; round <= runs.length; round++) {
    const candidate = applyChanges(
      text,
      left.flatMap((index) => runs[index] as TextChange[]),
    );
    if (wordsOf(candidate) !== words) break;
    const after = parse(candidate);
    const differences = hearingDifferences(story, after);
    if (differences.length === 0) {
      if (shapeOf(after) === shape && sameVoices(rows, lines(after))) return candidate;
      break;
    }
    // Leave out the runs on each line where a word is heard differently; a line already left
    // out widens to its paragraph.
    const differing = new Set(differences.map(lineOf));
    const blocks = new Set<number>();
    for (const at of differences) if (widened.has(lineOf(at))) blocks.add(blockOf(at));
    const before = left.length;
    left = left.filter(
      (index) =>
        !differing.has(runLines[index] as number) && !blocks.has(runBlocks[index] as number),
    );
    for (const line of differing) widened.add(line);
    if (left.length === before && blocks.size === 0) {
      // Nothing on those lines to leave out: the difference comes from further back.
      for (const at of differences) blocks.add(blockOf(at));
      left = left.filter((index) => !blocks.has(runBlocks[index] as number));
      if (left.length === before) break;
    }
  }
  return halving(
    text,
    story,
    words,
    shape,
    rows,
    left.map((index) => runs[index] as TextChange[]),
  );
}

/** The runs that keep the reading, found by halves: all of them if they can, else each that can. */
function halving(
  text: string,
  story: Story,
  words: string,
  shape: string,
  rows: readonly ScriptLine[],
  runs: readonly TextChange[][],
): string {
  const same = (candidate: string) => {
    if (wordsOf(candidate) !== words) return false;
    const after = parse(candidate);
    return shapeOf(after) === shape && sameVoices(rows, lines(after)) && sameHearing(story, after);
  };
  const kept: TextChange[] = [];
  const attempt = (part: readonly TextChange[][]) => {
    if (part.length === 0) return;
    const changes = part.flat();
    if (same(applyChanges(text, [...kept, ...changes]))) {
      for (const change of changes) kept.push(change);
      return;
    }
    if (part.length === 1) return;
    const half = Math.ceil(part.length / 2);
    attempt(part.slice(0, half));
    attempt(part.slice(half));
  };
  attempt(runs);
  return applyChanges(text, kept);
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

/**
 * Tidied spacing, as one change for each line of the file (and one for the front matter): what the
 * line becomes, with the blank lines it brings or loses. Each can be kept or left on its own.
 */
function spacingRuns(source: string): TextChange[][] {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const story = parse(source);
  const text = new SourceText(source);
  const front = story.frontMatter;
  // Each line keeps its own line ending; a line that has none (the last) or a new blank line
  // takes the one before it.
  const endings = text.lines.map((line, index) =>
    source.slice(line.to, text.lines[index + 1]?.from ?? source.length),
  );
  const first = endings.find((ending) => ending !== "") ?? "\n";
  let last = first;
  const endingOf = (index: number) => {
    const own = endings[index] ?? "";
    if (own !== "") last = own;
    return own || last;
  };
  // The front matter is kept exactly as written; the story starts on the line after it.
  const firstBody = front ? text.position(front.range.to).line : 0;
  const structural = new Set<number>();
  for (const block of story.blocks) {
    if (block.kind === "heading" || block.kind === "break") {
      structural.add(text.position(block.range.from).line - 1);
    }
  }
  // Group lines are kept exactly as written too.
  const groupLines = new Set<number>();
  for (const group of story.groups) {
    groupLines.add(text.position(group.range.from).line - 1);
    if (group.closeRange) groupLines.add(text.position(group.closeRange.from).line - 1);
  }
  /** A line of the result, and the line of the file it comes from (-1: the front matter). */
  type Out = { line: string; ending: string; owner: number };
  const out: Out[] = front
    ? [
        {
          line: source.slice(bom.length, front.range.to),
          ending: endingOf(firstBody - 1),
          owner: -1,
        },
        { line: "", ending: last, owner: -1 },
      ]
    : [];
  const ended = () => out.length === 0 || out[out.length - 1]?.line === "";
  for (let index = firstBody; index < text.lines.length; index++) {
    const line = text.lines[index] as (typeof text.lines)[number];
    const raw = source.slice(index === 0 ? bom.length : line.from, line.to);
    const ending = endingOf(index);
    // A stray carriage return or byte order mark at a line's edge is spacing too.
    const tidy = groupLines.has(index)
      ? raw
      : raw.replace(/^[ \t\r\uFEFF]+|[ \t\r\uFEFF]+$/g, "").replace(/[ \t]{2,}|\t/g, " ");
    const owner = index;
    if (tidy === "") {
      if (!ended()) out.push({ line: "", ending, owner });
    } else if (structural.has(index)) {
      if (!ended()) out.push({ line: "", ending: out[out.length - 1]?.ending ?? ending, owner });
      out.push({ line: tidy, ending, owner }, { line: "", ending, owner });
    } else {
      out.push({ line: tidy, ending, owner });
    }
  }
  while (out.length > 0 && out[out.length - 1]?.line === "") out.pop();
  // A file without front matter must not start with `---` once tidied, or it would have some:
  // it keeps a blank line before it.
  const opening = out[0];
  if (!front && opening && /^-{3,}$/.test(opening.line)) {
    out.unshift({ line: "", ending: first, owner: opening.owner });
  }
  const written = new Map<number, string>();
  for (const { line, ending, owner } of out) {
    written.set(owner, (written.get(owner) ?? "") + line + ending);
  }
  const runs: TextChange[][] = [];
  const replace = (from: number, to: number, insert: string) => {
    if (source.slice(from, to) !== insert) runs.push([{ from, to, insert }]);
  };
  if (front) {
    replace(bom.length, text.lines[firstBody]?.from ?? source.length, written.get(-1) ?? "");
  }
  for (let index = firstBody; index < text.lines.length; index++) {
    const from = index === 0 ? bom.length : (text.lines[index]?.from ?? source.length);
    replace(from, text.lines[index + 1]?.from ?? source.length, written.get(index) ?? "");
  }
  return runs;
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
 * ’. Feet and inches (`6'2"`), escaped marks, links and everything inside marks, sounds, notes,
 * instructions and group lines are left as written.
 */
function quoteChanges(story: Story, language: string | undefined): TextChange[] {
  const style = styleFor(language ?? story.meta.language);
  const source = story.source;
  const tokens = lexedTokens(source);
  // A link's text and address are one token, never reworded: an address must stay as written.
  const skip = new Uint8Array(source.length);
  for (const range of [
    ...markRanges(story),
    ...tokens.filter((token) => token.type === "text" && !token.plain).map((token) => token.range),
  ]) {
    skip.fill(1, range.from, range.to);
  }
  const closer = closersAfter(source);
  const changes: TextChange[] = [];
  const decided = new Set<number>();
  // Where a quote opens, straight or curly: a quote right after one opens too (`"'Hello,'`).
  const opened = new Set<number>();
  const afterDigit = (at: number) => /\d/.test(source[at - 1] ?? "");
  // Lines where the parser reads an apostrophe as a quote's edge (`'Rock 'n' roll,'`): no curly
  // marks there could be both right and heard as before, so they keep their straight ones.
  const unsafe = new Set<number>();
  const lineAt = (at: number) => source.lastIndexOf("\n", at - 1);
  const paired = new Set<number>();
  for (const token of tokens) {
    if (token.type !== "open" && token.type !== "close") continue;
    if (token.char !== '"' && token.char !== "'") continue;
    if (paired.has(token.range.from)) continue;
    decided.add(token.range.from);
    // A mark after a digit stays as written, whatever it does (§13, rule 8): `6"`.
    if (afterDigit(token.range.from)) continue;
    if (isElision(source, token.range.from)) {
      // An apostrophe the parser reads as a quote's edge. `'n'` read as a quote of its own, or a
      // decade (`'90s`) opening one, is apostrophes at both edges; a longer quote ending at an
      // apostrophe can't be written curly and still heard the same.
      const quotes = tokens.filter((other) => other.type === "open" || other.type === "close");
      const at = quotes.indexOf(token);
      const partner = token.type === "open" ? quotes[at + 1] : quotes[at - 1];
      const own =
        partner !== undefined &&
        partner.char === "'" &&
        partner.type !== token.type &&
        (Math.abs(partner.range.from - token.range.from) === 2 ||
          (token.type === "open" && source[token.range.from + 1] !== "n"));
      if (own && partner) {
        for (const edge of [token, partner]) {
          changes.push({ ...edge.range, insert: "’" });
          decided.add(edge.range.from);
          paired.add(edge.range.from);
        }
      } else unsafe.add(lineAt(token.range.from));
      continue;
    }
    const double = token.char === '"';
    if (token.type === "open") opened.add(token.range.from);
    const insert =
      token.type === "open"
        ? double
          ? style.open
          : style.innerOpen
        : double
          ? style.close
          : style.innerClose;
    changes.push({ ...token.range, insert });
  }
  // The marks the parser doesn't decide: quotes inside quotes, and apostrophes. On each line, an
  // inner quote opens where a quote can open and a closer follows, and closes with the language's
  // own inner mark.
  const openContext = (at: number) => {
    const before = source[at - 1];
    return (
      before === undefined ||
      before === "\n" ||
      /[\s([{—–-]/u.test(before) ||
      isOpening(before) ||
      opened.has(at - 1)
    );
  };
  let inner = { double: false, single: false };
  for (let i = story.frontMatter?.range.to ?? 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\n") {
      inner = { double: false, single: false };
      continue;
    }
    if (char === "\\") {
      i++;
      continue;
    }
    if ((char !== '"' && char !== "'") || decided.has(i) || skip[i]) continue;
    // Feet and inches (`6'2"`) stay as written.
    if (afterDigit(i)) continue;
    const after = source[i + 1];
    const followed = after !== undefined && !/\s/u.test(after);
    if (char === '"') {
      if (inner.double) {
        changes.push({ from: i, to: i + 1, insert: style.close });
        inner.double = false;
      } else if (openContext(i) && followed) {
        changes.push({ from: i, to: i + 1, insert: style.open });
        opened.add(i);
        inner.double = true;
      } else {
        changes.push({ from: i, to: i + 1, insert: style.close });
      }
      continue;
    }
    // `rock 'n' roll` and a word's own apostrophe (`don't`, `dogs'`) are apostrophes.
    const letterBefore = /[\p{L}\p{N}]/u.test(source[i - 1] ?? "");
    const letterAfter = after !== undefined && /[\p{L}\p{N}]/u.test(after);
    if (isElision(source, i) || (letterBefore && letterAfter)) {
      changes.push({ from: i, to: i + 1, insert: "’" });
    } else if (inner.single && !letterAfter) {
      changes.push({ from: i, to: i + 1, insert: style.innerClose });
      inner.single = false;
    } else if (!inner.single && openContext(i) && followed && (closer[i + 1] ?? 0) === 1) {
      changes.push({ from: i, to: i + 1, insert: style.innerOpen });
      opened.add(i);
      inner.single = true;
    } else {
      changes.push({ from: i, to: i + 1, insert: "’" });
    }
  }
  return unsafe.size === 0 ? changes : changes.filter((change) => !unsafe.has(lineAt(change.from)));
}

/**
 * Whether the `'` at `at` is an apostrophe that stands for something left out: the two of
 * ` 'n' `, as in rock 'n' roll, or a decade's (`'90s`).
 */
function isElision(source: string, at: number): boolean {
  const word = /[\p{L}\p{N}]/u;
  if (source[at] === "'" && /^'\d\ds?(?![\p{L}\p{N}])/u.test(source.slice(at, at + 5))) return true;
  return [at, at - 2].some(
    (from) =>
      /^'n'$/i.test(source.slice(from, from + 3)) &&
      !word.test(source[from - 1] ?? "") &&
      !word.test(source[from + 3] ?? ""),
  );
}

const OPENING = new Set(["“", "‘", "„", "‚", "«", "‹", "「", "『"]);
function isOpening(char: string): boolean {
  return OPENING.has(char);
}

/**
 * For each offset, whether a straight `'` that ends a word follows it on its line: one that could
 * close a quote opened before it.
 */
function closersAfter(source: string): Uint8Array {
  const after = new Uint8Array(source.length + 1);
  for (let i = source.length - 1; i >= 0; i--) {
    const char = source[i];
    if (char === "\n") continue;
    const closes =
      char === "'" && /\S/u.test(source[i - 1] ?? "") && !/[\p{L}\p{N}]/u.test(source[i + 1] ?? "");
    after[i] = closes || after[i + 1] === 1 ? 1 : 0;
  }
  return after;
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
