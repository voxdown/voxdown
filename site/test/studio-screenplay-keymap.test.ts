import { history, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import {
  screenplayEnter,
  screenplayKeymap,
  screenplayNextElement,
  screenplayPreviousElement,
} from "../src/studio/screenplay-keymap";

function editor(doc: string, anchor = doc.length, head = anchor, extensions: Extension[] = []) {
  const target = {
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [history(), screenplayKeymap(), ...extensions],
    }),
    dispatch(transaction: Transaction) {
      target.state = transaction.state;
    },
  };
  return target;
}

const commands = [screenplayEnter, screenplayNextElement, screenplayPreviousElement];

describe("optional screenplay keyboard commands", () => {
  it.each([
    ["INT. ROOM - DAY", "INT. ROOM - DAY\n\n"],
    [".THE DOOR", ".THE DOOR\n\n"],
    ["@Mara", "@Mara\n"],
    ["@Mara\n(quietly)", "@Mara\n(quietly)\n"],
    ["@Mara\nHello.", "@Mara\nHello.\n\n"],
  ])("moves from %s without inserting visual indentation", (source, expected) => {
    const target = editor(source);
    expect(screenplayEnter(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(expected);
    expect(target.state.selection.main.head).toBe(expected.length);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(source);
  });

  it("preserves following source with a separated empty paragraph", () => {
    const target = editor("@Mara\nHello.\n\nAnother scene.", 12);
    expect(screenplayEnter(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("@Mara\nHello.\n\n\n\nAnother scene.");
    expect(target.state.selection.main.head).toBe(14);
  });

  it.each([
    "An ordinary action.",
    "MARA",
    "Title: A Film",
    "Title: A Film\n    Subtitle",
    "# Act one",
    "= Synopsis",
    "===",
    ">CUT TO:",
    "~A song",
    "\\@literal",
    "\\INT. ROOM",
    "!FORCED ACTION",
    "@",
    "@Mara\n()",
    "",
    "  ",
  ])("leaves ambiguous or structural Enter to normal editing: %s", (source) => {
    const target = editor(source);
    expect(screenplayEnter(target)).toBe(false);
    expect(target.state.doc.toString()).toBe(source);
  });

  it("cycles empty elements in both directions, preserving exact undo", () => {
    const target = editor("");
    for (const expected of ["@", "INT. ", "!", ">", ""]) {
      expect(screenplayNextElement(target)).toBe(true);
      expect(target.state.doc.toString()).toBe(expected);
    }
    for (const expected of [">", "!", "INT. ", "@", ""]) {
      expect(screenplayPreviousElement(target)).toBe(true);
      expect(target.state.doc.toString()).toBe(expected);
    }
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("@");
  });

  it("offers parenthetical only after dialogue and places the caret inside", () => {
    const target = editor("@Mara\n");
    screenplayNextElement(target);
    expect(target.state.doc.toString()).toBe("@Mara\n@");
    screenplayNextElement(target);
    expect(target.state.doc.toString()).toBe("@Mara\n()");
    expect(target.state.selection.main.head).toBe(7);
    expect(parseFountain(target.state.doc.toString()).elements[1]?.kind).toBe("parenthetical");
    screenplayNextElement(target);
    expect(target.state.doc.toString()).toBe("@Mara\n.INT. ");
    expect(parseFountain(target.state.doc.toString()).elements[1]?.kind).toBe("scene");
    screenplayPreviousElement(target);
    expect(target.state.doc.toString()).toBe("@Mara\n()");
  });

  it.each(["INT. ROOM", "@Mara", "(quietly)", "!Action", ">CUT TO:", " ", "  ", "\t", " ()"])(
    "never cycles user content or significant whitespace: %s",
    (source) => {
      const target = editor(source);
      expect(screenplayNextElement(target)).toBe(false);
      expect(screenplayPreviousElement(target)).toBe(false);
      expect(target.state.doc.toString()).toBe(source);
    },
  );

  it("keeps title separators and private boundaries unchanged", () => {
    for (const source of [
      "Title: A Film\n",
      "[[private\n@Mara\ncontinued]]",
      "/*private\n@Mara\ncontinued*/",
      "[[private\n\ncontinued]]",
      "/*private\n\ncontinued*/",
      "@Mara [[private]]",
      "@Mara\nHello [[private]]",
      "/*unclosed\n@Mara",
      "[[unclosed\n@Mara",
    ]) {
      const anchor = source.includes("continued")
        ? source.lastIndexOf("\ncontinued")
        : source.length;
      for (const command of commands) {
        const target = editor(source, anchor);
        expect(command(target)).toBe(false);
        expect(target.state.doc.toString()).toBe(source);
      }
    }
  });

  it("maps remote private omissions without changing their contents", () => {
    const target = editor("[[secret]]\n\n", 12);
    expect(screenplayNextElement(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("[[secret]]\n\n@");
    expect(parseFountain(target.state.doc.toString()).omissions).toEqual([
      { from: 0, to: 10, kind: "note" },
    ]);
  });

  it("refuses mid-line operations, selections, multiple cursors and readonly", () => {
    for (const command of commands) {
      const middle = editor("INT. ROOM", 3);
      expect(command(middle)).toBe(false);
      const selected = editor("@Mara", 0, 5);
      expect(command(selected)).toBe(false);
      const readonly = editor("", 0, 0, [EditorState.readOnly.of(true)]);
      expect(command(readonly)).toBe(false);
      const multiple = editor("\n", 0, 0, [EditorState.allowMultipleSelections.of(true)]);
      multiple.dispatch(
        multiple.state.update({
          selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(1)]),
        }),
      );
      expect(command(multiple)).toBe(false);
    }
  });

  it("does not transform pasted or programmatically inserted source", () => {
    const source = "Title: Mine\n\nINT. ROOM\n\n@Mara\nHello.\n[[private]]";
    const target = editor("");
    target.dispatch(
      target.state.update({ changes: { from: 0, insert: source }, userEvent: "input.paste" }),
    );
    expect(target.state.doc.toString()).toBe(source);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("");
  });

  it("leaves composition keystrokes to the input method", () => {
    const target = editor("@Mara");
    const bindings = target.state.facet(keymap).flat();
    for (const key of ["Enter", "Tab", "Shift-Tab"]) {
      const binding = bindings.find((item) => item.key === key);
      expect(binding).toBeDefined();
      expect(binding?.run?.({ ...target, composing: true } as unknown as EditorView)).toBe(false);
    }
    expect(target.state.doc.toString()).toBe("@Mara");
  });

  it("isolates an assisted edit from preceding typing", () => {
    const target = editor("@Mara\nHell");
    target.dispatch(
      target.state.update({
        changes: { from: target.state.doc.length, insert: "o." },
        selection: { anchor: 12 },
        userEvent: "input.type",
      }),
    );
    expect(screenplayEnter(target)).toBe(true);
    undo(target);
    expect(target.state.doc.toString()).toBe("@Mara\nHello.");
    undo(target);
    expect(target.state.doc.toString()).toBe("@Mara\nHell");
  });
});
