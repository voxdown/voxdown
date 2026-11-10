/**
 * Properties every story must have, checked on stories made at random from the format's own
 * pieces: the parser never fails and its ranges hold together; an unchanged story writes back
 * byte for byte; formatting settles and never changes who says what; and each edit changes only
 * what it says it does.
 *
 * FUZZ_RUNS sets how many stories each property tries (default 1000), FUZZ_SEED the seed (default
 * a fixed one, so a failure in CI can be run again; `FUZZ_SEED=random` for a new one each time).
 * FUZZ_SHOW=1 prints each story an edit declined, and how many it declined.
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
  insertLine,
  insertSound,
  lines,
  linesToCsv,
  parse,
  renameCharacter,
  setDirection,
  setMeta,
  setSpeaker,
  spokenScript,
  textByCharacter,
  tokens,
  write,
} from "../src/index";
import { diffChanges } from "../src/write";
import { proseStory } from "./stories";
import {
  EDITS,
  type EditPromise,
  allItems,
  allLines,
  brokenPromise,
  speeches,
  spokenChars,
} from "./voices";

/** On prose, an edit may decline on one stretch in a hundred at most. */
const PROSE_BUDGET = 0.01;

const RUNS = Number(process.env.FUZZ_RUNS ?? 1000);
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

/** Pieces glued together or, as in prose, with a space between them. */
const pieceStory = fc
  .array(fc.tuple(fc.constantFrom(...PIECES), fc.boolean()), { maxLength: 40 })
  .map((pieces) => pieces.map(([piece, spaced]) => (spaced ? `${piece} ` : piece)).join(""));
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
 * so an edit that always declines can't pass: it may only do so on the odd story. These are
 * stories of tricky pieces, and an edit declines where a mark would show in the book, such as a
 * name glued to a word (`]日本`): about 6% of stretches for a new speaker, which must move every
 * word of the stretch (or every word of narration's first quote), under 1% for a direction. The
 * real books, where every stretch must take both edits, show how they do on prose.
 */
function editProperty(
  stories: fc.Arbitrary<string>,
  edit: (story: Story, target: Speech) => TextChange[],
  promise: EditPromise,
  budget: number,
) {
  let tried = 0;
  let declined = 0;
  fc.assert(
    fc.property(stories, fc.nat(), (source, pick) => {
      const story = parse(source);
      const said = speeches(story);
      const target = said[pick % Math.max(1, said.length)];
      // A stretch already said as asked has nothing to change: that's no decline.
      if (!target || promise.already?.(target)) return;
      tried++;
      const changes = edit(story, target);
      if (changes.length === 0) {
        declined++;
        if (process.env.FUZZ_SHOW) console.log("declined:", JSON.stringify(source), target.text);
        return;
      }
      expect(brokenPromise(story, target, changes, promise)).toBe(null);
    }),
    settings,
  );
  if (process.env.FUZZ_SHOW) console.log(`declined ${declined} of ${tried}`);
  expect(declined).toBeLessThanOrEqual(Math.max(3, tried * budget));
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

  it("formatting changes words only in their spaces and quotation marks, and never an address", () => {
    const words = (text: string) =>
      text
        .replace(/["'“”‘’„‚«»‹›]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    const addresses = (text: string) => (text.match(/\]\([^()\s]*\)/g) ?? []).sort();
    fc.assert(
      fc.property(anyStory, fc.boolean(), (source, curly) => {
        const out = format(source, {
          names: false,
          ...(curly ? { quotes: "curly" as const } : {}),
        });
        expect(words(out)).toBe(words(source));
        expect(addresses(out)).toEqual(addresses(source));
        // Each line keeps its line ending: no new kind of line ending appears.
        const lf = /(^|[^\r])\n/;
        if (lf.test(source) && !source.includes("\r\n")) expect(out).not.toContain("\r\n");
        if (source.includes("\r\n") && !lf.test(source)) expect(out).not.toMatch(lf);
      }),
      settings,
    );
  });

  it("giving a stretch to another character changes only that stretch's speaker", () => {
    // The stretch may split: narration that opens with a quote gives that quote to the character
    // and keeps the rest. Each of its words goes to the new speaker or stays; one at least goes.
    editProperty(
      anyStory,
      (story, target) => setSpeaker(story, target, "Zed"),
      EDITS.speaker,
      0.12,
    );
  });

  it("setting how a stretch is said changes only that stretch's direction", () => {
    editProperty(
      anyStory,
      (story, target) => setDirection(story, target, "softly"),
      EDITS.direction,
      0.04,
    );
  });
  it("a sound or a line put in adds just that, and everything heard stays as it was", () => {
    // Any offset is tried for safety. How often an edit declines is counted where it is meant to
    // be used: a sound after a word of a stretch, a line anywhere. (A sound has no place on a group
    // line or a scene break, nor after a mark that ends its line, where it would be the character's
    // own, §8.2: there, it declines.)
    let tried = 0;
    let declined = 0;
    const heard = (story: Story) =>
      spokenChars(story).map((c) => [c.char, c.speaker.toLowerCase(), c.direction]);
    const count = (story: Story, kind: string) =>
      allItems(story).filter((item) => item.kind === kind).length;
    const tryEdit = (source: string, story: Story, edit: TextChange[], counted: boolean) => {
      if (counted) tried++;
      if (edit.length === 0) {
        if (counted) declined++;
        if (counted && process.env.FUZZ_SHOW) console.log("declined:", JSON.stringify(source));
        return null;
      }
      const out = applyChanges(source, edit);
      const after = parse(out);
      expect(heard(after)).toEqual(heard(story));
      if (story.frontMatter) expect(after.frontMatter?.raw).toBe(story.frontMatter.raw);
      return { out, after };
    };
    fc.assert(
      fc.property(
        anyStory,
        fc.nat(),
        fc.nat(),
        fc.constantFrom("{page}", "{pause 2s}", "%% Slowly. %%"),
        (source, pick, word, text) => {
          const story = parse(source);
          const at = pick % (source.length + 1);
          const said = speeches(story);
          const stretch = said[word % Math.max(1, said.length)];
          const inWords = stretch
            ? stretch.textRange.from + (pick % (stretch.textRange.to - stretch.textRange.from + 1))
            : null;
          for (const [offset, counted] of [
            [at, false],
            [inWords, true],
          ] as const) {
            if (offset === null) continue;
            const sound = tryEdit(source, story, insertSound(story, offset, "clatter"), counted);
            if (sound) expect(count(sound.after, "sound")).toBe(count(story, "sound") + 1);
          }
          const line = tryEdit(source, story, insertLine(story, at, text), true);
          if (line) expect(line.out.replace(/^\uFEFF/, "").split(/\r?\n/)).toContain(text);
        },
      ),
      settings,
    );
    if (process.env.FUZZ_SHOW) console.log(`declined ${declined} of ${tried}`);
    expect(declined).toBeLessThanOrEqual(Math.max(3, tried * 0.04));
  });

  it("the writer writes a changed note, instruction or sound as asked, or throws", () => {
    const values = fc.oneof(
      fc.constantFrom(
        "",
        " ",
        "%%",
        "a %% b",
        "}",
        "{",
        "a} b {pause",
        "[",
        "]",
        "\\",
        "x\ny",
        "take 2",
      ),
      fc.string({ maxLength: 12 }),
    );
    let written = 0;
    fc.assert(
      fc.property(anyStory, fc.nat(), values, (source, pick, value) => {
        const story = parse(source);
        const changeable = allItems(story).filter(
          (item) =>
            item.kind === "note" ||
            item.kind === "sound" ||
            (item.kind === "instruction" && item.value !== null),
        );
        const item = changeable[pick % Math.max(1, changeable.length)];
        if (!item) return;
        const nth = allItems(story)
          .filter((other) => other.kind === item.kind)
          .indexOf(item);
        if (item.kind === "note") item.text = value;
        else if (item.kind === "sound") item.description = value;
        else if (item.kind === "instruction") item.value = value;
        let text: string;
        try {
          text = write(story);
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
          return;
        }
        written++;
        const after = parse(text);
        const before = parse(source);
        const now = allItems(after).filter((other) => other.kind === item.kind)[nth];
        const asked = value.replace(/\s+/g, " ").trim();
        if (now?.kind === "note") expect(now.text).toBe(asked);
        if (now?.kind === "sound") expect(now.description).toBe(asked);
        if (now?.kind === "instruction") expect(now.value).toBe(asked || null);
        expect(allItems(after).map((other) => other.kind)).toEqual(
          allItems(before).map((other) => other.kind),
        );
        const heard = (of: Story) =>
          spokenChars(of).map((c) => [c.char, c.speaker.toLowerCase(), c.direction]);
        expect(heard(after)).toEqual(heard(before));
      }),
      settings,
    );
    expect(written).toBeGreaterThan(0);
  });

  it("book details are set exactly as asked, and nothing else in the file moves", () => {
    const fronts = fc.constantFrom(
      "",
      "---\ntitle: Old\n---\n",
      '---\ntitle: "Chapter #1" # keep\nauthor: Me\n---\n',
      "---\ntitle: |\n  First\n\n  Second\nauthor: Me\n---\n",
      "---\ntitle:\n  continued plain\nauthor: Me\n---\n",
      "---\ntitle: 'It''s' # c\r\nauthor: Me\r\n---\r\n",
      "﻿---\nauthor: Me\n---\n",
    );
    const values = fc.oneof(
      fc.constantFrom(
        "New",
        "#1",
        "a: b",
        '"quoted"',
        "it's",
        "x # y",
        "",
        " padded ",
        "a\nb",
        "null",
        "007",
      ),
      fc.string({ maxLength: 10 }),
    );
    fc.assert(
      fc.property(fronts, pieceStory, values, (front, body, value) => {
        const source = front + body;
        const story = parse(source);
        const text = applyChanges(source, setMeta(story, "title", value));
        const after = parse(text);
        // Front matter the reader can't make sense of isn't changed: it can't be read back.
        if (story.warnings.some((warning) => warning.code === "front-matter")) return;
        // A title is read without spaces at its ends.
        expect(after.meta.title ?? "").toBe(value.trim());
        expect(after.meta.author).toBe(story.meta.author);
        expect(spokenScript(after)).toBe(spokenScript(story));
        // The story itself is untouched (unless it starts the file with front matter of its own).
        if (front !== "" || (!story.frontMatter && !source.startsWith("\uFEFF"))) {
          expect(text.endsWith(body)).toBe(true);
        }
      }),
      settings,
    );
  });

  it("front matter of every form reads without failing, and its details are set as asked", () => {
    const scalar = fc.oneof(
      fc.constantFrom(
        "plain",
        "two words # a comment",
        '"double \\u00e9 \\UFFFFFFFF \\x41 # not a comment"',
        "'single ''quoted'' # not a comment'",
        "null",
        "~",
        "007",
        "true",
        "[a, \"b # c\", 'd']",
        "[unclosed",
        "{flow: map}",
        "&anchor value",
        "|\n  block\n\n  scalar",
        ">-\n  folded\n  lines",
        '"over\n  two lines"',
        "first\n\n  continued",
        "",
      ),
      fc.string({ maxLength: 12 }),
    );
    const key = fc.constantFrom(
      "title",
      "author",
      "language",
      "narrator",
      "subtitle",
      "x-tool",
      "cast",
    );
    const entry: fc.Arbitrary<string> = fc.oneof(
      fc.tuple(key, scalar).map(([k, v]) => `${k}: ${v}`),
      fc
        .tuple(fc.constantFrom("Gerald", "Wanda", "Zoë"), scalar)
        .map(([name, v]) => `cast:\n  ${name}: ${v}\n  ${name}2:\n    name: ${v}`),
      fc.constantFrom("# a comment", "", "- a list item", "  indented: oddly", "\tcast: tabbed"),
      fc.nat({ max: 60 }).map((depth) => `deep:\n  ${"- ".repeat(depth)}x`),
    );
    fc.assert(
      fc.property(
        fc.array(entry, { maxLength: 8 }),
        fc.boolean(),
        fc.string({ maxLength: 10 }),
        (entries, crlf, value) => {
          let source = `---\n${entries.join("\n")}\n---\nHello.\n`;
          if (crlf) source = source.replace(/\n/g, "\r\n");
          const story = parse(source);
          expect(spokenScript(story)).toContain("Hello.");
          const text = applyChanges(source, setMeta(story, "title", value));
          const after = parse(text);
          // Unless the front matter is too broken to hold a title where it can be read.
          if (!story.warnings.some((warning) => warning.code === "front-matter")) {
            expect(after.meta.title ?? "").toBe(value.trim());
            expect(spokenScript(after)).toBe(spokenScript(story));
          }
        },
      ),
      settings,
    );
  });

  it("the changes between two texts turn the one into the other", () => {
    const line = fc.constantFrom(
      "@Alice “Hi.”\n",
      "@Alicia “Hi.”\n",
      "\n",
      "Some words\n",
      "Some word\n",
      "x",
      "\r\n",
    );
    fc.assert(
      fc.property(fc.array(line, { maxLength: 40 }), fc.array(line, { maxLength: 40 }), (a, b) => {
        const before = a.join("");
        const after = b.join("");
        expect(applyChanges(before, diffChanges(before, after))).toBe(after);
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

describe("on prose made at random", () => {
  // Stories written the way people write them (stories.ts), where an edit should almost never
  // have to decline.
  it("giving a stretch to another character changes only that stretch's speaker", () => {
    editProperty(
      proseStory,
      (story, target) => setSpeaker(story, target, "Zed"),
      EDITS.speaker,
      PROSE_BUDGET,
    );
  }, 60_000);

  it("setting how a stretch is said changes only that stretch's direction", () => {
    editProperty(
      proseStory,
      (story, target) => setDirection(story, target, "softly"),
      EDITS.direction,
      PROSE_BUDGET,
    );
  }, 60_000);

  it("formatting settles, keeps every word, and never changes who says what", () => {
    fc.assert(
      fc.property(proseStory, fc.boolean(), (source, curly) => {
        const options = curly ? { quotes: "curly" as const } : {};
        const once = format(source, options);
        expect(format(once, options)).toBe(once);
        const heard = (text: string) =>
          spokenChars(parse(text)).map((c) => [c.char, c.speaker.toLowerCase(), c.direction]);
        expect(heard(once)).toEqual(heard(source));
      }),
      settings,
    );
  }, 60_000);

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
});
