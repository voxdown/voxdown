import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { copyText, cutPlan, overBarLine } from "../src/composer/barwise";
import { type Change, musicParts } from "../src/composer/commands";
import { checkLyrics } from "../src/composer/lyriccheck";
import { planPaste, sourceAt } from "../src/composer/paste";
import { keyHere, toKey } from "../src/composer/transpose-key";
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

describe("a copy longer than the notes it's pasted over (finding 1)", () => {
  const trio =
    "X:1\nT:t\nM:3/4\nL:1/8\n%%score 1 2\nK:F\nV:1\nc4 f2|e4 g2|f2 a2 c'2|\nV:2\nA4 c2|c4 e2|c2 f2 a2|\n";
  it("overwrites forward from the first note, tied over the bar line, the other voice untouched", () => {
    const at = trio.indexOf("A4 c2") + 3;
    const plan = planPaste(trio, [{ from: at, to: at + 2 }], 0, "f4 g2|", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    const after = apply(trio, plan.changes);
    expect(after).toContain("V:2\nA4 f2-|f2 g2 z2|c2 f2 a2|");
    expect(after).toContain("V:1\nc4 f2|e4 g2|f2 a2 c'2|");
    expect(plan.message).toMatch(
      /from its first note in V:2; it ran on over 2 more notes, replaced; rests fill the rest of the last bar; the other voices are as they were/,
    );
  });
  it("across a repeat sign or an ending, refused, saying why", () => {
    const tune = "X:1\nT:t\nM:3/4\nL:1/4\nK:C\n|:C D E:|F G A|]\n";
    const at = tune.indexOf("E");
    expect(planPaste(tune, [{ from: at, to: at + 1 }], 0, "c d e|", null)).toMatchObject({
      refused: expect.stringMatching(/across a repeat sign or an ending/),
    });
  });
  it("past the voice's end, refused, saying why", () => {
    const tune = "X:1\nT:t\nM:3/4\nL:1/4\nK:C\nC D E|F G A|]\n";
    const at = tune.indexOf("A|]");
    expect(planPaste(tune, [{ from: at, to: at + 1 }], 0, "c d e|", null)).toMatchObject({
      refused: expect.stringMatching(/past the end of the voice/),
    });
  });
});

describe("a two-voice copy pasted on a clicked note of a shared staff (finding 5, Codex 2)", () => {
  const duet =
    'X:1\nT:Fiddle Duet\nM:2/4\nL:1/8\nK:D\n%%score (1 2)\nV:1 name="Fiddle 1"\nV:2 name="Fiddle 2"\n[V:1] d2 fd | ed cB | A2 FA | d4 :|\n[V:2] F2 AF | GF ED | C2 DC | D4 :|\n';
  const clip = "V:1\ned cB |\nV:2\nGF ED |\n";
  it("with %%score after K:, both voices, in step", () => {
    const at = duet.indexOf("d4 :|");
    const plan = planPaste(duet, [{ from: at, to: at + 2 }], 0, clip, null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    const after = apply(duet, plan.changes);
    expect(after).toContain("[V:1] d2 fd | ed cB | A2 FA | ed cB |d4 :|");
    expect(after).toContain("[V:2] F2 AF | GF ED | C2 DC | GF ED |D4 :|");
    expect(plan.message).toMatch(/V:2's on the same staff/);
  });
  it("without %%score, as the score draws the staves", () => {
    const plain = duet.replace("%%score (1 2)\n", "");
    const at = plain.indexOf("FA |") + 1;
    const staves = () => ["1", "2"];
    const plan = planPaste(plain, [{ from: at, to: at + 1 }], 0, clip, null, undefined, staves);
    if (!plan || "refused" in plan) throw new Error("no plan");
    const after = apply(plain, plan.changes);
    expect(after).toContain("| A2 FA | ed cB | d4 :|");
    expect(after).toContain("| C2 DC | GF ED | D4 :|");
  });
});

describe("a bar line typed at the end of a second voice's filled bar (finding 6)", () => {
  const text = "X:1\nT:t\nM:3/4\nL:1/4\nK:C\nV:2\nF2 A | z3 | z3 |]\n";
  const bars = [text.indexOf("| z3"), text.indexOf("| z3 |]") + 5];
  it("moves over the bar line there, after its space", () => {
    expect(overBarLine(text, text.indexOf(" | z3"), bars)).toBe(text.indexOf("z3"));
    expect(overBarLine(text, text.indexOf(" | z3") + 1, bars)).toBe(text.indexOf("z3"));
  });
  it("is typed where notes are left before the bar line, or the bar line isn't a placeholder's", () => {
    expect(overBarLine(text, text.indexOf("A |"), bars)).toBeNull();
    expect(overBarLine(text, text.indexOf(" | z3"), [])).toBeNull();
  });
});

describe("a copy of several lines pasted into a line with verses (finding 3)", () => {
  const song = readFileSync(new URL("./fixtures/composer/song.abc", import.meta.url), "utf8");
  const file = indexFile(song);
  const chorus = song.indexOf('"C"e2', song.indexOf("P:B"));
  const clip = copyText(song, { from: chorus, to: song.lastIndexOf("z2|]") + 2 }, file);
  const lyricIssues = (text: string) =>
    indexFile(text).tunes.flatMap((tune) => checkLyrics(text, tune)).length;
  const lines = (text: string) => text.split("\n").length;
  for (const [label, at] of [
    ["after the final |]", song.indexOf("z2|]\nw:Ev") + 4],
    ["at a caret in the first bar", song.indexOf('"G"G2 GA ') + 9],
  ] as const)
    it(`${label}: one music line, each verse its syllables`, () => {
      expect(clip).toMatch(/\nw:Oh, the lan-tern/);
      const plan = planPaste(song, [{ from: at, to: at }], 0, clip, sourceAt(song, file, chorus));
      if (!plan || "refused" in plan) throw new Error("no plan");
      const after = apply(song, plan.changes);
      expect(lines(after)).toBe(lines(song));
      expect(lyricIssues(after)).toBeLessThanOrEqual(lyricIssues(song));
      // The copy's own syllables in the first verse, a `*` a note in the others.
      expect(after).toMatch(/Oh, the lan- tern, oh, the light,/);
      expect(plan.message).toMatch(/lines went in as one/);
    });
});

describe("Transpose to key… on a section after a key change (finding 8)", () => {
  const tune =
    'X:1\nT:Key change test\nM:6/8\nL:1/8\nK:G\n|:"G"GBd gdB|"D"AFD DEF:|\n[K:D]|:"D"faf "A"gec|"D"dfa "G"bag|"D"faf "Bm"dcB|"A"ABc "D"d3:|\n';
  const section = [{ from: tune.indexOf('"D"faf'), to: tune.lastIndexOf("d3") + 2 }];
  it("the dialog starts from the key in force there, and the interval is from it", () => {
    expect(keyHere(tune, section)).toBe("D");
    expect(keyHere(tune, [{ from: 0, to: 0 }])).toBe("G");
    const plan = toKey(tune, section, "E");
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.said).toMatch(/2 semitones up/);
    const after = apply(tune, plan.changes);
    // (The key signature stays D: the new key's sharps are written.)
    expect(after).toContain('[K:D]|:"E"^gbg "B"af^d|');
  });
});
