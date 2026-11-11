import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Story,
  applyChanges,
  bookText,
  castMemberNamed,
  giveQuotes,
  parse,
  quotesOf,
  taggedName,
} from "../src/index";
import { root } from "./examples";

const brief = (story: Story) =>
  quotesOf(story).map((quote) => [
    quote.number,
    quote.text,
    quote.narrated ? "-" : quote.speaker,
    ...(quote.continued ? ["continued"] : []),
  ]);

describe("the quotes of a story", () => {
  it("are numbered in reading order, with who says each now", () => {
    const story = parse(
      [
        "---",
        "cast:",
        "  Mara: Mara Stone",
        "---",
        "# “Not a quote” in a heading",
        "",
        "@Mara “Hello,” she said. “Come in.”",
        "",
        "“Who’s there?” asked Tom. 'Tis late, he thought; rock'n'roll.",
        "",
        "::: @Mara reading",
        "“Dear Tom,” it began.",
        ":::",
        "",
        "“The first paragraph,",
        "",
        "“and the second.”",
      ].join("\n"),
    );
    expect(brief(story)).toEqual([
      [1, "Hello,", "Mara"],
      [2, "Come in.", "Mara", "continued"],
      [3, "Who’s there?", "-"],
      // In a group, the character's own words hold the quote: it isn't the narrator's.
      [4, "Dear Tom,", "Mara"],
      [5, "The first paragraph,", "-"],
      [6, "and the second.", "-"],
    ]);
    const third = quotesOf(story)[2];
    expect(third?.line).toBe(9);
    expect(story.source.slice(third?.from, third?.to)).toBe("“Who’s there?”");
  });

  it("know the name an English dialogue tag gives them", () => {
    const story = parse(
      [
        "“Who’s there?” asked Tom.",
        "“Me,” Old Mara said.",
        "Mara said, “Nothing.”",
        "“Nobody,” he said.",
        "“Well,” said the Queen.",
      ].join("\n\n"),
    );
    expect(quotesOf(story).map((quote) => taggedName(story, quote))).toEqual([
      "Tom",
      "Old Mara",
      "Mara",
      undefined,
      "Queen",
    ]);
  });

  it("find the cast member a name means, by short or full name", () => {
    const story = parse(
      "---\nnarrator: Teller\ncast:\n  Mother:\n    name: Mrs. Rabbit\n  Peter:\n---\nHello.",
    );
    expect(castMemberNamed(story, "mother")).toBe("Mother");
    expect(castMemberNamed(story, "Mrs. Rabbit")).toBe("Mother");
    expect(castMemberNamed(story, "Peter")).toBe("Peter");
    expect(castMemberNamed(story, "teller")).toBe("Teller");
    expect(castMemberNamed(story, "Flopsy")).toBeUndefined();
    // A full name's last word, and an article set aside.
    expect(castMemberNamed(story, "Rabbit")).toBe("Mother");
    const tea = parse(
      "---\ncast:\n  Hare: The March Hare\n  Mr: Mr. Bennet\n  Mrs: Mrs. Bennet\n---\nHi.",
    );
    expect(castMemberNamed(tea, "March Hare")).toBe("Hare");
    expect(castMemberNamed(tea, "the March Hare")).toBe("Hare");
    expect(castMemberNamed(tea, "Hare")).toBe("Hare");
    // Two full names end so: it could be either.
    expect(castMemberNamed(tea, "Bennet")).toBeUndefined();
    expect(castMemberNamed(tea, "Mrs. Bennet")).toBe("Mrs");
    // A title before a name the cast has, and a name spelled with a hyphen or without.
    const ship = parse("---\ncast:\n  Peleg:\n  Guernseyman:\n---\nHi.");
    expect(castMemberNamed(ship, "Captain Peleg")).toBe("Peleg");
    expect(castMemberNamed(ship, "Guernsey-man")).toBe("Guernseyman");
    expect(castMemberNamed(ship, "Captain Ahab")).toBeUndefined();
  });

  it("read the name a tag gives whether it comes before the verb or after, with its article", () => {
    const story = parse(
      "---\ncast:\n  Hare: The March Hare\n---\n“Have some wine,” the March Hare said.\n\n“I don’t see any wine,” Alice remarked.\n\nThe March Hare said, “There isn’t any.”\n",
    );
    expect(quotesOf(story).map((quote) => taggedName(story, quote))).toEqual([
      "March Hare",
      "Alice",
      "March Hare",
    ]);
    expect(castMemberNamed(story, "March Hare")).toBe("Hare");
  });
});

describe("giving quotes", () => {
  const source = [
    "---",
    "cast:",
    "  Mara: Mara Stone",
    "---",
    "“Hello,” she said. “Come in.”",
    "",
    "“Who’s there?” asked Tom. “Only me,” said Mara.",
    "",
  ].join("\n");

  it("marks each quote that needs it, and none that would carry on anyway", () => {
    const story = parse(source);
    const result = giveQuotes(story, [
      { quote: 1, speaker: "Mara" },
      { quote: 2, speaker: "mara" },
      { quote: 3, speaker: "Tom", fullName: "Tom Hale" },
      { quote: 4, speaker: "Mara Stone" },
    ]);
    expect(result.refused).toEqual([]);
    expect(result.given).toEqual([1, 2, 3, 4]);
    expect(result.joined).toEqual(["Tom"]);
    const after = applyChanges(source, result.changes);
    expect(after).toBe(
      [
        "---",
        "cast:",
        "  Mara: Mara Stone",
        "  Tom: Tom Hale",
        "---",
        "@Mara “Hello,” she said. “Come in.”",
        "",
        "@Tom “Who’s there?” asked Tom. @Mara “Only me,” said Mara.",
        "",
      ].join("\n"),
    );
    // The numbers stay: given again, nothing changes.
    expect(giveQuotes(parse(after), [{ quote: 4, speaker: "Mara" }]).changes).toEqual([]);
    expect(bookText(parse(after))).toBe(bookText(story));
  });

  it("says which quotes went along with one given, and refuses what can't be written", () => {
    const story = parse(source);
    const result = giveQuotes(story, [
      { quote: 1, speaker: "Mara" },
      { quote: 3, speaker: "Old Tom" },
      { quote: 9, speaker: "Mara" },
    ]);
    expect(result.given).toEqual([1]);
    expect(result.carried).toEqual([2]);
    expect(result.refused).toEqual([
      { quote: 3, why: "“Old Tom” isn't a name: a name is one word, such as OldTom" },
      { quote: 9, why: "there is no quote 9" },
    ]);
  });

  it("leave a quote the narrator reads where the narrator is meant", () => {
    const story = parse("“Keep out,” the sign said.\n");
    const result = giveQuotes(story, [{ quote: 1, speaker: "Narrator" }]);
    expect(result).toMatchObject({ changes: [], given: [1], refused: [] });
  });

  it("change the name in a quote's own mark, rather than add a second", () => {
    const story = parse("@Tom (softly) “Who’s there?” asked Tom.\n");
    const result = giveQuotes(story, [{ quote: 1, speaker: "Bob" }]);
    expect(applyChanges(story.source, result.changes)).toBe(
      "@Bob (softly) “Who’s there?” asked Tom.\n",
    );
    expect(result.given).toEqual([1]);
  });

  it("with no cast, adds none", () => {
    const story = parse("“Hi,” said Tom.\n");
    const result = giveQuotes(story, [{ quote: 1, speaker: "Tom" }]);
    expect(applyChanges(story.source, result.changes)).toBe("@Tom “Hi,” said Tom.\n");
    expect(result.joined).toEqual([]);
  });

  /** A story with the marks before its quotes taken out: what a model would be asked to put back. */
  function unmarked(story: Story): string {
    const cuts: Array<{ from: number; to: number; insert: string }> = [];
    for (const block of story.blocks) {
      if (block.kind !== "paragraph") continue;
      for (const line of block.lines)
        for (const item of line.items) {
          if (item.kind !== "speech" || !item.quoted || !item.mark || item.mark.direction) continue;
          const mark = item.mark.range;
          if (story.source.slice(mark.to, item.range.from).trim() !== "") continue;
          cuts.push({ from: mark.from, to: item.range.from, insert: "" });
        }
    }
    const unique = [...new Map(cuts.map((cut) => [cut.from, cut])).values()];
    return applyChanges(story.source, unique);
  }

  const books = [
    ...readdirSync(join(root, "corpus"))
      .filter((name) => name.endsWith(".vxd"))
      .map((name) => ({ name, source: readFileSync(join(root, "corpus", name), "utf8") })),
    ...readdirSync(join(root, "examples"))
      .filter((name) => name.endsWith(".vxd"))
      .map((name) => ({ name, source: readFileSync(join(root, "examples", name), "utf8") })),
  ];

  it.each(books)("put back as $name had them, words unchanged", ({ source }) => {
    const marked = parse(source);
    const bare = parse(unmarked(marked));
    const was = quotesOf(marked);
    expect(quotesOf(bare)).toHaveLength(was.length);
    const gifts = was
      .filter((quote) => !quote.narrated)
      .map((quote) => ({ quote: quote.number, speaker: quote.speaker }));
    const result = giveQuotes(bare, gifts);
    const after = parse(applyChanges(bare.source, result.changes));
    expect(bookText(after)).toBe(bookText(bare));
    // Every quote said by whom the book has say it.
    const refused = new Set(result.refused.map((refusal) => refusal.quote));
    const wrong = quotesOf(after).filter(
      (quote, index) =>
        !refused.has(quote.number) &&
        quote.speaker.toLowerCase() !== was[index]?.speaker.toLowerCase(),
    );
    expect(wrong).toEqual([]);
    expect(result.refused).toEqual([]);
  });
});
