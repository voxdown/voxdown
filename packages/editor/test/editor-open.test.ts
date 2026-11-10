import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { holdOpen, openField } from "../src/decorations";

const doc = "One line.\n\nTwo line.\n\nThree line.";
const at = (text: string) => doc.indexOf(text);

describe("where the text opens (owner, 9 Nov)", () => {
  it("holds still while the pointer is down, and opens where a click put the cursor", () => {
    let state = EditorState.create({ doc, extensions: [openField] });
    state = state.update({ selection: { anchor: at("One") + 2 } }).state;
    expect(state.field(openField).ranges).toEqual([{ from: 2, to: 2 }]);
    // Pressed on "Two", dragged to "Three": nothing opens or closes on the way.
    state = state.update({ effects: holdOpen.of(true) }).state;
    state = state.update({ selection: { anchor: at("Two"), head: at("Three") + 3 } }).state;
    expect(state.field(openField).ranges).toEqual([{ from: 2, to: 2 }]);
    // Let go after the drag: what was open stays open.
    state = state.update({ effects: holdOpen.of("drag") }).state;
    expect(state.field(openField).ranges).toEqual([{ from: 2, to: 2 }]);
    // A click (pressed and let go without moving) opens where it puts the cursor.
    state = state.update({ effects: holdOpen.of(true) }).state;
    state = state.update({ selection: { anchor: at("Two") + 1 } }).state;
    expect(state.field(openField).ranges).toEqual([{ from: 2, to: 2 }]);
    state = state.update({ effects: holdOpen.of("click") }).state;
    expect(state.field(openField).ranges).toEqual([{ from: at("Two") + 1, to: at("Two") + 1 }]);
  });

  it("keeps what was open for a selection over several lines made with the keys", () => {
    let state = EditorState.create({
      doc,
      extensions: [openField],
      selection: EditorSelection.cursor(at("Two")),
    });
    state = state.update({ selection: { anchor: at("Two"), head: at("Three") + 2 } }).state;
    expect(state.field(openField).ranges).toEqual([{ from: at("Two"), to: at("Two") }]);
    // Within one line, it opens.
    state = state.update({ selection: { anchor: at("Three"), head: at("Three") + 5 } }).state;
    expect(state.field(openField).ranges).toEqual([{ from: at("Three"), to: at("Three") + 5 }]);
  });
});
