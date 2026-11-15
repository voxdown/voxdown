// @vitest-environment happy-dom
import { EditorSelection, EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { detailsFold, detailsRange, detailsSummary } from "../src/writer/details-fold";

const STORY = `---
voxdown: 1.3
title: "The Owl"
author: A. Teller
cast:
  Mara:
    about: Brave.
  Tom:
    name: Tom Hart
  Narrator:
    about: Warm.
---

# The Owl

Night fell.
`;

describe("a story's details folded into a line", () => {
  it("finds the front matter as the parser does, and only that", () => {
    const doc = Text.of(STORY.split("\n"));
    const range = detailsRange(doc);
    expect(range && doc.sliceString(range.from, range.to).endsWith("Warm.\n---")).toBe(true);
    expect(detailsRange(Text.of(["# No details", "", "Night."]))).toBeNull();
    // Never closed: no details to fold.
    expect(detailsRange(Text.of(["---", "title: Open", "", "Night."]))).toBeNull();
    // Past 400 lines: not looked for further.
    const long = ["---", ...Array.from({ length: 450 }, (_, i) => `k${i}: v`), "---", "Night."];
    expect(detailsRange(Text.of(long))).toBeNull();
  });

  it("says the title and how many are in the cast", () => {
    expect(detailsSummary(STORY.split("---")[1] ?? "")).toBe("“The Owl”, 3 in the cast");
    expect(detailsSummary("voxdown: 1.3\ntitle: Untitled\n")).toBe("“Untitled”");
    expect(detailsSummary("voxdown: 1.3\n")).toBe("");
  });

  it("unfolds as the cursor goes in, at the end of the details' last line from below", () => {
    const opened = (at: number) =>
      EditorState.create({
        doc: STORY,
        selection: EditorSelection.cursor(at),
        extensions: detailsFold(),
      });
    // Up from the blank line just under them, over the folded line: the end of "about: Warm.".
    const blank = STORY.indexOf("---\n\n") + 4;
    const up = opened(blank).update({ selection: { anchor: 0 }, userEvent: "select" }).state;
    expect(up.selection.main.head).toBe(STORY.indexOf("Warm.") + "Warm.".length);
    // Ctrl+Home from the story: the very start, as ever.
    const home = opened(STORY.indexOf("Night")).update({
      selection: { anchor: 0 },
      userEvent: "select",
    }).state;
    expect(home.selection.main.head).toBe(0);
  });
});
