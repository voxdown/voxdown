// @vitest-environment happy-dom
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { blankShare, gapHeight, scriptEditor } from "../src";

const book = Array.from({ length: 400 }, (_, at) => `Paragraph ${at}, a line of the story.`).join(
  "\n\n",
);

describe("the heights guessed for what isn't drawn", () => {
  it("count a story's blank lines", () => {
    expect(blankShare(Text.of(book.split("\n")))).toBeCloseTo(399 / 799);
    expect(blankShare(Text.of(["One line."]))).toBe(0);
  });

  it("give blank lines their own height, the rest a line each and more where they wrap", () => {
    const doc = Text.of(book.split("\n"));
    const oracle = { doc, lineHeight: 28, lineLength: 70, lineWrapping: true };
    const all = gapHeight(oracle, 0, doc.length, blankShare(doc), 12);
    // 400 lines of text, 399 blank: far below 799 whole lines.
    expect(all).toBeGreaterThanOrEqual(400 * 28 + 399 * 12);
    expect(all).toBeLessThan(799 * 28 * 0.75);
  });

  it("are the story's own in the editor's view", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: book, extensions: scriptEditor({ characters: () => [] }) }),
      parent: document.body,
    });
    const oracle = (view as unknown as { viewState: { heightOracle: Record<string, unknown> } })
      .viewState.heightOracle;
    // Its own methods, given here: a blank line is guessed shorter than a line of text.
    expect(Object.hasOwn(oracle, "heightForGap")).toBe(true);
    const line = (oracle.heightForLine as (length: number) => number)(10);
    expect((oracle.heightForLine as (length: number) => number)(0)).toBeLessThan(line);
    view.destroy();
  });
});
