import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { layoutScreenplay } from "../src/studio/layout";
import {
  adjacentScene,
  filterOutline,
  itemAtLine,
  outlineOf,
  pageAtSource,
} from "../src/studio/navigation";

describe("Studio source navigation", () => {
  const doc = parseFountain(
    "# Act one\n\nINT. ROOM - DAY\n\nA light.\n\n## Return\n\nEXT. HARBOR - NIGHT\n\nRain.",
  );
  it("includes sections without counting them as scenes and filters case-insensitively", () => {
    expect(outlineOf(doc).map((item) => item.kind)).toEqual([
      "section",
      "scene",
      "section",
      "scene",
    ]);
    expect(filterOutline(outlineOf(doc), "harBOR").items.map((item) => item.line)).toEqual([9]);
    expect(filterOutline(outlineOf(doc), "missing")).toEqual({ items: [], total: 0 });
  });
  it("bounds result rendering while retaining the full match count", () => {
    expect(
      filterOutline(
        Array.from({ length: 800 }, () => doc.elements[2]).filter(
          (item): item is NonNullable<typeof item> => Boolean(item),
        ),
        "",
      ).items,
    ).toHaveLength(500);
    expect(
      filterOutline(
        Array.from({ length: 800 }, () => doc.elements[2]).filter(
          (item): item is NonNullable<typeof item> => Boolean(item),
        ),
        "",
      ).total,
    ).toBe(800);
  });
  it("finds the current item and adjacent scene correctly at document boundaries", () => {
    const items = outlineOf(doc);
    expect(itemAtLine(items, 0)).toBe(-1);
    expect(itemAtLine(items, 8)).toBe(2);
    expect(adjacentScene(doc, 1, 1)).toBe(3);
    expect(adjacentScene(doc, 3, -1)).toBeUndefined();
    expect(adjacentScene(doc, 5, -1)).toBe(3);
    expect(adjacentScene(doc, 5, 1)).toBe(9);
    expect(adjacentScene(doc, 9, 1)).toBeUndefined();
  });
  it("locates source on the page and skips the title page", () => {
    const screenplay = parseFountain(
      "Title: Example\n\nINT. ROOM - DAY\n\nFirst.\n\n===\n\nEXT. ROOM - NIGHT\n\nSecond.",
    );
    const layout = layoutScreenplay(screenplay);
    expect(pageAtSource(layout, 3)).toBe(1);
    expect(pageAtSource(layout, 11)).toBe(2);
  });
});
