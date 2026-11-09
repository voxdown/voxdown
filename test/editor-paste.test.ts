import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { scriptEditor } from "../src/editor";
import { smartQuotes } from "../src/editor/quotes";

describe("pasted text (r7)", () => {
  it("curls straight quotes and apostrophes, as typing does", () => {
    const state = EditorState.create({ doc: "", extensions: smartQuotes() });
    const pasted = state.update({
      changes: { from: 0, insert: '@Rupert "It\'s mine." He said "go" -"now"' },
      userEvent: "input.paste",
    }).state;
    expect(pasted.doc.toString()).toBe("@Rupert “It’s mine.” He said “go” -“now”");
    const single = state.update({
      changes: { from: 0, insert: "He said 'no' and left." },
      userEvent: "input.paste",
    }).state;
    expect(single.doc.toString()).toBe("He said ‘no’ and left.");
    const elided = state.update({
      changes: { from: 0, insert: "'Twas rock 'n' roll, 'em all." },
      userEvent: "input.paste",
    }).state;
    expect(elided.doc.toString()).toBe("’Twas rock ’n’ roll, ’em all.");
    const decade = state.update({
      changes: { from: 0, insert: "Back in the '90s." },
      userEvent: "input.paste",
    }).state;
    expect(decade.doc.toString()).toBe("Back in the ’90s.");
  });

  it("leaves one space where words were cut from between others (r11)", () => {
    const state = EditorState.create({
      doc: "One. Two. Three.",
      extensions: scriptEditor({ characters: () => [] }),
    });
    const cut = state.update({
      changes: { from: 5, to: 9 },
      userEvent: "delete.cut",
    }).state;
    expect(cut.doc.toString()).toBe("One. Three.");
  });
});
