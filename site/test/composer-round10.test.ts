import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { cutPlan, newVoice, samePoint, tuneTokens } from "../src/composer/barwise";
import type { Change } from "../src/composer/commands";
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
