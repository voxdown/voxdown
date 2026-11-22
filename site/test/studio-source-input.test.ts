import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { MAX_LINES, MAX_SOURCE } from "../src/studio/source";
import { sourceEditProblem } from "../src/studio/source-input";

function editor(doc = "Original screenplay") {
  return EditorState.create({
    doc,
    extensions: EditorState.transactionFilter.of((transaction) =>
      sourceEditProblem(transaction) ? [] : transaction,
    ),
  });
}

describe("recoverable editor input", () => {
  it("rejects the whole replacement containing NUL, retaining source and selection", () => {
    const initial = editor().update({ selection: EditorSelection.range(0, 8) }).state;
    const transaction = initial.update({ changes: { from: 0, to: 8, insert: "New\0text" } });
    expect(transaction.docChanged).toBe(false);
    expect(transaction.state.doc.toString()).toBe(initial.doc.toString());
    expect(transaction.state.selection.eq(initial.selection)).toBe(true);
    expect(
      sourceEditProblem(EditorState.create().update({ changes: { from: 0, insert: "\0" } })),
    ).toMatch(/NUL/);
  });

  it("rejects all edits in a multiple-change transaction if any insertion has NUL", () => {
    const initial = editor("ABC");
    const result = initial.update({
      changes: [
        { from: 0, to: 1, insert: "X" },
        { from: 2, to: 3, insert: "\0" },
      ],
    });
    expect(result.state.doc.toString()).toBe("ABC");
  });

  it("permits literal Unicode, BOM, private text and CodeMirror newline normalization", () => {
    const text = "\uFEFF!Cafe\u0301 🌙\r\n[[private]]\rnext\n\ud800";
    const state = editor("").update({ changes: { from: 0, insert: text } }).state;
    expect(state.doc.toString()).toBe(text.replace(/\r\n?/g, "\n"));
  });

  it("permits exact size bounds and rejects overflow atomically", () => {
    const size = editor("a".repeat(MAX_SOURCE - 1));
    expect(size.update({ changes: { from: 0, insert: "b" } }).state.doc.length).toBe(MAX_SOURCE);
    expect(size.update({ changes: { from: 0, insert: "bc" } }).docChanged).toBe(false);
    const lines = editor("\n".repeat(MAX_LINES - 2));
    expect(lines.update({ changes: { from: 0, insert: "\n" } }).state.doc.lines).toBe(MAX_LINES);
    expect(lines.update({ changes: { from: 0, insert: "\n\n" } }).docChanged).toBe(false);
  });

  it("does not block navigation or repairs of existing invalid source", () => {
    const initial = editor("A\0B");
    expect(initial.update({ selection: { anchor: 2 } }).state.selection.main.head).toBe(2);
    expect(initial.update({ changes: { from: 1, to: 2 } }).state.doc.toString()).toBe("AB");
  });
});
