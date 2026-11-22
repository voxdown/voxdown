import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { newVoice, tuneTokens } from "../src/composer/barwise";
import type { Change } from "../src/composer/commands";
import { indexFile } from "../src/composer/tunes";

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
