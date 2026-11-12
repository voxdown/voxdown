/**
 * A long story's script or book, in chunks for the side: each chunk is laid out only when it comes
 * into view (content-visibility), as each part was. The browser checks every such box on every
 * frame, typing included, and a book has thousands of parts: in chunks of forty it checks a
 * fortieth as many, and has a fortieth as many layers to find the pointer among.
 *
 * A chunk holds its parts' margins in (it lays them out on its own), so it is cut only between two
 * paragraphs, whose space apart is the same either way (one's margin below, the other's above,
 * none or less than none); the book's indent for a paragraph after a paragraph is carried across
 * the cut by the stylesheet.
 */

/** About how many parts make a chunk. */
export const CHUNK = 40;

/** Blocks that hold others, and paragraphs (a paragraph of several lines is written to several). */
const OPENS = /<(?:div|section|blockquote|aside|ul|ol|figure|header|details|table|p)\b/g;
const CLOSES = /<\/(?:div|section|blockquote|aside|ul|ol|figure|header|details|table|p)>/g;
const PARAGRAPH = /^<p class="vxd-p"/;

/**
 * The renderer's lines between `<article>` and `</article>` (a block to a line, or more), as HTML
 * pieces in order: the header as it is, then the chunks. With no two paragraphs together for a long
 * way (a story of groups alone), a chunk is cut where it can be at four times the size.
 */
export function chunks(body: readonly string[], size = CHUNK): string[] {
  const blocks: string[] = [];
  let block: string[] = [];
  let depth = 0;
  for (const line of body) {
    block.push(line);
    depth += (line.match(OPENS)?.length ?? 0) - (line.match(CLOSES)?.length ?? 0);
    if (depth <= 0) {
      blocks.push(block.join("\n"));
      block = [];
      depth = 0;
    }
  }
  if (block.length) blocks.push(block.join("\n"));

  const pieces: string[] = [];
  let chunk: string[] = [];
  const close = () => {
    if (chunk.length)
      pieces.push(
        `<div class="side-chunk" style="--parts: ${chunk.length}">\n${chunk.join("\n")}\n</div>`,
      );
    chunk = [];
  };
  for (const [i, part] of blocks.entries()) {
    if (/^<header\b/.test(part)) {
      close();
      pieces.push(part);
      continue;
    }
    chunk.push(part);
    const next = blocks[i + 1];
    const between = PARAGRAPH.test(part) && next !== undefined && PARAGRAPH.test(next);
    if ((chunk.length >= size && between) || chunk.length >= size * 4) close();
  }
  close();
  return pieces;
}
