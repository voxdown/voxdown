import { describe, expect, it } from "vitest";
import { cutPlan } from "../src/composer/barwise";
import { type Change, musicParts } from "../src/composer/commands";
import { indexFile } from "../src/composer/tunes";
import { played } from "./composer-played";

/* Round 7 (selection hardening): what a musician expects, from the regression replay. */

const apply = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
const cut = (text: string, from: number, to: number) => {
  const plan = cutPlan(text, musicParts(text, [{ from, to }], indexFile(text)));
  if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
  return { after: apply(text, plan.changes), said: plan.said.join(" ") };
};
const pitches = (text: string) => played(text, null).map((note) => note.pitch);

describe("an over-full bar loses time while it stays its length", () => {
  const tune = "X:1\nT:O\nM:6/8\nL:1/8\nK:D\n|:dAFF DFA|dAF DFA:|\n";
  it("the extra F simply goes", () => {
    const at = tune.indexOf("FF") + 1;
    expect(cut(tune, at, at + 1).after).toBe("X:1\nT:O\nM:6/8\nL:1/8\nK:D\n|:dAF DFA|dAF DFA:|\n");
  });
  it("any shortfall becomes a rest", () => {
    const at = tune.indexOf("FF");
    expect(cut(tune, at, at + 2).after).toContain("|:dAz DFA|");
  });
  it("elsewhere part of a bar is still rests", () => {
    const at = tune.indexOf("dAF ");
    expect(cut(tune, at, at + 2).after).toContain("|z2F DFA:|");
  });
});

describe("a repeat's body with its 1st ending (Codex 4)", () => {
  const sr = "X:1\nT:SR\nM:6/8\nL:1/8\nK:G\nGAG GAB|:E3 B3|EBE AFD|1 G3 FGA:|2 BAG FE2|d3 d3|]\n";
  for (const end of [sr.indexOf("FGA") + 3, sr.indexOf("FGA:|") + 5])
    it(`all of the body: the repeat goes, the 2nd ending plays once (${JSON.stringify(sr.slice(end - 3, end))})`, () => {
      const { after, said } = cut(sr, sr.indexOf("E3 B3"), end);
      expect(after).toBe("X:1\nT:SR\nM:6/8\nL:1/8\nK:G\nGAG GAB| BAG FE2|d3 d3|]\n");
      expect(said).toMatch(/2nd ending's bars now play once/);
      expect(pitches(after)).toEqual(pitches("X:1\nM:6/8\nL:1/8\nK:G\nGAG GAB|BAG FE2|d3 d3|]\n"));
    });
  const morrison =
    "X:3\nT:Morrison's\nM:6/8\nL:1/8\nK:Edor\n|:E3 B3|EBE AFD|EDE B3|dcB AFD|\nE3 B3|EBE AFD|G3 FGA|1 BAG FED:|2 BAG FE2||\n";
  it("part of the body: the repeat stays, the 2nd ending's bars follow it", () => {
    const from = morrison.indexOf("\nE3 B3") + 1;
    const { after, said } = cut(morrison, from, morrison.indexOf("FED") + 3);
    expect(after).toBe(
      "X:3\nT:Morrison's\nM:6/8\nL:1/8\nK:Edor\n|:E3 B3|EBE AFD|EDE B3|dcB AFD:|\nBAG FE2||\n",
    );
    expect(said).toMatch(/after the repeat/);
    const body = "E3 B3|EBE AFD|EDE B3|dcB AFD|";
    expect(pitches(after)).toEqual(pitches(`X:1\nM:6/8\nL:1/8\nK:Edor\n${body}${body}BAG FE2||\n`));
  });
  it("all of Morrison's body: no bar line left alone at the start", () => {
    const { after } = cut(morrison, morrison.indexOf("E3 B3"), morrison.indexOf("FED") + 3);
    expect(after).toBe("X:3\nT:Morrison's\nM:6/8\nL:1/8\nK:Edor\nBAG FE2||\n");
  });
  it("a note's length 3 isn't a 3rd ending", () => {
    const one = "X:1\nT:t\nM:6/8\nL:1/8\nK:G\n|:E3 B3|1 G3 FGA:|2 BAG FE2|d3 d3|]\n";
    expect(() => cut(one, one.indexOf("E3"), one.indexOf("FGA") + 3)).not.toThrow();
  });
});
