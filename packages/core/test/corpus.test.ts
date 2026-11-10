/**
 * Real books: chapters of public-domain stories, marked up by hand (corpus/README.md). Each reads
 * as reviewed, writes back byte for byte, formats without changing who says what, and takes every
 * edit on every stretch. A long story made of them reads in good time.
 *
 * `UPDATE_FIXTURES=1` writes each `*.spoken.txt` again, to review in the diff.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bookText,
  format,
  lines,
  parse,
  setDirection,
  setSpeaker,
  spokenScript,
  tokens,
  write,
} from "../src/index";
import { EDITS, brokenPromise, speeches } from "./voices";

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), "../../../corpus");
const books = readdirSync(corpus)
  .filter((name) => name.endsWith(".vxd"))
  .map((name) => ({ name, source: readFileSync(join(corpus, name), "utf8") }));

/** The warnings each book is expected to have, and why. */
const EXPECTED_WARNINGS: Record<string, string[]> = {
  // The Hatter's speech runs over three paragraphs, the novel way (spec §17, "Speech across paragraphs").
  "alice-mad-tea-party.vxd": ["115 unclosed-quote", "123 unclosed-quote"],
  "scandal-in-bohemia-1.vxd": [],
};

const who = (source: string) =>
  lines(parse(source)).map((row) => [row.kind, row.speaker, row.direction, row.text]);

describe("real books", () => {
  it("are all here, and each has its expected warnings", () => {
    expect(books.map((book) => book.name).sort()).toEqual(Object.keys(EXPECTED_WARNINGS).sort());
    for (const { name, source } of books) {
      const found = parse(source).warnings.map((warning) => `${warning.line} ${warning.code}`);
      expect(found, name).toEqual(EXPECTED_WARNINGS[name]);
    }
  });

  for (const { name, source } of books) {
    describe(name, () => {
      const story = parse(source);

      it("is heard as reviewed", () => {
        const file = join(corpus, name.replace(/\.vxd$/, ".spoken.txt"));
        const spoken = `${spokenScript(story)}\n`;
        if (process.env.UPDATE_FIXTURES) writeFileSync(file, spoken);
        expect(spoken).toBe(readFileSync(file, "utf8"));
        bookText(story);
        tokens(story);
      });

      it("writes back byte for byte", () => {
        expect(write(story)).toBe(source);
      });

      it("formats without changing who says what, and settles after one run", () => {
        for (const options of [{}, { quotes: "curly" as const }]) {
          const once = format(source, options);
          expect(format(once, options)).toBe(once);
          expect(who(once)).toEqual(who(source));
        }
      });

      it("takes a new speaker and a new direction on every stretch, changing nothing else", () => {
        for (const target of speeches(story)) {
          const speaker = setSpeaker(story, target, "Zed");
          expect(speaker.length, target.text).toBeGreaterThan(0);
          expect(
            brokenPromise(story, target, speaker, EDITS.speaker.inside, EDITS.speaker.some),
          ).toBe(null);
          const direction = setDirection(story, target, "softly");
          expect(direction.length, target.text).toBeGreaterThan(0);
          expect(brokenPromise(story, target, direction, EDITS.direction.inside)).toBe(null);
        }
      }, 60_000);
    });
  }

  it("reads a long story in good time", () => {
    // About 100,000 words: every book over and over, as one file.
    const bodies = books.map(({ source }) => source.slice(source.indexOf("\n---\n", 4) + 5));
    const long = Array.from({ length: 18 }, () => bodies.join("\n\n")).join("\n\n");
    const words = long.split(/\s+/).length;
    expect(words).toBeGreaterThan(90_000);
    const time = (work: () => unknown) => {
      const start = performance.now();
      work();
      return performance.now() - start;
    };
    const story = parse(long);
    // Generous limits, for slow machines: a laptop is several times faster.
    expect(time(() => parse(long))).toBeLessThan(3000);
    expect(time(() => lines(story))).toBeLessThan(3000);
    expect(time(() => tokens(story))).toBeLessThan(3000);
    expect(time(() => format(long))).toBeLessThan(10_000);
  }, 60_000);
});
