import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { layoutScreenplay } from "../src/studio/layout";
import { pageGuideField, pageGuideLocations, setPageGuides } from "../src/studio/page-guides";

describe("Studio printed page guides", () => {
  it("skips title metadata and locates explicit page breaks in the same layout used for PDF", () => {
    const source = "Title: Test\n\nINT. ROOM - DAY\n\nAction.\n\n===\n\nEXT. PARK - NIGHT\n\nRain.";
    const guides = pageGuideLocations(layoutScreenplay(parseFountain(source)));
    expect(guides).toEqual([
      { line: 3, pages: [1] },
      { line: 9, pages: [2] },
    ]);
  });
  it("groups pages starting inside a long source passage without inventing source lines", () => {
    const source = "A very long action sentence. ".repeat(1000);
    const layout = layoutScreenplay(parseFountain(source));
    expect(layout.pages.length).toBeGreaterThan(3);
    expect(pageGuideLocations(layout)).toEqual([
      { line: 1, pages: layout.pages.map((page) => page.number) },
    ]);
  });
  it("does not create markers for private-only scripts or empty printable pages", () => {
    expect(pageGuideLocations(layoutScreenplay(parseFountain("[[Private only.]]")))).toEqual([]);
  });
  it("clears stale page locations on edits and restores only supplied current results", () => {
    const source = "INT. ROOM - DAY\n\nAction.";
    let state = EditorState.create({ doc: source, extensions: [pageGuideField] });
    state = state.update({ effects: setPageGuides.of([{ line: 1, pages: [1] }]) }).state;
    expect(state.field(pageGuideField).size).toBe(1);
    state = state.update({ changes: { from: 0, insert: "\n" } }).state;
    expect(state.field(pageGuideField).size).toBe(0);
    state = state.update({ effects: setPageGuides.of([{ line: 2, pages: [1] }]) }).state;
    expect(state.field(pageGuideField).iter().from).toBe(1);
    expect(state.doc.toString()).toBe(`\n${source}`);
  });
});
