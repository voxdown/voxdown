/**
 * `parse(source)`: front matter, then notes, then blocks and groups, then each paragraph's lines.
 * A file always parses; problems become warnings (§12.3).
 */
import { type NoteSpan, type RawBlock, findNotes, joinLines, scanBlocks } from "./blocks";
import { hasLetterOrDigit } from "./chars";
import { readFrontMatter, readSetup } from "./front-matter";
import { readGroupLine, resolveVisibility } from "./groups";
import { isBlankText, lexLines } from "./inline";
import type { Block, Group, Instruction, Item, Line, Mark, Story } from "./model";
import { Names, nameKey } from "./names";
import { SourceText } from "./source";
import { type OpenQuote, type Voice, readParagraph } from "./speech";
import { type Warn, collectWarnings } from "./warnings";

export function parse(source: string): Story {
  const text = new SourceText(source);
  const { list: warnings, warn } = collectWarnings(text);
  const front = readFrontMatter(text, warn);
  const setup = readSetup(front, warn);
  const names = new Names(
    setup.cast.map((member) => member.handle),
    setup.narratorSetting,
    setup.hasCast,
    warn,
  );
  const bodyFrom = text.lines[front.bodyLine]?.from ?? source.length;
  const notes = findNotes(source, bodyFrom, warn);
  const reader = new BlockReader(source, notes, names, warn);
  for (const block of scanBlocks(source, joinLines(text.lines, front.bodyLine, notes))) {
    reader.add(block);
  }
  reader.finish();

  const story: Story = {
    source,
    frontMatter: front.frontMatter,
    meta: { ...setup.details, narrator: names.narrator },
    cast: setup.cast,
    blocks: reader.blocks,
    groups: reader.groups,
    warnings,
  };
  warnIdleMarks(story, warn);
  warnSilentCast(story, setup.castRanges, warn);
  warnings.sort((a, b) => a.range.from - b.range.from);
  return story;
}

/** Walks the blocks in order, keeping the open groups and any quote left open (§5.7). */
class BlockReader {
  readonly blocks: Block[] = [];
  readonly groups: Group[] = [];
  private readonly open: Group[] = [];
  /** The open groups as a chain, innermost first, that each block keeps a link to. */
  private chain: GroupChain | null = null;
  private carry: OpenQuote | null = null;

  constructor(
    private readonly source: string,
    private readonly notes: readonly NoteSpan[],
    private readonly names: Names,
    private readonly warn: Warn,
  ) {}

  add(block: RawBlock): void {
    if (block.kind === "paragraph") {
      this.paragraph(block);
      return;
    }
    // Only paragraphs can carry on a quote, so anything else ends it.
    this.endCarry();
    switch (block.kind) {
      case "heading":
        this.heading(block);
        break;
      case "break":
        this.blocks.push({ kind: "break", range: block.range });
        break;
      case "group-open": {
        const group = readGroupLine(
          this.source,
          block.range,
          block.content,
          this.notes,
          this.names,
          this.warn,
        );
        this.open.push(group);
        this.groups.push(group);
        this.chain = { group, outer: this.chain };
        break;
      }
      case "group-close": {
        const group = this.open.pop();
        this.chain = this.chain?.outer ?? null;
        if (group) group.closeRange = block.range;
        else this.warn("stray-group-close", "This line of colons closes no group.", block.range);
        break;
      }
    }
  }

  finish(): void {
    this.endCarry();
    for (const group of this.open) {
      this.warn(
        "unclosed-group",
        "This group is never closed, so it runs to the end of the file.",
        group.range,
      );
    }
  }

  private paragraph(block: RawBlock & { kind: "paragraph" }): void {
    const lines = lexLines(this.source, block.lines, this.notes, this.warn);
    // Paragraphs of only instructions and notes are skipped when looking for a quote's next
    // paragraph (§5.7).
    const skipped = lines.every((line) =>
      line.tokens.every(
        (token) => token.type === "instruction" || token.type === "note" || isBlankText(token),
      ),
    );
    let carried: Voice | null = null;
    if (this.carry && !skipped) {
      const first = lines[0]?.tokens.find((token) => !isBlankText(token));
      if (first?.type === "open" && first.char === this.carry.char) carried = this.carry.voice;
      else this.warnUnclosed(this.carry);
      this.carry = null;
    }
    const groups = [...this.open];
    const read = readParagraph(lines, { groups, names: this.names, warn: this.warn }, carried);
    if (read.open) this.carry = read.open;
    this.blocks.push(
      withGroups(
        {
          kind: "paragraph",
          lines: read.lines,
          visibility: resolveVisibility(instructionsOf(read.lines), groups),
          range: block.range,
        },
        this.chain,
      ),
    );
  }

  private heading(block: RawBlock & { kind: "heading" }): void {
    const groups = [...this.open];
    const lexed = lexLines(this.source, [block.content], this.notes, this.warn);
    const read = readParagraph(lexed, { groups, names: this.names, warn: this.warn }, null);
    if (read.open) this.warnUnclosed(read.open);
    const line: Line = read.lines[0] ?? { range: block.content, items: [] };
    this.blocks.push(
      withGroups(
        {
          kind: "heading",
          level: block.level,
          line,
          visibility: resolveVisibility(instructionsOf([line]), groups),
          range: block.range,
        },
        this.chain,
      ),
    );
  }

  private endCarry(): void {
    if (this.carry) this.warnUnclosed(this.carry);
    this.carry = null;
  }

  private warnUnclosed(quote: OpenQuote): void {
    this.warn("unclosed-quote", "This quote is never closed.", quote.range);
  }
}

/** The groups open around a block, innermost first, each linked to the one around it. */
type GroupChain = { group: Group; outer: GroupChain | null };

/**
 * Gives a block its `groups`, listed from the chain when read. Groups nested thousands deep would
 * otherwise cost every block inside them a list of them all, and memory would grow with the
 * square of the depth; this way each block keeps one link. Setting `groups` keeps the new list.
 */
function withGroups<T extends object>(block: T, chain: GroupChain | null): T & { groups: Group[] } {
  Object.defineProperty(block, "groups", {
    enumerable: true,
    configurable: true,
    get: () => {
      const groups: Group[] = [];
      for (let link = chain; link; link = link.outer) groups.push(link.group);
      return groups.reverse();
    },
    set: (groups: Group[]) => {
      Object.defineProperty(block, "groups", {
        value: groups,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    },
  });
  return block as T & { groups: Group[] };
}

function instructionsOf(lines: readonly Line[]): Instruction[] {
  return lines.flatMap((line) =>
    line.items.filter((item): item is Instruction => item.kind === "instruction"),
  );
}

function storyItems(story: Story): Item[] {
  return story.blocks.flatMap((block) => {
    if (block.kind === "paragraph") return block.lines.flatMap((line) => line.items);
    return block.kind === "heading" ? block.line.items : [];
  });
}

/** A character mark that gives its character nothing to say or do (§12.3). */
function warnIdleMarks(story: Story, warn: Warn): void {
  const items = storyItems(story);
  const used = new Set<Mark>();
  for (const item of items) {
    if (item.kind === "speech" && item.mark && hasLetterOrDigit(item.text)) used.add(item.mark);
    if (item.kind === "vocal" && item.mark) used.add(item.mark);
  }
  for (const item of items) {
    if (item.kind === "mark" && !used.has(item)) {
      warn("idle-mark", `This mark gives ${item.speaker} nothing to say or do.`, item.range);
    }
  }
}

/** A cast member who never speaks or makes a sound (informational, §12.3). */
function warnSilentCast(
  story: Story,
  castRanges: Map<string, { from: number; to: number }>,
  warn: Warn,
) {
  const heard = new Set<string>();
  for (const item of storyItems(story)) {
    if (item.kind === "vocal" || (item.kind === "speech" && hasLetterOrDigit(item.text))) {
      heard.add(nameKey(item.speaker));
    }
  }
  const fallback = story.frontMatter?.range ?? { from: 0, to: 0 };
  for (const member of story.cast) {
    if (heard.has(nameKey(member.handle))) continue;
    warn(
      "silent-cast-member",
      `${member.handle} is in the cast but never speaks.`,
      castRanges.get(member.handle) ?? fallback,
      "info",
    );
  }
}
