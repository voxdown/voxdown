// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorMarks } from "@voxdown/editor";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { changesOnly, diffLines } from "../src/writer/diff";
import { emphasisIn, frontMatterEnd, toggleEmphasis } from "../src/writer/emphasis";
import { afterParagraph, moveParagraph } from "../src/writer/paragraphs";
import { problems } from "../src/writer/problems";
import { railAt, railPoints, railScenes, railY } from "../src/writer/rail";
import { thinVersions } from "../src/writer/store";
import { speechAt, speechOfMark } from "../src/writer/stretch";
import { glimpse, listening, wordCount } from "../src/writer/words";

describe("the scene rail's layout", () => {
  it("places scenes in proportion to the text, apart where there is room", () => {
    const points = railPoints([0, 500, 510, 900], 1000, 400);
    const ys = points.map((point) => point.y);
    // In order, within the rail, and each scene at least a label's room from the next.
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...ys)).toBeLessThanOrEqual(388);
    const scenes = ys.slice(1, -1);
    for (let i = 1; i < scenes.length; i++) {
      expect((scenes[i] ?? 0) - (scenes[i - 1] ?? 0)).toBeGreaterThanOrEqual(22);
    }
    // A place in the text and its height on the rail go both ways.
    for (const at of [0, 250, 700, 1000]) expect(railAt(points, railY(points, at))).toBeCloseTo(at);
  });

  it("keeps scenes in order and on the rail when there are more than fit", () => {
    const starts = Array.from({ length: 90 }, (_, i) => i * 100);
    const ys = railPoints(starts, 9000, 300).map((point) => point.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(Math.max(...ys)).toBeLessThanOrEqual(288);
  });

  it("names headings by their words, and scene breaks by their number", () => {
    const story = parse("# The Start\n\nOnce.\n\n* * *\n\nThen.\n\n## {hidden} The End\n\nDone.");
    const breakAt = story.blocks.find((block) => block.kind === "break")?.range.from ?? -1;
    const scenes = railScenes(story, new Map([[breakAt, 2]]));
    expect(scenes.map(({ name, chapter }) => [name, chapter])).toEqual([
      ["The Start", true],
      ["Scene 2", false],
      ["The End", false],
    ]);
  });
});

describe("moving a paragraph", () => {
  const editor = (doc: string, cursor: number) =>
    new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.cursor(cursor) }),
      parent: document.body,
    });

  it("moves the paragraph past the next one and back, the cursor with it", () => {
    const view = editor("One.\n\nTwo.\nStill two.\n\nThree.", 8);
    moveParagraph(view, 1, null);
    expect(view.state.doc.toString()).toBe("One.\n\nThree.\n\nTwo.\nStill two.");
    expect(
      view.state.sliceDoc(view.state.selection.main.head, view.state.selection.main.head + 2),
    ).toBe("o.");
    moveParagraph(view, -1, null);
    expect(view.state.doc.toString()).toBe("One.\n\nTwo.\nStill two.\n\nThree.");
    view.destroy();
  });

  it("never moves anything above the front matter, nor the front matter itself", () => {
    const text = "---\ntitle: T\n---\n\nFirst.\n\nSecond.";
    const end = parse(text).frontMatter?.range.to ?? null;
    const view = editor(text, text.indexOf("First"));
    moveParagraph(view, -1, end);
    expect(view.state.doc.toString()).toBe(text);
    const top = editor(text, 2);
    moveParagraph(top, 1, end);
    expect(top.state.doc.toString()).toBe(text);
    view.destroy();
    top.destroy();
  });

  it("changes nothing in a story that is only to read", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "One.\n\nTwo.",
        selection: EditorSelection.cursor(0),
        extensions: EditorState.readOnly.of(true),
      }),
      parent: document.body,
    });
    expect(moveParagraph(view, 1, null)).toBe(true);
    expect(view.state.doc.toString()).toBe("One.\n\nTwo.");
    view.destroy();
  });
});

describe("the passage under the pointer", () => {
  const story = parse("@Ann “Hello,” said Ann. @Bob “Hi.”\n\n# A heading");

  it("is the speech or narration there, and the one a name gives its words to", () => {
    expect(speechAt(story, story.source.indexOf("Hello"))?.speaker).toBe("Ann");
    expect(speechAt(story, story.source.indexOf("said"))?.speaker).toBe("Narrator");
    expect(speechAt(story, story.source.indexOf("Hi"))?.speaker).toBe("Bob");
    expect(speechOfMark(story, story.source.indexOf("@Bob"))?.text).toBe("Hi.");
    // A heading is the narrator's, but not a passage to give away.
    expect(speechAt(story, story.source.indexOf("heading"))).toBeUndefined();
  });
});

describe("what to put right", () => {
  const lineOf = (text: string) => (at: number) => text.slice(0, at).split("\n").length;

  it("offers to add a name the story uses to the cast", () => {
    const text = "---\ncast:\n  Ann:\n---\n@Ann “Hi.” @Bob “Hello.”";
    const found = problems(parse(text), editorMarks(text), lineOf(text));
    expect(found.find((problem) => problem.code === "unknown-character")?.cast).toBe("Bob");
  });

  it("closes a sound left open where its line ends, CRLF or not", () => {
    for (const end of ["\n", "\r\n"]) {
      const text = `The door [creaks${end}and opens.`;
      const open = problems(parse(text), editorMarks(text), lineOf(text)).find(
        (problem) => problem.code === "open-bracket",
      );
      expect(open?.fix).toEqual({
        from: text.indexOf(end),
        to: text.indexOf(end),
        insert: "]",
        label: "Close it at the end of the line",
      });
    }
  });

  it("lists the editor's own slips with their fixes, in the story's order", () => {
    const text = "@ Wanda “Hi.”\n\n@Ann “Unclosed.";
    const found = problems(parse(text), editorMarks(text), lineOf(text));
    expect(found.map((problem) => problem.code)).toEqual(["loose-at", "unclosed-quote"]);
    expect(found[0]?.fix?.label).toBe("Change to @Wanda");
    expect(found[1]?.line).toBe(3);
  });
});

describe("emphasis", () => {
  const shown = (line: string) =>
    emphasisIn(line).map(({ from, to, strong }) => [line.slice(from, to), strong]);

  it("finds italics and bold as written, and nothing in names, addresses or escapes", () => {
    expect(shown("A *quiet* word and **loud** ones, _too_.")).toEqual([
      ["*quiet*", false],
      ["**loud**", true],
      ["_too_", false],
    ]);
    expect(shown("**bold *and italic* inside**")).toEqual([
      ["**bold *and italic* inside**", true],
      ["*and italic*", false],
    ]);
    expect(shown("@Big_Bad_Wolf at a_b_c, \\*not* this, 2 * 3 * 4, and * this *.")).toEqual([]);
  });

  it("knows where the front matter ends without asking the story", () => {
    const state = (doc: string) => EditorState.create({ doc });
    expect(frontMatterEnd(state("---\ntitle: *Not emphasis*\n---\n\n*Yes.*"))).toBe(29);
    expect(frontMatterEnd(state("No front matter.\n---\n"))).toBe(0);
    expect(frontMatterEnd(state("---\nnever closed"))).toBe(0);
  });

  const editor = (doc: string, anchor: number, head = anchor) =>
    new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
      parent: document.body,
    });

  it("puts the signs around the word at the cursor, and takes them away again", () => {
    const view = editor("Say it now.", 5);
    toggleEmphasis(false)(view);
    expect(view.state.doc.toString()).toBe("Say *it* now.");
    expect(view.state.selection.main.head).toBe(6);
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Say ***it*** now.");
    toggleEmphasis(false)(view);
    expect(view.state.doc.toString()).toBe("Say **it** now.");
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Say it now.");
    view.destroy();
  });

  it("wraps a selection, unwraps one selected with its signs, and opens a pair on nothing", () => {
    const view = editor("Very loud words.", 5, 15);
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Very **loud words**.");
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("loud words");
    view.dispatch({ selection: EditorSelection.single(5, 19) });
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Very loud words.");
    const empty = editor("Then ", 5);
    toggleEmphasis(false)(empty);
    expect(empty.state.doc.toString()).toBe("Then **");
    expect(empty.state.selection.main.head).toBe(6);
    view.destroy();
    empty.destroy();
  });
});

describe("a line of its own after the paragraph", () => {
  const put = (
    doc: string,
    cursor: number,
    line: string,
    select?: string,
    front: number | null = null,
  ) => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
    const next = state.update(afterParagraph(state, front, line, select)).state;
    const { from, to } = next.selection.main;
    return { text: next.doc.toString(), selected: next.sliceDoc(from, to), at: from };
  };

  it("goes between two paragraphs with one blank line either side, the cursor after it", () => {
    const done = put("One, still one.\n\nTwo.", 3, "* * *");
    expect(done.text).toBe("One, still one.\n\n* * *\n\nTwo.");
    expect(done.text.slice(done.at)).toBe("Two.");
  });

  it("at the end, opens a new paragraph to go on writing, without piling up blank lines", () => {
    const done = put("One.\n\n\n", 1, "* * *");
    expect(done.text).toBe("One.\n\n* * *\n\n");
    expect(done.at).toBe(done.text.length);
  });

  it("selects a heading's words to type over, and never goes into the front matter", () => {
    const doc = "---\ntitle: T\n---\n\nFirst.";
    const done = put(doc, 5, "# A new chapter", "A new chapter", doc.indexOf("---\n\n") + 3);
    expect(done.text).toBe("---\ntitle: T\n---\n\n# A new chapter\n\nFirst.");
    expect(done.selected).toBe("A new chapter");
  });

  it("keeps a gap wider than one blank line as it was", () => {
    expect(put("A\n\n\n\nB", 0, "* * *").text).toBe("A\n\n* * *\n\n\n\nB");
  });
});

describe("comparing two versions", () => {
  it("finds the lines taken away and put in, whatever lies between", () => {
    const before = "A\nB\nC\nD\nE";
    const after = "A\nC\nD\nX\nE\nF";
    const lines = diffLines(before, after);
    expect(lines.filter((line) => line.kind !== "new").map((line) => line.text)).toEqual(
      before.split("\n"),
    );
    expect(lines.filter((line) => line.kind !== "gone").map((line) => line.text)).toEqual(
      after.split("\n"),
    );
    expect(lines.filter((line) => line.kind !== "same")).toEqual([
      { kind: "gone", text: "B" },
      { kind: "new", text: "X" },
      { kind: "new", text: "F" },
    ]);
  });

  it("reads CRLF and LF alike, and shows a long book's one change with what surrounds it", () => {
    const book = Array.from({ length: 5000 }, (_, i) => `Line ${i}.`);
    const changed = [...book];
    changed[2500] = "Line 2500, changed.";
    const shown = changesOnly(diffLines(book.join("\r\n"), changed.join("\n")));
    expect(shown.map((line) => line.kind)).toEqual([
      "skip",
      "same",
      "same",
      "gone",
      "new",
      "same",
      "same",
      "skip",
    ]);
    expect(shown[0]).toEqual({ kind: "skip", count: 2498 });
  });
});

describe("the versions kept", () => {
  const HOUR = 3_600_000;
  const now = 400 * 24 * HOUR;
  it("keeps every recent one, then fewer the older they are, and those before a change", () => {
    const versions = [
      // Every ten minutes for three days.
      ...Array.from({ length: 3 * 24 * 6 }, (_, i) => ({
        at: now - i * 10 * 60_000,
        why: "Saved",
      })),
      { at: now - 5 * HOUR - 1, why: "Before going back" },
      { at: now - 200 * 24 * HOUR, why: "Opened" },
    ];
    const kept = thinVersions(versions, now);
    const ages = kept.map((version) => (now - version.at) / HOUR);
    // The last hour, all six; then one an hour; then one a day.
    expect(ages.filter((age) => age < 1)).toHaveLength(6);
    const day = kept.filter((version) => now - version.at >= HOUR && now - version.at < 24 * HOUR);
    expect(day.filter((version) => version.why === "Saved").length).toBeLessThanOrEqual(24);
    expect(kept.some((version) => version.why === "Before going back")).toBe(true);
    expect(ages.filter((age) => age >= 24 && age < 72).length).toBeLessThanOrEqual(3);
    expect(kept.at(-1)?.why).toBe("Opened");
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
  });
});

describe("words", () => {
  it("counts words with their apostrophes and hyphens, in any script", () => {
    expect(wordCount("It’s a well-known fact, n'est-ce pas? Ünïcode 42 ok")).toBe(9);
  });

  it("says how long they take to hear, never 60 minutes past an hour", () => {
    expect(listening(10)).toBe("4 s to hear");
    expect(listening(1500)).toBe("10 min to hear");
    expect(listening(150 * 119.7)).toBe("2 h 0 min to hear");
    expect(listening(150 * 75)).toBe("1 h 15 min to hear");
  });

  it("knows a kept story by its title and first words, marks left out", () => {
    const story =
      '---\ntitle: "The Owl"\ncast:\n  Ann:\n---\n\n# One\n\n@Ann (softly) “Hush,” [an owl hoots] she said. %% a note %% {pause 1s} Then *quiet*.';
    expect(glimpse(story)).toEqual({
      title: "The Owl",
      words: "One “Hush,” she said. Then quiet.",
    });
    expect(glimpse("No front matter here.").title).toBeUndefined();
    expect(glimpse("word ".repeat(40)).words).toMatch(/^word( word)*…$/);
  });
});
