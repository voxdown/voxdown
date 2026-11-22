import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { repitch } from "../src/composer/barwise";
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

const apply = (text: string, changes: { from: number; to: number; insert: string }[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
const tune = (body: string, meter = "4/4", unit = "1/8") =>
  `X:1\nT:t\nM:${meter}\nL:${unit}\nK:C\n${body}\n`;

describe("a pitch typed over one note or chord re-pitches it in place (rule a)", () => {
  for (const [body, part, typed, out] of [
    ["G6 z2|]", "G6", "A", "A6 z2|]"],
    ['"Am"!f![ACE]2 z6|]', '"Am"!f![ACE]2', "B", '"Am"!f!B2 z6|]'],
    ["!pp!G>G z6|]", "!pp!G", "c", "!pp!c>G z6|]"],
    ["G4- G4|]", "G4", "E", "E4- G4|]"],
    ["[A2C2] z6|]", "[A2C2]", "D", "D2 z6|]"],
  ] as const)
    it(`${part} + ${typed}`, () => {
      const text = tune(body);
      const from = text.indexOf(part);
      const plan = repitch(text, [{ from, to: from + part.length }], typed);
      if (!plan) throw new Error("no plan");
      expect(apply(text, plan.changes)).toBe(tune(out));
    });
  it("over several notes, or several typed, it replaces as before", () => {
    const text = tune("G2 A2 B2 c2|]");
    expect(
      repitch(text, [{ from: text.indexOf("G2"), to: text.indexOf("A2") + 2 }], "c"),
    ).toBeNull();
    expect(
      repitch(text, [{ from: text.indexOf("G2"), to: text.indexOf("G2") + 2 }], "c'"),
    ).toBeNull();
  });
});
