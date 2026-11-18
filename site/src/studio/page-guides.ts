import { type Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";
import type { ScreenplayLayout } from "./layout";

export type PageGuide = { line: number; pages: number[] };

/** Source lines can wrap over several printed pages; do not invent in-line offsets. */
export function pageGuideLocations(layout: ScreenplayLayout): PageGuide[] {
  const lines = new Map<number, number[]>();
  for (const page of layout.pages) {
    if (page.number === null) continue;
    const line = page.lines.find((row) => row.sourceLine > 0)?.sourceLine;
    if (!line) continue;
    const pages = lines.get(line) ?? [];
    if (!pages.includes(page.number)) pages.push(page.number);
    lines.set(line, pages);
  }
  return [...lines].sort(([a], [b]) => a - b).map(([line, pages]) => ({ line, pages }));
}

export const setPageGuides = StateEffect.define<readonly PageGuide[]>();
class PageMarker extends GutterMarker {
  constructor(readonly pages: readonly number[]) {
    super();
  }
  eq(other: PageMarker): boolean {
    return this.pages.join(",") === other.pages.join(",");
  }
  toDOM(): Node {
    const marker = document.createElement("span");
    marker.textContent = `${this.pages[0]}${this.pages.length > 1 ? "+" : ""}`;
    marker.title = `Printed page starts: ${this.pages.join(", ")}. A page may begin within this source passage; use Page preview for exact wrapping.`;
    return marker;
  }
}
export const pageGuideField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(previous, transaction) {
    // Hide obsolete pagination immediately; only a fresh worker result may restore it.
    let next = transaction.docChanged ? RangeSet.empty : previous;
    for (const effect of transaction.effects) {
      if (!effect.is(setPageGuides)) continue;
      next = RangeSet.of(
        effect.value
          .filter((entry) => entry.line >= 1 && entry.line <= transaction.newDoc.lines)
          .map((entry) =>
            new PageMarker(entry.pages).range(transaction.newDoc.line(entry.line).from),
          ),
        true,
      );
    }
    return next;
  },
});

/** Informational gutter, opt-in; no source edits, padding, or extra keyboard stops. */
export function pageGuides(): Extension {
  return [
    pageGuideField,
    gutter({ class: "studio-page-guides", markers: (view) => view.state.field(pageGuideField) }),
  ];
}
