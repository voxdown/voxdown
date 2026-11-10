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
import { heardIndex, heardItem } from "../src/edit";
import {
  type TextChange,
  applyChanges,
  bookText,
  format,
  insertSound,
  lines,
  parse,
  setDirection,
  setMeta,
  setSpeaker,
  spokenScript,
  tokens,
  write,
} from "../src/index";
import { EDITS, allItems, brokenPromise, speeches } from "./voices";

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
  "the-last-lamp.vxd": [],
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

      it.each([
        ["in order", false],
        ["paragraph by paragraph from the end", true],
      ])(
        "marks up again from bare text, %s: with its marks taken off, edits give every stretch back",
        (_, backwards) => {
          // An author's work, done with the edits: take off every mark that stands before a quote,
          // then give each stretch its speaker and direction again, in order or from the last
          // paragraph to the first (so a speech over paragraphs is given from its last one, §5.7).
          // The book must read as reviewed, line for line (an oracle the edits' own checks don't
          // share). Within a paragraph the stretches go in order: given from the end, a quote's
          // words after a sound would be given apart from it, and the sound would stay as it was.
          const bare: TextChange[] = [];
          for (const item of allItems(story)) {
            if (item.kind !== "speech" || !item.mark || !item.openQuote) continue;
            const { mark, openQuote } = item;
            const between = source.slice(mark.range.to, openQuote.from);
            if (/^\s*$/.test(between) && !bare.some((change) => change.from === mark.range.from)) {
              bare.push({ from: mark.range.from, to: openQuote.from, insert: "" });
            }
          }
          expect(bare.length).toBeGreaterThan(10);
          let text = applyChanges(source, bare);
          const blocks = story.blocks.map((block) =>
            speeches({ ...story, blocks: [block] } as typeof story),
          );
          for (const stretch of (backwards ? blocks.reverse() : blocks).flat()) {
            const at = heardIndex(story, stretch);
            let current = parse(text);
            let item = heardItem(current, at);
            if (item?.kind !== "speech") continue;
            if (item.speaker !== stretch.speaker) {
              const changes = setSpeaker(current, item, stretch.speaker);
              expect(changes.length, `give “${item.text}” to ${stretch.speaker}`).toBeGreaterThan(
                0,
              );
              text = applyChanges(text, changes);
              current = parse(text);
              item = heardItem(current, at);
            }
            if (item?.kind === "speech" && item.direction !== stretch.direction) {
              const changes = setDirection(current, item, stretch.direction);
              expect(changes.length, `say “${item.text}” ${stretch.direction}`).toBeGreaterThan(0);
              text = applyChanges(text, changes);
            }
          }
          expect(spokenScript(parse(text))).toBe(spokenScript(story));
          // The same print, but for where a mark taken out of `(@MarchHare “…` left a space.
          const print = (of: string) => bookText(parse(of)).replace(/\s+/g, "");
          expect(print(text)).toBe(print(source));
        },
        60_000,
      );

      it("takes a new speaker and a new direction on every stretch, changing nothing else", () => {
        for (const target of speeches(story)) {
          const speaker = setSpeaker(story, target, "Zed");
          expect(speaker.length, target.text).toBeGreaterThan(0);
          expect(brokenPromise(story, target, speaker, EDITS.speaker)).toBe(null);
          const direction = setDirection(story, target, "softly");
          // A stretch said softly already has nothing to change.
          if (target.direction !== "softly")
            expect(direction.length, target.text).toBeGreaterThan(0);
          expect(brokenPromise(story, target, direction, EDITS.direction)).toBe(null);
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
    // Each edit about two readings of the whole story (on a laptop, 100 to 150 ms).
    const said = speeches(story);
    const middle = said[Math.floor(said.length / 2)] as (typeof said)[number];
    expect(time(() => setSpeaker(story, middle, "Zed"))).toBeLessThan(1500);
    expect(time(() => setDirection(story, middle, "brightly"))).toBeLessThan(1500);
    expect(time(() => insertSound(story, middle.range.from + 2, "clatter"))).toBeLessThan(1500);
    // A book detail touches only the front matter: it reads only that again.
    expect(time(() => setMeta(story, "title", "A New Title"))).toBeLessThan(100);
  }, 60_000);

  it("formats a long manuscript with lines it must leave as they are, in good time", () => {
    // Straight quotes made curly, but some lines would give words to someone else as curly
    // marks: they stay as written, and finding them mustn't mean reading the book once each.
    const straight = books
      .map(({ source }) =>
        source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(/\r\n/g, "\n"),
      )
      .join("\n\n")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    const paragraphs = Array.from({ length: 6 }, () => straight)
      .join("\n\n")
      .split("\n\n");
    const bad = '@Tom "I\'m here,” he said. "Come in."';
    for (let at = 0; at < paragraphs.length; at += 20) paragraphs.splice(at, 0, bad);
    const manuscript = paragraphs.join("\n\n");
    let start = performance.now();
    const once = format(manuscript, { quotes: "curly" });
    expect(performance.now() - start).toBeLessThan(15_000);
    expect(once.split("\n").filter((line) => line === bad).length).toBeGreaterThan(40);
    start = performance.now();
    expect(format(once, { quotes: "curly" })).toBe(once);
    expect(performance.now() - start).toBeLessThan(10_000);
    // And short lines, every other one left as it is.
    const good = '@Ann "Hello," she said. "It\'s late."';
    const lines = Array.from({ length: 4000 }, (_, at) => (at % 2 ? bad : good)).join("\n\n");
    start = performance.now();
    const alternate = format(lines, { quotes: "curly" });
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(alternate.split("\n").filter((line) => line.startsWith("@Ann “")).length).toBe(2000);
  }, 120_000);

  it("formats many short paragraphs in good time", () => {
    // Each change's paragraph is found by halves, not by a search from the start.
    const text = Array.from({ length: 64_000 }, () => "The rain fell.  Nobody moved.").join("\n\n");
    const start = performance.now();
    format(text);
    expect(performance.now() - start).toBeLessThan(15_000);
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
