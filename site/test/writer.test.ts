// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorMarks } from "@voxdown/editor";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { moveParagraph } from "../src/writer/paragraphs";
import { problems } from "../src/writer/problems";
import { railAt, railPoints, railScenes, railY } from "../src/writer/rail";
import { speechAt, speechOfMark } from "../src/writer/stretch";

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
