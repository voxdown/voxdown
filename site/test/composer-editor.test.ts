import { describe, expect, it } from "vitest";
import { clampRange, editorState, marksField, setMarks } from "../src/composer/editor";

describe("marks in the editor", () => {
  it("keeps stored problem positions inside the document, so the next edit maps them safely", () => {
    let state = editorState("X:1\nK:C\nCDEF GABc|\nV", { onUpdate: () => {}, keys: [] });
    const length = state.doc.length;
    // A check reports a range that reaches past the end (as an unfinished line can).
    state = state.update({
      effects: setMarks.of({
        issues: [
          { from: length - 1, to: length + 1, message: "x", severity: "warning", kind: "bar" },
        ],
      }),
    }).state;
    expect(state.field(marksField).list[0]?.to).toBe(length);
    // The next keystrokes go in, and the marks follow them.
    for (const text of [":", "2", "\n", "G,4"])
      state = state.update({ changes: { from: state.doc.length, insert: text } }).state;
    expect(state.doc.toString().endsWith("V:2\nG,4")).toBe(true);
    expect(state.field(marksField).list.every((issue) => issue.to <= state.doc.length)).toBe(true);
  });
  it("clamps ranges", () => {
    expect(clampRange({ from: 5, to: 12 }, 8)).toEqual({ from: 5, to: 8 });
    expect(clampRange({ from: 10, to: 12 }, 8)).toEqual({ from: 8, to: 8 });
  });
});
