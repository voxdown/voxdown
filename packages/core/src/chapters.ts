/**
 * Where a story divides into chapters, one rule for every tool that does (an audiobook, an ebook,
 * the Writer's list of chapters): at the highest heading level used at least twice. So a book's
 * `#` headings are its chapters, and so are its `##` ones under a single `#` title, which is then
 * no chapter itself (SPEC.md §4.4).
 */
import type { Story } from "./model";

/** The level a story's chapters are headings of, or none: no level is used twice. */
export function chapterLevel(story: Story): number | undefined {
  return chapterLevelOf(
    story.blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : [])),
  );
}

/** The same, from the levels of a story's headings in order (an ebook's, read from its text). */
export function chapterLevelOf(levels: Iterable<number>): number | undefined {
  const counts = new Map<number, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  let found: number | undefined;
  for (const [level, count] of counts)
    if (count >= 2 && (found === undefined || level < found)) found = level;
  return found;
}
