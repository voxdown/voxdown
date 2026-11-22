import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { frac } from "../src/composer/abc";
import { checkBars } from "../src/composer/barcheck";
import {
  cutPlan,
  duplicate,
  lengthPartners,
  lengthsInStep,
  newVoice,
  samePoint,
  tuneTokens,
} from "../src/composer/barwise";
import { type Change, markSelection, musicParts, scaleLengths } from "../src/composer/commands";
import { planPaste } from "../src/composer/paste";
import { indexFile } from "../src/composer/tunes";
import { played } from "./composer-played";

/* Round 10 (selection hardening, final): Claude's evening of real work, and Codex's fuzzing. */

const apply = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/composer/${name}.abc`, import.meta.url), "utf8");
const bars = (text: string) => {
  const file = indexFile(text);
  return checkBars(text, file.tunes[0] as never, file).map((issue) => issue.message);
};
const ASHPLANT =
  'X:1\nT:The Ashplant\nM:6/8\nL:1/8\nK:D\nA|:"D"dAF DFA|"G"BGB "A"AFA|"D"dAF DFA|1"Em"GBE "A"FEA:|2"Em"GBE "A"FED||\n|:"D"faf "A"gec|"D"dfa "G"bag|"D"faf "Bm"dcB|1"Em"GBE "A"FED:|2"Em"GBE "A"FE|]\n';

describe("Insert › Second voice copies its pair's structure (item 1)", () => {
  const scores: Record<string, string> = {
    ashplant: ASHPLANT,
    trio: fixture("trio"),
    piano: fixture("piano"),
    song: fixture("song"),
    ragged: fixture("ragged"),
    four: fixture("conformance/custom-four"),
    endings: fixture("conformance/repeats-endings"),
    meters: fixture("conformance/meters"),
    duet: fixture("conformance/custom-duet"),
  };
  for (const [name, text] of Object.entries(scores))
    it(`${name}: in step, its bar lines, repeats and endings as its pair's`, () => {
      const file = indexFile(text);
      const made = newVoice(text, file.tunes[0]?.bodyFrom ?? 0, file);
      if (!made) throw new Error("no voice");
      const after = apply(text, made.changes);
      expect(
        bars(after).filter((issue) => !bars(text).includes(issue)),
        after,
      ).toEqual([]);
      const afterFile = indexFile(after);
      const ids = afterFile.tunes[0]?.voices.map((voice) => voice.id) ?? [];
      const newest = ids.at(-1) as string;
      const pair = ids[0] as string;
      const barLines = (voice: string) =>
        tuneTokens(after, afterFile, afterFile.tunes[0]?.bodyFrom ?? 0)
          .filter((each) => each.voice === voice && each.token.kind === "bar")
          .map((each) => each.token.text);
      expect(barLines(newest)).toEqual(barLines(pair));
    });
});

describe("a voiced paste at a bar's start goes before another voice's (3 or ( (item 2)", () => {
  it("V:2's part goes in before its bar's tuplet sign, not inside it", () => {
    const text =
      "X:1\nT:t\nM:4/4\nL:1/8\n%%score (1 2)\nK:C\nV:1\nC2 D2 E2 F2 | G8 |]\nV:2\nC4 E4 | (3GAB c2 d4 |]\n";
    const from = text.indexOf("G8");
    const plan = planPaste(text, [{ from, to: from + 2 }], 0, "V:1\nc8 |\nV:2\nC,8 |\n", null);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
    const after = apply(text, plan.changes);
    expect(after).toContain("V:1\nC2 D2 E2 F2 | c8 | G8 |]");
    expect(after).toContain("V:2\nC4 E4 | C,8 | (3GAB c2 d4 |]");
    expect(samePoint(text, indexFile(text), from, "2")).toBe(text.indexOf("(3GAB"));
  });
});

describe("Copy and Cut of a whole repeat with endings carry its |: (item 3)", () => {
  const head = "X:1\nT:Set\nM:6/8\nL:1/8\nK:D\n";
  const A = "|:dAF DFA|BGB AFA|1 GBE FEA:|2 GBE FED||\n";
  const B = "|:faf gec|dfa bag|1 gBE FED:|2 gBE FEA|]\n";
  const tune = head + A + B;
  const pitches = (text: string) => played(text, null).map((note) => note.pitch);
  const move = (from: number, to: number, place: (after: string) => number) => {
    const cut = cutPlan(tune, [{ from, to }]);
    if (!cut || "refused" in cut) throw new Error("no cut");
    expect(cut.clip.startsWith("|:")).toBe(true);
    const after = apply(tune, cut.changes);
    const at = place(after);
    const plan = planPaste(after, [{ from: at, to: at }], 0, cut.clip, null);
    if (plan && "refused" in plan) throw new Error(plan.refused);
    return plan ? apply(after, plan.changes) : `${after.slice(0, at)}${cut.clip}${after.slice(at)}`;
  };
  it("A after B plays B, then A, endings and all", () => {
    const out = move(
      tune.indexOf("dAF"),
      tune.indexOf("FED||") + 3,
      (after) => after.lastIndexOf("FEA") + 3,
    );
    expect(pitches(out)).toEqual(pitches(head + B.replace("|]", "||") + A.replace("||", "|]")));
  });
  it("B before A plays B, then A", () => {
    const out = move(tune.indexOf("faf"), tune.lastIndexOf("FEA") + 3, (after) =>
      after.indexOf("|:dAF"),
    );
    expect(pitches(out)).toEqual(pitches(head + B.replace("|]", "||") + A.replace("||", "|]")));
  });
});

/* Codex's h10 fuzz findings, minimised (f1–f8), as regression tests. */
const review = (body: string) => `X:1\nT:Review\nM:4/4\nL:1/8\nK:C\n${body}\n`;
const at = (text: string, part: string, nth = 0) => {
  let from = text.indexOf(part);
  for (let n = 0; n < nth; n++) from = text.indexOf(part, from + 1);
  return { from, to: from + part.length };
};
/** What abcjs gives each note (not rest) in each verse: [pitch, syllables…]. */
function sung(text: string): string[] {
  const tune = (abcjs as never as { parseOnly: (t: string) => Any[] }).parseOnly(text)[0];
  const out: string[] = [];
  for (const line of tune.lines ?? [])
    for (const staff of line.staff ?? [])
      for (const voice of staff.voices ?? [])
        for (const element of voice)
          if (element.el_type === "note" && !element.rest)
            out.push(
              `${element.pitches?.[0]?.name}:${(element.lyric ?? []).map((each: Any) => each.syllable).join("/")}`,
            );
  return out;
}
/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;
const cutParts = (text: string, ranges: { from: number; to: number }[]) => {
  const plan = cutPlan(text, musicParts(text, ranges, indexFile(text)));
  if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
  return apply(text, plan.changes);
};

describe("Codex's h10 fixtures, as regression tests", () => {
  it("f1: Ctrl+X across standalone V: lines keeps every voice's structure", () => {
    const text =
      "X:1\nT:Cross voice\nM:4/4\nL:1/8\n%%score 1 2\nK:C\nV:1\nC8 | D8 |]\nV:2\nE8 | F8 |]\n";
    const out = cutParts(text, [{ from: text.indexOf("D8"), to: text.indexOf("E8") + 2 }]);
    expect(out).toContain("V:1\nC8 | z8 |]\nV:2\nz8 | F8 |]");
    expect(bars(out)).toEqual([]);
  });
  it("f2: a two-voice copy over a place in each voice overwrites in time", () => {
    const text = review(
      "%%score (1 2) 3\nV:1\nC2 D2 E2 F2 | G8 |]\nV:2\nC4 E4 | G8 |]\nV:3\nC,8 | D,8 |]",
    );
    const plan = planPaste(
      text,
      [at(text, "C2 D2 E2 F2"), at(text, "C4 E4")],
      0,
      "V:1\nA2 B2 c2 d2 | e2 f2\nV:2\nA4 B4 | c4\n",
      null,
    );
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
    const out = apply(text, plan.changes);
    expect(bars(out)).toEqual([]);
    expect(out).toContain("V:3\nC,8 | D,8 |]");
  });
  it("f3: a dynamic carried past a bar cut goes after the next bar's field", () => {
    const text = review("C8 | !mf!A8 | [L:1/4]C D E F | G4 |]");
    expect(cutParts(text, [at(text, "!mf!A8")])).toContain("C8 | [L:1/4]!mf!C D E F | G4 |]");
  });
  it("f4: slurs across interleaved blocks go with the bars", () => {
    const text = review("%%score 1 2\nV:1\n(C8 |\nV:2\nE8 |\nV:1\nD8) | E8 |]\nV:2\nF8 | G8 |]");
    const out = cutParts(text, [at(text, "C8"), at(text, "E8"), at(text, "D8"), at(text, "F8")]);
    expect(out).not.toMatch(/\(|\)/);
    expect(out).toMatch(/V:1\n[^\n]*E8 \|\]/);
  });
  it("f5: ½× keeps each syllable on its note, * included, in every verse", () => {
    const text = review("C2 D2 E2 F2 | G8 |]\nw: one * three four five\nw: un * trois quatre cinq");
    const range = lengthPartners(text, [at(text, "C2")]);
    const plan = lengthsInStep(
      text,
      indexFile(text),
      scaleLengths(text, range, frac(1, 2)),
      0.5,
      "Halve",
    );
    if (!plan || "refused" in plan) throw new Error("no plan");
    const out = apply(text, plan.changes);
    expect(sung(out)).toEqual(sung(text));
  });
  it("f6: Duplicate then Delete leaves the voices in step", () => {
    const text = review("%%score 1 2\nV:1\nC2 D2 E2 F2 | G8 |]\nV:2\nA2 B2 c2 d2 | e8 |]");
    const dup = duplicate(text, [at(text, "D2")]);
    if ("refused" in dup) throw new Error(dup.refused);
    const doubled = apply(text, dup.changes);
    const from = doubled.indexOf("D2 D2") + 3;
    const out = cutParts(doubled, [{ from, to: from + 2 }]);
    expect(bars(out).filter((issue) => /out of step/.test(issue))).toEqual([]);
  });
  it("f7: ½× on a 3:2:4 tuplet is refused rather than written in rests that can't be drawn", () => {
    const text = review("(3:2:4CDEF (3:2:4GABc (3:2:4defg |]");
    const range = lengthPartners(text, [at(text, "CDEF")]);
    expect(
      lengthsInStep(text, indexFile(text), scaleLengths(text, range, frac(1, 2)), 0.5, "Halve"),
    ).toMatchObject({ refused: expect.stringMatching(/can't be written/) });
  });
  it("f8: Duplicate of a tuplet's note puts its syllables where its copy goes", () => {
    const text = review(
      "(3CDE F2 G2 A2 |]\nw: one two three four five six\nw: un deux trois quatre cinq six",
    );
    const dup = duplicate(text, [{ from: text.indexOf("CDE"), to: text.indexOf("CDE") + 1 }]);
    if ("refused" in dup) throw new Error(dup.refused);
    const out = apply(text, dup.changes);
    const sang = sung(out);
    const index = sang.findIndex((each) => each.startsWith("F:"));
    expect(sang[index - 1]).toMatch(/^C:one\/un$/);
    expect(sang[index]).toBe("F:four/quatre");
  });
});

describe("what the seeded fuzz check found", () => {
  it("a cut leaves a hairpin over spacers and a note as a bar of rest, not nothing", () => {
    // (Moonlight, seed −1641564876: the rest's planner and the hairpin's both took out `!>(!`, and
    // the second took the rest after it.)
    const text =
      "X:1\nM:C\nL:1/8\nV:1\nV:2\nV:3\nK:C\nV:1\nabcdefga | abcdefga | abcdefga |\nV:2\nx6 B2 | !<(!!<)!x8 | !>(!x6 !>)!B2 |\nV:3\nC8 | D8 | E8 |\n";
    const from = text.indexOf("abcdefga");
    const out = cutParts(text, [{ from, to: text.indexOf("C8") + 2 }]);
    expect(out).toContain("V:1\nz8 | z8 |\nV:2\n!<(!!<)!x8 | x8 |\nV:3\nD8 | E8 |");
    expect(bars(out)).toEqual([]);
  });
});

const pasted = (text: string, ranges: { from: number; to: number }[], clip: string) => {
  const plan = planPaste(text, ranges, 0, clip, null, indexFile(text));
  if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
  return { out: apply(text, plan.changes), message: plan.message };
};
const TWO =
  "X:1\nT:t\nM:4/4\nL:1/8\n%%score {1 2}\nV:1\nV:2 clef=bass\nK:C\nV:1\nCDEF GABc | cBAG FEDC | E4 F4 | G8 |]\nV:2\nC,8 | D,8 | C,4 D,4 | G,8 |]\n";
const VOICED = "V:1\nCDEF GABc |\nV:2 clef=bass\nC,8 |\n";
const caretAt = (text: string, part: string) => {
  const at = text.indexOf(part);
  return { from: at, to: at };
};

describe("pasting into several places (item 12)", () => {
  it("a copy of both voices over a note in each: no empty bar, the voices in step", () => {
    const { out } = pasted(TWO, [at(TWO, "E4"), at(TWO, "C,4")], VOICED);
    expect(out).not.toMatch(/\|\s*\|/);
    expect(out).toContain("V:1\nCDEF GABc | cBAG FEDC | CDEF GABc | E4 F4 | G8 |]");
    expect(out).toContain("V:2\nC,8 | D,8 | C,8 | C,4 D,4 | G,8 |]");
    expect(bars(out)).toEqual([]);
  });
  it("carets in each voice take each voice's part", () => {
    const { out, message } = pasted(TWO, [caretAt(TWO, "E4"), caretAt(TWO, "C,4")], VOICED);
    expect(out).toContain("V:2\nC,8 | D,8 | C,8 | C,4 D,4 | G,8 |]");
    expect(message).toMatch(/V:1 and V:2/);
  });
  it("carets in one voice of two: the first place, the other voices in step", () => {
    const { out, message } = pasted(
      TWO,
      [caretAt(TWO, "| E4"), caretAt(TWO, "| G8")],
      "CDEF GABc |",
    );
    expect(message).toMatch(/first of the 2 places/);
    expect(bars(out)).toEqual([]);
  });
  it("carets in a tune of one voice: the copy at each, fitted to its bar lines", () => {
    const one = "X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc | cBAG FEDC | E4 F4 | G8 |]\n";
    const { out } = pasted(one, [caretAt(one, " | E4"), caretAt(one, " | G8")], "CDEF GABc |");
    expect(out).toContain("cBAG FEDC | CDEF GABc | E4 F4 | CDEF GABc | G8 |]");
  });
});

describe("a copy of several staves pasted at a bar's start pastes every part (item 14)", () => {
  it("clicked in the treble, the bass takes its part at the same point", () => {
    const { out, message } = pasted(TWO, [at(TWO, "E4")], VOICED);
    expect(out).toContain("V:2\nC,8 | D,8 | C,8 | C,4 D,4 | G,8 |]");
    expect(message).toBe("Pasted V:1 and V:2 as a whole bar here, in step.");
  });
  it("clicked in the bass, the same", () => {
    const { out, message } = pasted(TWO, [at(TWO, "C,4")], VOICED);
    expect(out).toContain("V:1\nCDEF GABc | cBAG FEDC | CDEF GABc | E4 F4 | G8 |]");
    expect(message).toMatch(/^Pasted V:1 and V:2 /);
  });
});

describe("typed > over notes of unequal length (item 15)", () => {
  const text = "X:1\nM:4/4\nL:1/8\nK:C\nC2 D E2 F2 G A | c8 |]\n";
  const range = { from: text.indexOf("C2"), to: text.indexOf("G A") + 3 };
  it("leaves those pairs and says so", () => {
    const result = markSelection(text, [range], ">", indexFile(text), () => undefined);
    expect(result?.skipped).toBe(1);
    expect(apply(text, result?.changes ?? [])).toContain("C2 D E2>F2 G>A");
  });
  it("refuses when every pair is uneven", () => {
    const one = { from: text.indexOf("C2"), to: text.indexOf("D") + 1 };
    const result = markSelection(text, [one], ">", indexFile(text), () => undefined);
    expect(result?.changes).toEqual([]);
    expect(result?.reason).toMatch(/same length/);
  });
});

describe("paste says what it did, and keeps the groups as written (item 17)", () => {
  const one = "X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc | cBAG FEDC | E4 F4 | G8 |]\n";
  it("whole bars on a note starting its bar: in before it, said", () => {
    const { out, message } = pasted(one, [at(one, "E4")], "CDEF GABc |");
    expect(out).toContain("cBAG FEDC | CDEF GABc | E4 F4");
    expect(message).toMatch(/before the selected note's bar/);
  });
  it("the same lengths over notes: their groups stay as they were", () => {
    expect(pasted(one, [at(one, "cBAG FEDC")], "CDEF GABc").out).toContain(
      "CDEF GABc | CDEF GABc | E4 F4",
    );
    expect(pasted(one, [at(one, "BAG")], "CDE").out).toContain("| cCDE FEDC |");
    // (Other lengths: by the beat.)
    expect(pasted(one, [at(one, "E4 F4")], "CDEF GABc").out).toContain("| CD EF GA Bc |");
  });
});
