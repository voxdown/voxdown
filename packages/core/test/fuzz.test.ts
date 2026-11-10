/**
 * Properties every story must have, checked on stories made at random from the format's own
 * pieces: the parser never fails and its ranges hold together; an unchanged story writes back
 * byte for byte; formatting settles and never changes who says what; and each edit changes only
 * what it says it does.
 *
 * FUZZ_RUNS sets how many stories each property tries (default 200), FUZZ_SEED the seed (default
 * a fixed one, so a failure in CI can be run again; `FUZZ_SEED=random` for a new one each time).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Speech,
  type Story,
  type TextChange,
  applyChanges,
  bookText,
  format,
  fromFountain,
  lines,
  linesToCsv,
  parse,
  renameCharacter,
  setDirection,
  setSpeaker,
  spokenScript,
  textByCharacter,
  tokens,
  write,
} from "../src/index";
import { EDITS, allLines, brokenPromise, speeches } from "./voices";

const RUNS = Number(process.env.FUZZ_RUNS ?? 200);
const SEED =
  process.env.FUZZ_SEED === "random" ? undefined : Number(process.env.FUZZ_SEED ?? 20261110);
const settings = { numRuns: RUNS, ...(SEED === undefined ? {} : { seed: SEED }) };

/** The pieces stories are made of, the tricky ones as likely as the plain ones. */
const PIECES = [
  // names, marks and directions
  "@Gerald",
  "@Wanda",
  "@gerald",
  "@Narrator",
  "@",
  "@(",
  "@()",
  "@(yawning)",
  "(yawning)",
  "(deep, polite)",
  "(",
  ")",
  "@[x](y)",
  "@Gerald [snores]",
  "@[giggles]",
  // quotes of every kind, and apostrophes
  "“",
  "”",
  "‘",
  "’",
  '"',
  "'",
  "„",
  "“Hello,”",
  "‘Hi’",
  '"Yes."',
  "don’t",
  "it's",
  "«",
  "»",
  "‹",
  "›",
  // sounds, instructions, notes, images and links
  "[snores]",
  "[",
  "]",
  "[a door creaks]",
  "{page}",
  "{page 3}",
  "{pause 2s}",
  "{pause}",
  "{book only}",
  "{audio only}",
  "{hidden}",
  "{recorder:take 3}",
  "{",
  "}",
  "%%",
  "%% note %%",
  "[link](https://example.com)",
  "![image](a.png)",
  "<b>",
  "&amp;",
  // groups, headings, breaks, front matter, lists, quotes
  ":::",
  "::: whispering",
  "::: @Gerald (whispering)",
  "::: {book only}",
  "# ",
  "## Title",
  "***",
  "---",
  "> ",
  "- ",
  "1. ",
  "---\ncast:\n  Gerald:\n    name: Gerald the Dragon\n---\n",
  "---\nnarrator: Wanda\n---\n",
  "---\nvoxdown: 1.0\nlanguage: de\n---\n",
  // text, spacing and line ends
  "Hello",
  "said the dragon",
  " ",
  "  ",
  "\t",
  "\n",
  "\n\n",
  "\r\n",
  "\\",
  "\\@",
  "\\[",
  "*",
  "_",
  "`",
  "—",
  "…",
  ".",
  ",",
  "!",
  "?",
  "é",
  "ß",
  "日本",
  "😀",
  " ",
  "﻿",
  "​",
];

const pieceStory = fc
  .array(fc.constantFrom(...PIECES), { maxLength: 40 })
  .map((pieces) => pieces.join(""));
/** Stories of pieces, and now and then any text at all. */
const anyStory = fc.oneof(
  { weight: 4, arbitrary: pieceStory },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 80 }) },
);

/** A stretch's words (quotation marks aside: a quote may become a speech's own), speaker and direction. */
const voice = (speech: Speech) => ({
  words: speech.text
    .replace(/["'“”‘’„‚«»‹›]/g, "")
    .replace(/\s+/g, " ")
    .trim(),
  speaker: speech.speaker,
  direction: speech.direction,
});

/**
 * An edit does exactly what it says or nothing (see voices.ts). How often it declines is counted,
 * so an edit that always declines can't pass: it may only do so on the odd story.
 */
function editProperty(
  edit: (story: Story, target: Speech) => TextChange[],
  promise: (typeof EDITS)[keyof typeof EDITS],
) {
  let tried = 0;
  let declined = 0;
  fc.assert(
    fc.property(anyStory, fc.nat(), (source, pick) => {
      const story = parse(source);
      const said = speeches(story);
      const target = said[pick % Math.max(1, said.length)];
      if (!target) return;
      tried++;
      const changes = edit(story, target);
      if (changes.length === 0) {
        declined++;
        return;
      }
      expect(brokenPromise(story, target, changes, promise.inside, promise.some)).toBe(null);
    }),
    settings,
  );
  expect(declined).toBeLessThanOrEqual(Math.max(3, tried * 0.1));
}

describe("on stories made at random", () => {
  it("the parser never fails, and its ranges stay inside the text and in order", () => {
    fc.assert(
      fc.property(anyStory, (source) => {
        const story = parse(source);
        const inside = (range: { from: number; to: number }) =>
          0 <= range.from && range.from <= range.to && range.to <= source.length;
        let previous = -1;
        for (const line of allLines(story)) {
          expect(inside(line.range)).toBe(true);
          expect(line.range.from).toBeGreaterThan(previous);
          previous = line.range.from;
          for (const item of line.items) {
            expect(inside(item.range)).toBe(true);
            expect(item.range.from).toBeGreaterThanOrEqual(line.range.from);
            expect(item.range.to).toBeLessThanOrEqual(line.range.to);
          }
        }
        for (const block of story.blocks) expect(inside(block.range)).toBe(true);
        for (const warning of story.warnings) expect(inside(warning.range)).toBe(true);
      }),
      settings,
    );
  });

  it("highlighting tokens stay inside the text and come in order", () => {
    fc.assert(
      fc.property(anyStory, (source) => {
        let previous = 0;
        for (const token of tokens(parse(source))) {
          expect(token.range.from).toBeGreaterThanOrEqual(0);
          expect(token.range.to).toBeLessThanOrEqual(source.length);
          expect(token.range.from).toBeLessThanOrEqual(token.range.to);
          expect(token.range.from).toBeGreaterThanOrEqual(previous);
          previous = token.range.from;
        }
      }),
      settings,
    );
  });

  it("every reading and export can be made", () => {
    fc.assert(
      fc.property(anyStory, (source) => {
        const story = parse(source);
        spokenScript(story);
        bookText(story);
        textByCharacter(story);
        const rows = lines(story);
        linesToCsv(rows);
        const lineCount = source.split("\n").length;
        for (const row of rows) {
          expect(row.line).toBeGreaterThanOrEqual(1);
          expect(row.line).toBeLessThanOrEqual(lineCount);
          expect(row.column).toBeGreaterThanOrEqual(1);
        }
      }),
      settings,
    );
  });

  it("an unchanged story writes back byte for byte", () => {
    fc.assert(
      fc.property(anyStory, (source) => {
        expect(write(parse(source))).toBe(source);
      }),
      settings,
    );
  });

  it("formatting settles after one run, and never changes who says what", () => {
    fc.assert(
      fc.property(anyStory, fc.boolean(), (source, curly) => {
        const options = curly ? { quotes: "curly" as const } : {};
        const once = format(source, options);
        expect(format(once, options)).toBe(once);
        const who = (text: string) =>
          lines(parse(text)).map((row) => [row.kind, row.speaker, row.direction]);
        expect(who(once)).toEqual(who(source));
      }),
      settings,
    );
  });

  it("giving a stretch to another character changes only that stretch's speaker", () => {
    // The stretch may split: narration that opens with a quote gives that quote to the character
    // and keeps the rest. Each of its words goes to the new speaker or stays; one at least goes.
    editProperty((story, target) => setSpeaker(story, target, "Zed"), EDITS.speaker);
  });

  it("setting how a stretch is said changes only that stretch's direction", () => {
    editProperty((story, target) => setDirection(story, target, "softly"), EDITS.direction);
  });

  it("renaming a character renames them everywhere and changes nothing else", () => {
    fc.assert(
      fc.property(anyStory, (source) => {
        const story = parse(source);
        const before = speeches(story).map(voice);
        const after = speeches(
          parse(applyChanges(source, renameCharacter(story, "Gerald", "Zed"))),
        );
        // Names are the same name whatever their case: `@gerald` is Gerald.
        expect(after.map(voice)).toEqual(
          before.map((v) => (v.speaker.toLowerCase() === "gerald" ? { ...v, speaker: "Zed" } : v)),
        );
      }),
      settings,
    );
  });

  it("a Fountain import never fails, and what it makes reads without failing", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 120 }), pieceStory, (text, pieces) => {
        for (const fountain of [
          text,
          pieces,
          `INT. CAVE - NIGHT\n\n${pieces}\n\nGERALD\n${text}`,
        ]) {
          parse(fromFountain(fountain));
        }
      }),
      settings,
    );
  });
});
