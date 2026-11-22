import { describe, expect, it } from "vitest";
import type { Change } from "../src/composer/commands";
import { placeMark } from "../src/composer/marks";

/*
 * The decoration menu over a selection puts each kind of mark where a musician expects it, as
 * MuseScore and Dorico do (round 5): not one on every note.
 */
const apply = (text: string, plan: ReturnType<typeof placeMark>) => {
  if ("refused" in plan) throw new Error(plan.refused);
  return [...plan.changes]
    .sort((a: Change, b: Change) => b.from - a.from)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
};
const count = (text: string, mark: string) => text.split(mark).length - 1;
const one = "X:1\nT:t\nM:4/4\nL:1/8\nK:G\nGABc dBAG|FGAB cAGF|EFGA BGFE|]\n";
const all = (text: string) => [{ from: text.indexOf("GABc"), to: text.indexOf("|]") }];
const two =
  "X:1\nT:t\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|\nV:2\nC D E F|G A B c|\n";
const both = (text: string) => [
  { from: text.indexOf("c d e f"), to: text.indexOf("c'|") + 2 },
  { from: text.indexOf("C D E F"), to: text.lastIndexOf("c|") + 1 },
];

describe("dynamics go on the first note of each voice", () => {
  it("one f over twelve notes, then a crescendo over them: one of each", () => {
    let text = apply(one, placeMark(one, all(one), "crescendo"));
    text = apply(text, placeMark(text, all(text), "f"));
    expect(count(text, "!f!")).toBe(1);
    expect(count(text, "!<(!")).toBe(1);
    expect(count(text, "!<)!")).toBe(1);
    expect(text).toContain("\n!<(!!f!GABc");
    expect(text).toContain("BGF!<)!E|]");
  });
  it("in each voice, once; another dynamic replaces it, the same takes it off", () => {
    const f = apply(two, placeMark(two, both(two), "f"));
    expect(f).toContain("V:1\n!f!c d e f");
    expect(f).toContain("V:2\n!f!C D E F");
    const p = apply(f, placeMark(f, both(f), "p"));
    expect(count(p, "!f!")).toBe(0);
    expect(count(p, "!p!")).toBe(2);
    const off = apply(p, placeMark(p, both(p), "p"));
    expect(count(off, "!p!")).toBe(0);
    expect(placeMark(two, both(two), "f")).toMatchObject({
      said: "f on the first note of each voice.",
    });
  });
});

describe("hairpins go from the first note to the last, per voice", () => {
  it("chosen again over the same notes, both ends come off", () => {
    const on = apply(one, placeMark(one, all(one), "diminuendo"));
    expect(count(on, "!>(!")).toBe(1);
    expect(count(on, "!>)!")).toBe(1);
    expect(apply(on, placeMark(on, all(on), "diminuendo"))).toBe(one);
    expect(placeMark(one, all(one), "crescendo")).toMatchObject({
      said: "Crescendo over 24 notes.",
    });
  });
  it("needs a stretch of notes", () => {
    const at = one.indexOf("GABc");
    expect(placeMark(one, [{ from: at, to: at }], "crescendo")).toMatchObject({
      refused: expect.stringMatching(/stretch of notes/),
    });
  });
});

describe("jumps go once, at the right end, in the top voice", () => {
  it("segno at the start, D.C. at the end, never on every note", () => {
    const segno = apply(two, placeMark(two, both(two), "segno"));
    expect(count(segno, "!segno!")).toBe(1);
    expect(segno).toContain("V:1\n!segno!c d e f");
    const dc = apply(two, placeMark(two, both(two), "D.C."));
    expect(count(dc, "!D.C.!")).toBe(1);
    expect(dc).toContain("b !D.C.!c'|");
    expect(apply(dc, placeMark(dc, both(dc), "D.C."))).toBe(two);
  });
});

describe("a fermata goes on the last note of each voice", () => {
  it("one per voice", () => {
    const out = apply(two, placeMark(two, both(two), "fermata"));
    expect(count(out, "!fermata!")).toBe(2);
    expect(out).toContain("b !fermata!c'|");
    expect(out).toContain("B !fermata!c|");
  });
});

describe("articulations go on every note, and toggle", () => {
  it("accents on all, off again, never doubled", () => {
    const on = apply(one, placeMark(one, all(one), "accent"));
    expect(count(on, "!accent!")).toBe(24);
    const again = apply(on, placeMark(on, all(on), "accent"));
    expect(again).toBe(one);
    const some = apply(
      one,
      placeMark(one, [{ from: one.indexOf("GABc"), to: one.indexOf("GABc") + 2 }], "."),
    );
    const more = apply(some, placeMark(some, all(some), "."));
    expect(count(more, ".")).toBe(24);
  });
});
