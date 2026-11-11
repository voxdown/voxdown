import { SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { countText, matchCount } from "../src/writer/search-count";

const searching = (doc: string, query: string, from = 0, to = from) =>
  EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: search(),
  }).update({
    effects: setSearchQuery.of(new SearchQuery({ search: query })),
  }).state;

describe("find's count", () => {
  it("says how many, and which is selected", () => {
    const doc = "The owl, the cat, the dog.";
    expect(countText(matchCount(searching(doc, "the")), true)).toBe("3 found");
    // The second selected, as Find next leaves it.
    const second = doc.indexOf("the");
    expect(countText(matchCount(searching(doc, "the", second, second + 3)), true)).toBe("2 of 3");
    expect(countText(matchCount(searching(doc, "fox")), true)).toBe("No matches");
    expect(countText(matchCount(searching(doc, "")), false)).toBe("");
  });

  it("stops counting where it would take time for nothing", () => {
    const count = matchCount(searching("a ".repeat(30_000), "a"));
    expect(count).toEqual({ total: 10_000, at: 0, more: true });
    expect(countText(count, true)).toBe(`${(10_000).toLocaleString()}+ found`);
  });
});
