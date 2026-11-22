import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { caretAfter, sortChange } from "../src/composer/book";
import { noCrossedRanges } from "../src/composer/selection-guard";
import { indexFile } from "../src/composer/tunes";

/* Round 8 (selection hardening): the editing rules as a musician judges them. */

const BOOK = "X:1\nT:Zebra\nK:C\nC D E F|]\n\nX:2\nT:Apple\nK:G\nG A B c|]\n";

describe("Tunes › Sort with a selection (item 1)", () => {
  it("a range inside the rewritten span never comes out crossed", () => {
    const from = BOOK.indexOf("D E");
    const state = EditorState.create({
      doc: BOOK,
      selection: EditorSelection.range(from, from + 3),
      extensions: [noCrossedRanges],
    });
    const change = sortChange(BOOK, indexFile(BOOK), "title");
    if (!change) throw new Error("no change");
    const after = state.update({ changes: change }).state;
    for (const range of after.selection.ranges) expect(range.from).toBeLessThanOrEqual(range.to);
    // Without the guard, CodeMirror crosses it.
    const bare = EditorState.create({
      doc: BOOK,
      selection: EditorSelection.range(from, from + 3),
    });
    const crossed = bare.update({ changes: change }).state.selection.main;
    expect(crossed.from).toBeGreaterThan(crossed.to);
  });
  it("the caret goes to the same place in the tune it was in, wherever it moved", () => {
    const change = sortChange(BOOK, indexFile(BOOK), "title");
    if (!change) throw new Error("no change");
    const after = BOOK.slice(0, change.from) + change.insert + BOOK.slice(change.to);
    const at = BOOK.indexOf("D E");
    const caret = caretAfter(BOOK, indexFile(BOOK), at, after);
    expect(after.slice(caret, caret + 3)).toBe("D E");
  });
});
