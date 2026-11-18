import { history, redo, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { MAX_SOURCE } from "../src/studio/source";
import { learnTransitions } from "../src/studio/transition-learning";

function editor(doc: string) {
  let state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [history(), learnTransitions()],
  });
  return {
    get state() {
      return state;
    },
    get text() {
      return state.doc.toString();
    },
    type(text: string, event = "input.type") {
      state = state.update({ ...state.replaceSelection(text), userEvent: event }).state;
    },
    edit(from: number, to: number, insert: string) {
      state = state.update({ changes: { from, to, insert } }).state;
    },
    select(anchor: number) {
      state = state.update({ selection: { anchor } }).state;
    },
    undo() {
      return undo({
        state,
        dispatch: (tr: Transaction) => {
          state = tr.state;
        },
      });
    },
    redo() {
      return redo({
        state,
        dispatch: (tr: Transaction) => {
          state = tr.state;
        },
      });
    },
  };
}

describe("document-local transition learning", () => {
  it("adds a portable marker in the typing transaction and preserves the caret", () => {
    const initial = "> FADE OUT.\n\nFade out";
    const e = editor(initial);
    e.type(".");
    expect(e.text).toBe("> FADE OUT.\n\n> Fade out.");
    expect(e.state.selection.main.head).toBe(e.state.doc.length);
    expect(e.undo()).toBe(true);
    expect(e.text).toBe(initial);
    expect(e.redo()).toBe(true);
    expect(e.text).toBe("> FADE OUT.\n\n> Fade out.");
  });
  it("learns immediately from a newly typed definition, ignoring case and extra spaces", () => {
    const e = editor("");
    e.type("> FADE OUT.");
    e.type("\n\n");
    for (const character of "  fade   out.") e.type(character);
    expect(e.text).toBe("> FADE OUT.\n\n  > fade   out.");
    expect(e.state.selection.main.head).toBe(e.state.doc.length);
  });
  it("does not learn from later definitions, centered text, empty markers or private text", () => {
    for (const source of ["> THE END <", ">", "/*\n> THE END\n*/", "[[\n> THE END\n]]"]) {
      const e = editor(`${source}\n\n`);
      e.type("THE END");
      expect(e.text).toBe(`${source}\n\nTHE END`);
    }
    const e = editor("\n\n> THE END");
    e.select(0);
    e.type("THE END");
    expect(e.text).toBe("THE END\n\n> THE END");
    const otherDocument = editor("");
    otherDocument.type("THE END");
    expect(otherDocument.text).toBe("THE END");
  });
  it("leaves dialogue, forced elements and non-standalone paragraphs alone", () => {
    for (const prefix of ["NORA\n", "!", "@", "# ", "~", "\\", "Action\n", "INT. "]) {
      const e = editor(`> THE END\n\n${prefix}`);
      e.type("THE END");
      expect(e.text).toBe(`> THE END\n\n${prefix}THE END`);
    }
    const e = editor("> THE END\n\n\nAnother action.");
    e.select(e.text.indexOf("\nAnother"));
    e.type("THE END");
    expect(e.text).toBe("> THE END\n\nTHE END\nAnother action.");
  });
  it("checks the current privacy context of both definitions and candidate lines", () => {
    const e = editor("> THE END\n\n");
    e.edit(0, 0, "/*\n");
    e.edit(e.text.length, e.text.length, "*/\n\n");
    e.select(e.text.length);
    e.type("THE END");
    expect(e.text).toBe("/*\n> THE END\n\n*/\n\nTHE END");
    const inside = editor("> THE END\n\n/*\n\n\n\n*/");
    inside.select(inside.text.indexOf("/*") + 4);
    inside.type("THE END");
    expect(inside.text).toBe("> THE END\n\n/*\n\nTHE END\n\n*/");
  });
  it("allows an unrelated unfinished note later in the document", () => {
    const e = editor("> FADE OUT.\n\nFade out\n\n[[unfinished");
    e.select(e.text.indexOf("\n\n[["));
    e.type(".");
    expect(e.text).toBe("> FADE OUT.\n\n> Fade out.\n\n[[unfinished");
    const uncertain = editor("> FADE OUT.\n\n/*unfinished\n\n");
    uncertain.type("Fade out.");
    expect(uncertain.text).toBe("> FADE OUT.\n\n/*unfinished\n\nFade out.");
  });
  it("updates definitions after edits and deletions", () => {
    const e = editor("> THE END\n\n");
    e.edit(2, 9, "FINISH");
    e.select(e.text.length);
    e.type("THE END");
    expect(e.text).toBe("> FINISH\n\nTHE END");
    e.type("\n\n");
    e.type("FINISH");
    expect(e.text).toBe("> FINISH\n\nTHE END\n\n> FINISH");
    e.edit(0, e.text.length, "\n\n");
    e.select(e.text.length);
    e.type("FINISH");
    expect(e.text).toBe("\n\nFINISH");
  });
  it("keeps definitions indexed when text before them changes", () => {
    const e = editor("Action.\n\n> THE END\n\n");
    e.edit(0, 0, "Another action.\n\n");
    e.select(e.text.length);
    e.type("THE END");
    expect(e.text.endsWith("\n\n> THE END")).toBe(true);
    e.undo();
    e.edit(0, e.text.indexOf(">"), "");
    e.select(e.text.length);
    e.type("THE END");
    expect(e.text).toBe("> THE END\n\n> THE END");
  });
  it("preserves imported text and multiline paste, but supports a pasted standalone phrase", () => {
    const original = "> THE END\n\nTHE END";
    expect(editor(original).text).toBe(original);
    const e = editor("> THE END\n\n");
    e.type("THE END\n\nTHE END", "input.paste");
    expect(e.text).toBe("> THE END\n\nTHE END\n\nTHE END");
    e.type("\n\n");
    e.type("THE END", "input.paste");
    expect(e.text.endsWith("\n\n> THE END")).toBe(true);
  });
  it("does not interrupt composition or exceed the source limit", () => {
    const e = editor("> THE END\n\n");
    e.type("THE END", "input.type.compose");
    expect(e.text).toBe("> THE END\n\nTHE END");
    const prefix = "> THE END\n\n";
    const large = editor(`${prefix}${"x".repeat(MAX_SOURCE - prefix.length - 10)}\n\n`);
    large.type("THE END");
    expect(large.text.length).toBe(MAX_SOURCE - 1);
    expect(large.text.endsWith("\n\nTHE END")).toBe(true);
  });
});
