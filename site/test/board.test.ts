import { describe, expect, it } from "vitest";
import { applyChanges, parse } from "voxdown";
import { aboutComment, boardOf, moveSpan, readAbout } from "../src/writer/board";

const STORY = `---
title: The Owl
---

## One

The night was still.

### The harbour
<!-- draft: Mara hears a door. -->

Mara listened. A door slammed.

### The owl

The owl said nothing.

## Two

* * *

Morning came, grey and slow.
`;

describe("the scene board", () => {
  it("lays out chapters and their scenes, with their words, state and line", () => {
    const board = boardOf(parse(STORY));
    expect(board.map((chapter) => [chapter.name, chapter.words])).toEqual([
      // Headings are words of the book too.
      ["One", 18],
      ["Two", 6],
    ]);
    const harbour = board[0]?.scenes[0];
    expect(harbour).toMatchObject({
      name: "The harbour",
      state: "draft",
      summary: "Mara hears a door.",
      words: 7,
    });
    expect(STORY.slice(harbour?.about?.from, harbour?.about?.to)).toBe(
      "<!-- draft: Mara hears a door. -->",
    );
    expect(board[0]?.scenes[1]).toMatchObject({ name: "The owl", summary: "", words: 6 });
    expect(board[1]?.scenes[0]).toMatchObject({ name: "Scene 1", break: true });
  });

  it("reads and writes a scene's line and state", () => {
    expect(readAbout(" Revised — the end ")).toEqual({ state: "revised", summary: "the end" });
    expect(readAbout("Just a line")).toBeUndefined();
    expect(readAbout("scene: Just a line")).toEqual({ summary: "Just a line" });
    expect(aboutComment("done", "It ends.")).toBe("<!-- done: It ends. -->");
    expect(aboutComment("idea", "")).toBe("<!-- idea -->");
    expect(aboutComment(undefined, "a --> b")).toBe("<!-- scene: a → b -->");
    expect(aboutComment(undefined, " ")).toBe("");
    expect(readAbout("idea")).toEqual({ state: "idea", summary: "" });
    expect(readAbout("Ideas came")).toBeUndefined();
  });

  it("moves a scene before another, and a chapter to the end, as one change", () => {
    const board = boardOf(parse(STORY));
    const [harbour, owl] = board[0]?.scenes ?? [];
    if (!harbour || !owl) throw new Error("no scenes");
    const swapped = applyChanges(STORY, moveSpan(STORY, owl.from, owl.to, harbour.from));
    expect(swapped.indexOf("### The owl")).toBeLessThan(swapped.indexOf("### The harbour"));
    expect(swapped).toContain("The owl said nothing.\n\n### The harbour\n<!-- draft:");
    expect(swapped).toContain("A door slammed.\n\n## Two");
    const [one] = board;
    if (!one) throw new Error("no chapter");
    const moved = applyChanges(STORY, moveSpan(STORY, one.from, one.to, STORY.length));
    expect(moved.indexOf("## Two")).toBeLessThan(moved.indexOf("## One"));
    expect(moved).toMatch(/grey and slow\.\n\n## One\n[\s\S]*said nothing\.\n$/);
    // The last scene moved up: the story still ends with one line break.
    const last = boardOf(parse(STORY))[1]?.scenes[0];
    if (!last) throw new Error("no last scene");
    const up = applyChanges(STORY, moveSpan(STORY, last.from, last.to, owl.from));
    expect(up.endsWith("## Two\n")).toBe(true);
    expect(moveSpan(STORY, owl.from, owl.to, owl.from)).toEqual([]);
  });
});

describe("the scene board of a short story", () => {
  it("shows its sections as cards in one column, when they hold no scenes", () => {
    const story =
      "# The Owl\n\n## Night\n<!-- done: Dark. -->\n\nIt was dark.\n\n## Morning\n\nLight came.\n";
    const board = boardOf(parse(story));
    expect(board).toHaveLength(1);
    expect(board[0]?.scenes.map((scene) => [scene.name, scene.state ?? ""])).toEqual([
      ["Night", "done"],
      ["Morning", ""],
    ]);
  });
});
