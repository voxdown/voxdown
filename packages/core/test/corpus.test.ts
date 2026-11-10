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
  // The Hatter's speech stops for his song and goes on after it with no opening mark (spec §17,
  // "A speech broken by a song").
  "alice-mad-tea-party.vxd": ["115 unclosed-quote", "123 unclosed-quote"],
  "scandal-in-bohemia-1.vxd": [],
  "bremer-stadtmusikanten.vxd": [],
  // The Gull's song runs over four lines (§5.7): fine for verse, so the warning only asks.
  "the-keeper-and-the-gull.vxd": ["46 quote-over-line-break"],
};

/** Who says what, and how: the words as heard, whatever their quotation marks and apostrophes. */
const who = (source: string) =>
  lines(parse(source)).map((row) => [
    row.kind,
    row.speaker,
    row.direction,
    row.text.replace(/["'“”‘’„‚«»‹›]/g, "'"),
  ]);

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

      it("is heard and printed as reviewed", () => {
        for (const [ending, made] of [
          [".spoken.txt", spokenScript(story)],
          [".book.txt", bookText(story)],
        ] as const) {
          const file = join(corpus, name.replace(/\.vxd$/, ending));
          if (process.env.UPDATE_FIXTURES) writeFileSync(file, `${made}\n`);
          expect(`${made}\n`, ending).toBe(readFileSync(file, "utf8"));
        }
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
          // A stretch said softly already has nothing to change.
          if (target.direction !== "softly")
            expect(direction.length, target.text).toBeGreaterThan(0);
          expect(brokenPromise(story, target, direction, EDITS.direction.inside)).toBe(null);
        }
      }, 60_000);
    });
  }

  it("reads a long story in good time", () => {
    // About 100,000 words: every book over and over, as one file.
    const bodies = books
      .map(({ source }) => source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""))
      .join("\n\n");
    const times = Math.ceil(100_000 / bodies.split(/\s+/).length);
    const long = Array.from({ length: times }, () => bodies).join("\n\n");
    const words = long.split(/\s+/).length;
    expect(words).toBeGreaterThan(100_000);
    expect(words).toBeLessThan(120_000);
    const time = (work: () => unknown) => {
      const start = performance.now();
      work();
      return performance.now() - start;
    };
    const story = parse(long);
    // About ten times what a laptop takes (parse 50 ms, format 300 ms, an edit 250 ms), for slow
    // machines: a step that turns quadratic still fails.
    expect(time(() => parse(long))).toBeLessThan(750);
    expect(time(() => lines(story))).toBeLessThan(500);
    expect(time(() => tokens(story))).toBeLessThan(500);
    expect(time(() => write(story))).toBeLessThan(750);
    expect(time(() => format(long, { quotes: "curly" }))).toBeLessThan(4000);
    const said = speeches(story);
    const middle = said[Math.floor(said.length / 2)] as (typeof said)[number];
    expect(time(() => setSpeaker(story, middle, "Zed"))).toBeLessThan(3000);
  }, 60_000);

  it("reads lines built to be slow in good time", () => {
    // Each was quadratic once: an opening mark searched the rest of its line for its closing one.
    const worst = ["[", "@(", "{", "![", "[x](", " 'a", "“", '"a ', "%% a ", "@Gerald ", "\\"].map(
      (piece) => piece.repeat(Math.ceil(100_000 / piece.length)),
    );
    for (const line of worst) {
      const start = performance.now();
      format(line, { quotes: "curly" });
      expect(performance.now() - start, JSON.stringify(line.slice(0, 8))).toBeLessThan(2000);
    }
  }, 60_000);
});
