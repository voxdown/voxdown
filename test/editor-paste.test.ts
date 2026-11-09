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

  it("leaves no space before a stop where a sentence's end was cut (r12)", () => {
    const state = EditorState.create({
      doc: "He flipped down the hallway. Then left.",
      extensions: scriptEditor({ characters: () => [] }),
    });
    const at = "He flipped".length;
    const cut = state.update({
      changes: { from: at, to: at + " down the hallway".length },
      userEvent: "delete.cut",
    }).state;
    expect(cut.doc.toString()).toBe("He flipped. Then left.");
    const inner = state.update({
      changes: { from: at + 1, to: at + 1 + "down the hallway".length },
      userEvent: "delete.cut",
    }).state;
    expect(inner.doc.toString()).toBe("He flipped. Then left.");
  });

  it("keeps a sound's label as written, pasted or typed (r12)", () => {
    const state = EditorState.create({ doc: "", extensions: smartQuotes() });
    const pasted = state.update({
      changes: { from: 0, insert: "He said \"go\" [Knight's armor clanks] and it's done." },
      userEvent: "input.paste",
    }).state;
    expect(pasted.doc.toString()).toBe("He said “go” [Knight's armor clanks] and it’s done.");
    const inside = EditorState.create({ doc: "Then [Knight armor]", extensions: smartQuotes() });
    const intoLabel = inside.update({
      changes: { from: "Then [Knight".length, insert: "'s" },
      userEvent: "input.paste",
    }).state;
    expect(intoLabel.doc.toString()).toBe("Then [Knight's armor]");
  });
});
