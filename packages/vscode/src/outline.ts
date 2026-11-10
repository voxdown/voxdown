/**
 * The outline of a story: its headings, nested by level, and its scene breaks (SPEC.md §4.4). The
 * extension turns each entry into a `vscode.DocumentSymbol`.
 */
import type { Heading, Range, Story, Visibility } from "voxdown";

export type OutlineEntry = {
  kind: "heading" | "break";
  name: string;
  /** How a heading is heard or seen, when it isn't both: "hidden", "book only", "audio only". */
  detail: string;
  /** A heading's whole section, up to the next heading of the same level or higher. */
  range: Range;
  /** The heading or break line itself. */
  selection: Range;
  children: OutlineEntry[];
};

const VISIBILITY: Record<Visibility, string> = {
  both: "",
  book: "book only",
  audio: "audio only",
  hidden: "hidden",
};

export function outline(story: Story): OutlineEntry[] {
  const top: OutlineEntry[] = [];
  const open: Array<{ entry: OutlineEntry; level: number }> = [];
  const end = story.source.length;
  const close = (level: number, at: number) => {
    while (open.length > 0 && (open[open.length - 1]?.level ?? 0) >= level) {
      const done = open.pop();
      if (done)
        done.entry.range = {
          from: done.entry.range.from,
          to: Math.max(at, done.entry.selection.to),
        };
    }
  };
  const add = (entry: OutlineEntry) => {
    const parent = open[open.length - 1];
    (parent ? parent.entry.children : top).push(entry);
  };
  let scene = 1;
  for (const block of story.blocks) {
    if (block.kind === "heading") {
      close(block.level, lineStart(story.source, block.range.from));
      const entry: OutlineEntry = {
        kind: "heading",
        name: headingName(story, block),
        detail: VISIBILITY[block.visibility],
        range: { ...block.range },
        selection: { ...block.range },
        children: [],
      };
      add(entry);
      open.push({ entry, level: block.level });
    } else if (block.kind === "break") {
      scene++;
      add({
        kind: "break",
        name: `Scene ${scene}`,
        detail: story.source.slice(block.range.from, block.range.to).trim(),
        range: { ...block.range },
        selection: { ...block.range },
        children: [],
      });
    }
  }
  close(0, end);
  return top;
}

/** What a heading says: its words, without marks, instructions or notes. */
function headingName(story: Story, heading: Heading): string {
  const words = heading.line.items
    .map((item) => (item.kind === "speech" ? item.text : ""))
    .filter((text) => text !== "")
    .join(" ")
    .trim();
  if (words) return words;
  const raw = story.source.slice(heading.line.range.from, heading.line.range.to).trim();
  return raw || "#".repeat(heading.level);
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}
