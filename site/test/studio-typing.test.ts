import { deleteBracketPair, insertBracket } from "@codemirror/autocomplete";
import { history, redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { fountainRuns } from "../src/studio/inline";
import { smartPairs, toggleWritingMark } from "../src/studio/typing";

function editor(doc = "", anchor = doc.length, head = anchor) {
  let state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [history(), smartPairs()],
  });
  const dispatch = (tr: Transaction) => {
    state = tr.state;
  };
  return {
    get state() {
      return state;
    },
    run(command: StateCommand) {
      return command({ state, dispatch });
    },
    type(value: string) {
      for (const char of value)
        dispatch(
          insertBracket(state, char) ??
            state.update(state.replaceSelection(char), { userEvent: "input.type" }),
        );
    },
    select(anchor: number, head = anchor) {
      dispatch(state.update({ selection: { anchor, head } }));
    },
  };
}

describe("Studio typing assistance", () => {
  it("preserves private text across all selection boundaries and escape contexts", () => {
    for (const source of [
      "/*secret /private*/",
      "[[a \\]]secret]]",
      "\\\\[[secret]]",
      "before [[secret]] after",
    ]) {
      for (let from = 0; from <= source.length; from++) {
        for (let to = from; to <= source.length; to++) {
          for (const mark of ["bold", "italic", "underline", "note"] as const) {
            const e = editor(source, from, to);
            const original = parseFountain(source);
            const intentional =
              mark === "note" &&
              original.omissions.some(
                (span) =>
                  span.kind === "note" &&
                  ((from === span.from && to === span.to) ||
                    (from === span.from + 2 && to === span.to - 2)),
              );
            e.run(toggleWritingMark(mark));
            if (!intentional)
              expect(
                parseFountain(e.state.doc.toString())
                  .elements.filter((el) => el.kind !== "note")
                  .map((el) => el.text)
                  .join(" "),
              ).not.toContain("secret");
          }
        }
      }
    }
  });
  it("does not turn ordinary emphasis into a boneyard", () => {
    for (const mark of ["italic", "bold"] as const) {
      const e = editor("/secret/", 1, 7);
      expect(e.run(toggleWritingMark(mark))).toBe(false);
      expect(e.state.doc.toString()).toBe("/secret/");
    }
  });
  it("refuses new notes whose escapes would leave text printable", () => {
    for (const [source, from, to] of [
      ["\\secret", 1, 7],
      ["secret\\", 0, 7],
    ] as const) {
      const e = editor(source, from, to);
      expect(e.run(toggleWritingMark("note"))).toBe(false);
      expect(e.state.doc.toString()).toBe(source);
    }
  });
  it("never nests notes or unwraps separate notes as one private span", () => {
    for (const source of ["before [[existing]] after", "[[first]] [[second]]"]) {
      const e = editor(source, 0, source.length);
      expect(e.run(toggleWritingMark("note"))).toBe(false);
      expect(e.state.doc.toString()).toBe(source);
    }
    const within = editor("[[private]]", 5);
    expect(within.run(toggleWritingMark("note"))).toBe(false);
    expect(within.state.doc.toString()).toBe("[[private]]");
    for (const [from, to] of [
      [1, 1],
      [0, 1],
      [1, 2],
      [8, 9],
      [9, 9],
    ]) {
      const split = editor("[[secret]]", from, to);
      expect(split.run(toggleWritingMark("note"))).toBe(false);
      expect(split.state.doc.toString()).toBe("[[secret]]");
    }
  });
  it("does not damage separate emphasis spans when toggling a mixed selection", () => {
    const e = editor("**one** and **two**", 0, 19);
    expect(e.run(toggleWritingMark("bold"))).toBe(false);
    expect(e.state.doc.toString()).toBe("**one** and **two**");
  });
  it("protects comment delimiters for every formatting command and rejects partial boneyards", () => {
    for (const mark of ["bold", "italic", "underline", "note"] as const) {
      const e = editor("[[secret]]", 1);
      expect(e.run(toggleWritingMark(mark))).toBe(false);
      expect(e.state.doc.toString()).toBe("[[secret]]");
    }
    const boneyard = editor("/*secret tail*/", 0, 8);
    expect(boneyard.run(toggleWritingMark("note"))).toBe(false);
    expect(boneyard.state.doc.toString()).toBe("/*secret tail*/");
  });
  it("pairs a double-bracket note and overtypes only the generated closers", () => {
    const e = editor();
    e.type("[[");
    expect(e.state.doc.toString()).toBe("[[]]");
    expect(e.state.selection.main.head).toBe(2);
    e.type("a note]] after");
    expect(e.state.doc.toString()).toBe("[[a note]] after");
    expect(e.state.selection.main.head).toBe(16);
    const imported = editor("[[old]]", 5);
    imported.type("]");
    expect(imported.state.doc.toString()).toBe("[[old]]]");
  });
  it("removes empty pairs one layer at a time", () => {
    const e = editor();
    e.type("[[");
    expect(e.run(deleteBracketPair)).toBe(true);
    expect(e.state.doc.toString()).toBe("[]");
    expect(e.run(deleteBracketPair)).toBe(true);
    expect(e.state.doc.toString()).toBe("");
  });
  it("wraps selected text, including backwards selections", () => {
    const e = editor("keep these words", 16, 0);
    e.type("[[");
    expect(e.state.doc.toString()).toBe("[[keep these words]]");
    expect(e.state.selection.main).toEqual(EditorSelection.range(18, 2));
  });
  it("pairs parentheses, leaves prose quotes and escaped brackets alone, and avoids closing before words", () => {
    const e = editor();
    e.type("(quietly)");
    expect(e.state.doc.toString()).toBe("(quietly)");
    e.type(" 'hello' \"world\" \\[");
    expect(e.state.doc.toString()).toBe("(quietly) 'hello' \"world\" \\[");
    const beforeWord = editor("word", 0);
    beforeWord.type("[");
    expect(beforeWord.state.doc.toString()).toBe("[word");
  });
  it("undoes and redoes pairing without losing source", () => {
    const e = editor();
    e.type("[[note]]");
    expect(e.run(undo)).toBe(true);
    expect(e.state.doc.toString()).toBe("");
    expect(e.run(redo)).toBe(true);
    expect(e.state.doc.toString()).toBe("[[note]]");
  });
  it("wraps notes without replacing selected words and toggles them back", () => {
    const e = editor("Keep this", 0, 9);
    e.run(toggleWritingMark("note"));
    expect(e.state.doc.toString()).toBe("[[Keep this]]");
    e.run(toggleWritingMark("note"));
    expect(e.state.doc.toString()).toBe("Keep this");
    e.run(undo);
    expect(e.state.doc.toString()).toBe("[[Keep this]]");
  });
  it("combines and independently toggles bold and italic", () => {
    const e = editor("words", 0, 5);
    e.run(toggleWritingMark("bold"));
    e.run(toggleWritingMark("italic"));
    expect(e.state.doc.toString()).toBe("***words***");
    expect(fountainRuns(e.state.doc.toString())).toEqual([
      { text: "words", bold: true, italic: true, underline: false },
    ]);
    e.run(toggleWritingMark("italic"));
    expect(e.state.doc.toString()).toBe("**words**");
    e.run(toggleWritingMark("bold"));
    expect(e.state.doc.toString()).toBe("words");
  });
  it("puts emphasis inside selected whitespace and keeps an empty caret inside new markers", () => {
    const e = editor(" words ", 0, 7);
    e.run(toggleWritingMark("underline"));
    expect(e.state.doc.toString()).toBe(" _words_ ");
    e.run(toggleWritingMark("underline"));
    expect(e.state.doc.toString()).toBe(" words ");
    const empty = editor();
    empty.run(toggleWritingMark("bold"));
    expect(empty.state.doc.toString()).toBe("****");
    expect(empty.state.selection.main.head).toBe(2);
  });
  it("can remove selected markers and keeps formatting undo separate from typing", () => {
    const e = editor("**words**", 0, 9);
    e.run(toggleWritingMark("bold"));
    expect(e.state.doc.toString()).toBe("words");
    e.select(5);
    e.type(" more");
    e.run(undo);
    expect(e.state.doc.toString()).toBe("words");
    e.run(undo);
    expect(e.state.doc.toString()).toBe("**words**");
  });
});
