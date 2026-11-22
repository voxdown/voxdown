import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { cutPlan, repitch } from "../src/composer/barwise";
import { caretAfter, sortChange } from "../src/composer/book";
import { planPaste } from "../src/composer/paste";
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

const cutOf = (text: string, from: number, to: number) => {
  const plan = cutPlan(text, [{ from, to }]);
  if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
  return apply(text, plan.changes);
};
const cutText = (text: string, part: string, last = part) =>
  cutOf(text, text.indexOf(part), text.indexOf(last, text.indexOf(part)) + last.length);
const body = (text: string) => text.slice(text.indexOf("K:C\n") + 4);

describe("the rests Delete leaves, merged by the beat or the bar (rule b)", () => {
  it("a bar cleared in one voice of two is one whole-bar rest", () => {
    const two = "X:1\nT:t\nM:4/4\nL:1/8\n%%score 1 2\nK:C\nV:1\nc2 d2 e2 f2|g8|]\nV:2\nC8|G8|]\n";
    expect(cutText(two, "c2 d2 e2 f2")).toContain("V:1\nz8|g8|]");
  });
  it("a triplet deleted whole is one rest of its real length", () => {
    expect(body(cutText(tune("(3efg e2 z2 z2|c8|]"), "efg"))).toBe("z2 e2 z2 z2|c8|]\n");
  });
  it("a broken pair deleted whole is one rest: never z>z", () => {
    expect(body(cutText(tune("G6 A>B|c8|]"), "A>B"))).toBe("G6 z2|c8|]\n");
  });
  it("by the beat: a half rest only from beat 1 or 3 of 4/4; 6/8 in threes", () => {
    expect(body(cutText(tune("C D E F|c4|]", "4/4", "1/4"), "C D"))).toBe("z2 E F|c4|]\n");
    expect(body(cutText(tune("C D E F|c4|]", "4/4", "1/4"), "D E F"))).toBe("C z z2|c4|]\n");
    expect(body(cutText(tune("dAF DFA|dAF DFA|]", "6/8"), "dAF"))).toBe("z3 DFA|dAF DFA|]\n");
  });
  it("never across a chord symbol", () => {
    expect(body(cutText(tune('z2 "C"A2 B2 c2|c8|]'), "A2"))).toBe('z2 "C"z2 B2 c2|c8|]\n');
  });
});

describe("rule (d): a voice of spacers keeps spacers", () => {
  it("a bar deleted in an x voice is x", () => {
    const text =
      "X:1\nT:t\nM:4/4\nL:1/8\n%%score 1 2\nK:C\nV:1\nc2 d2 e2 f2|g8|g8|]\nV:2\nx8|x8|C8|]\n";
    expect(cutText(text, "C8")).toContain("V:2\nx8|x8|x8|]");
  });
});

describe("the over-full rule and tuplets (item 7)", () => {
  it("a whole tuplet counts as one event of its real length and goes while the bar stays full", () => {
    expect(body(cutText(tune("(3efg e2 z z|c4|]", "4/4", "1/4"), "efg"))).toBe("e2 z z|c4|]\n");
  });
  it("a rest of the shortfall when the bar would otherwise be short", () => {
    expect(body(cutText(tune("(3efg e2 z|c4|]", "4/4", "1/4"), "efg"))).toBe("z e2 z|c4|]\n");
  });
  it("no double space left (item 8)", () => {
    const text = tune("A B C D E|c4|]", "4/4", "1/4");
    const at = text.indexOf("A B ") + 4;
    expect(body(cutOf(text, at, at + 1))).toBe("A B D E|c4|]\n");
  });
});

describe("overwrite writes what can be drawn, by the beat (rule c, item 4)", () => {
  const pasteOver = (text: string, part: string, clip: string) => {
    const from = text.indexOf(part);
    const plan = planPaste(text, [{ from, to: from + part.length }], 0, clip, null);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
    return { out: body(apply(text, plan.changes)), message: plan.message };
  };
  it("a note across the bar line in drawable values, tied; the rest of a note partly covered, a rest", () => {
    const { out } = pasteOver(tune("C2 D E F2 G2|A8|]"), "E F2", "c8");
    expect(out).toBe("C2 D c4- c-|c3 z z4|]\n");
  });
  it("6/8 in threes", () => {
    expect(pasteOver(tune("dAF DFA|dAF DFA|]", "6/8"), "d", "abcdef").out).toBe(
      "abc def|dAF DFA|]\n",
    );
  });
  it("notes after the copy's end stay (item 4)", () => {
    const { out, message } = pasteOver(tune("C2 D2 E2 F2|G8|]"), "D2", "e2");
    expect(out).toBe("C2 e2 E2 F2|G8|]\n");
    expect(message).not.toMatch(/rest/);
  });
});
