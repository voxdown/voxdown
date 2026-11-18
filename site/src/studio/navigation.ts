import type { FountainDocument, FountainElement } from "./fountain";
import type { ScreenplayLayout } from "./layout";

export function outlineOf(document: FountainDocument): FountainElement[] {
  return document.elements.filter((item) => item.kind === "scene" || item.kind === "section");
}
export function filterOutline(items: FountainElement[], query: string, limit = 500) {
  const needle = query.trim().toLocaleLowerCase();
  const found = needle
    ? items.filter((item) => item.text.toLocaleLowerCase().includes(needle))
    : items;
  return { items: found.slice(0, Math.max(0, Math.min(500, limit))), total: found.length };
}
/** Last source item at/before the caret, without walking the DOM on every arrow key. */
export function itemAtLine(items: readonly { line: number }[], line: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((items[middle]?.line ?? Number.POSITIVE_INFINITY) <= line) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
export function adjacentScene(
  document: FountainDocument,
  line: number,
  direction: -1 | 1,
): number | undefined {
  const scenes = document.elements.filter((item) => item.kind === "scene");
  let at = itemAtLine(scenes, line);
  if (direction === 1) at++;
  else if (scenes[at]?.line === line) at--;
  return scenes[at]?.line;
}
export function pageAtSource(layout: ScreenplayLayout, line: number): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [page, sheet] of layout.pages.entries()) {
    if (sheet.number === null) continue;
    for (const row of sheet.lines) {
      if (row.sourceLine <= 0) continue;
      const delta = Math.abs(line - row.sourceLine);
      if (delta < distance) {
        nearest = page;
        distance = delta;
      }
    }
  }
  return nearest;
}
