import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { layoutScreenplay } from "../src/studio/layout";
import { manuscriptPageIndex } from "../src/studio/manuscript-navigation";
import { pageAtSource } from "../src/studio/navigation";

describe("manuscript page index", () => {
  it("matches page-preview source lookup without counting title pages", () => {
    const source =
      "Title: A story\n\nINT. ROOM - DAY\n\nHello.\n\n===\n\nEXT. ROAD - NIGHT\n\nGoodbye.\n";
    const layout = layoutScreenplay(parseFountain(source));
    const index = manuscriptPageIndex(layout);
    expect(index.pages.map((page) => page.number)).toEqual([1, 2]);
    for (let line = 1; line <= source.split("\n").length; line++)
      expect(index.at(line)).toBe(layout.pages[pageAtSource(layout, line)]?.number);
  });
  it("keeps all page destinations when one long source passage spans pages", () => {
    const layout = layoutScreenplay(
      parseFountain(`INT. ROOM - DAY\n\n${"A long journey. ".repeat(1000)}`),
    );
    const index = manuscriptPageIndex(layout);
    expect(index.pages.length).toBeGreaterThan(2);
    expect(index.pages[1]?.line).toBe(3);
    expect(index.at(3)).toBe(1);
  });
});
