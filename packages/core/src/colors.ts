/**
 * A color for each character, for tools that draw a story: the renderer's script view and the
 * editor. Assigned in cast order (SPEC.md §14), then in the order characters first speak.
 */
import type { Item, Story } from "./model";

/** Colors that read on white and on dark paper, assigned in cast order. */
export const PALETTE = [
  "#2563eb",
  "#c2410c",
  "#15803d",
  "#9333ea",
  "#be123c",
  "#0e7490",
  "#a16207",
  "#4f46e5",
  "#b45309",
  "#047857",
] as const;

/** Each character's color: options first, then the cast's own `color`, then the palette. */
export function characterColors(
  story: Story,
  overrides: Record<string, string> = {},
): Map<string, string> {
  const colors = new Map<string, string>();
  const names: string[] = [];
  // Each name once, whatever its case, found by key rather than by a search of those before.
  const seen = new Set([story.meta.narrator.toLowerCase()]);
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  story.cast.forEach((member) => add(member.handle));
  for (const item of items(story))
    if (item.kind === "speech" || item.kind === "vocal") add(item.speaker);
  for (const group of story.groups) if (group.character) add(group.character);
  const members = new Map(story.cast.map((member) => [member.handle, member]));
  names.forEach((name, index) => {
    const own = members.get(name)?.data.color;
    const color =
      overrides[name] ??
      (typeof own === "string" && /^#[0-9a-f]{3,8}$/i.test(own) ? own : undefined);
    colors.set(name, color ?? PALETTE[index % PALETTE.length] ?? "#2563eb");
  });
  return colors;
}

function items(story: Story): Item[] {
  return story.blocks.flatMap((block) => {
    if (block.kind === "break") return [];
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    return lines.flatMap((line) => line.items);
  });
}
