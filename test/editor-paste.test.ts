import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { smartQuotes } from "../src/editor/quotes";

describe("pasted text (r7)", () => {
  it("curls straight quotes and apostrophes, as typing does", () => {
    const state = EditorState.create({ doc: "", extensions: smartQuotes() });
    const pasted = state.update({
      changes: { from: 0, insert: '@Rupert "It\'s mine." He said "go" -"now"' },
      userEvent: "input.paste",
    }).state;
    expect(pasted.doc.toString()).toBe("@Rupert “It’s mine.” He said “go” -“now”");
  });
});
