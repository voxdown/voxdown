import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { type OutlineEntry, outline } from "../src/outline";

const names = (entries: OutlineEntry[]): unknown[] =>
  entries.map((entry) =>
    entry.children.length > 0 ? [entry.name, names(entry.children)] : entry.name,
  );

describe("the outline", () => {
  it("nests headings by level, with scene breaks inside them", () => {
    const text = [
      "# The Tale {book only}",
      "Once.",
      "## The garden",
      "Peter ran.",
      "---",
      "He hid.",
      "## The gate {hidden}",
      "# Afterword",
    ].join("\n");
    const entries = outline(parse(text));
    expect(names(entries)).toEqual([
      ["The Tale", [["The garden", ["Scene 2"]], "The gate"]],
      "Afterword",
    ]);
    expect(entries[0]?.detail).toBe("book only");
    expect(entries[0]?.children[1]?.detail).toBe("hidden");
    expect(entries[0]?.children[0]?.children[0]?.detail).toBe("---");
  });

  it("spans each heading's section, and selects its line", () => {
    const text = "# One\nText.\n## Two\nMore.\n# Three\nEnd.";
    const [one, three] = outline(parse(text));
    expect(text.slice(one?.selection.from, one?.selection.to)).toBe("# One");
    expect(text.slice(one?.range.from, one?.range.to)).toBe("# One\nText.\n## Two\nMore.\n");
    expect(text.slice(three?.range.from, three?.range.to)).toBe("# Three\nEnd.");
    const two = one?.children[0];
    expect(text.slice(two?.range.from, two?.range.to)).toBe("## Two\nMore.\n");
  });

  it("names a heading by its words, without marks, and never leaves a name empty", () => {
    const [marked, empty] = outline(parse("# @Gerald “Could you not?”\n# {hidden}"));
    expect(marked?.name).toBe("Could you not?");
    expect(empty?.name).toBe("{hidden}");
    expect(outline(parse("#  "))[0]?.name).toBe("#");
  });

  it("lists scene breaks with no heading at the top", () => {
    expect(names(outline(parse("Until Tuesday.\n\n***\n\nOn Tuesday.\n---\nLater.")))).toEqual([
      "Scene 2",
      "Scene 3",
    ]);
  });
});
