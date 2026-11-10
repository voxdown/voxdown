import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { format, lines, parse } from "../src/index";
import { root } from "./examples";

const voices = (text: string) =>
  lines(parse(text)).map((line) => [line.kind, line.speaker, line.direction]);

describe("the formatter (§13, rule 8)", () => {
  it("trims spaces, collapses blank lines and runs of spaces, and ends with one line break", () => {
    expect(format("  One  line.   \n\n\n\nTwo\tlines.\n\n\n")).toBe("One line.\n\nTwo lines.\n");
  });

  it("puts one blank line around headings and scene breaks, and after the front matter", () => {
    expect(format("---\ntitle: X\n---\nBefore.\n## Scene\nText.\n---\nEnd.")).toBe(
      "---\ntitle: X\n---\n\nBefore.\n\n## Scene\n\nText.\n\n---\n\nEnd.\n",
    );
  });

  it("keeps the front matter exactly as written, and group lines where they are", () => {
    const source =
      "---\ntitle:   Spaced   \ncast:\n    Gerald:\n---\n\n::: whispering\nCreep.\n:::\n";
    expect(format(source)).toBe(source);
  });

  it("writes names as the cast spells them, or as the file first does", () => {
    expect(format("---\ncast:\n  Clown:\n---\n\n@clown “Honk!” @CLOWN “Honk!”\n")).toBe(
      "---\ncast:\n  Clown:\n---\n\n@Clown “Honk!” @Clown “Honk!”\n",
    );
    expect(format("@Gerald “Hi.”\n@gerald “Bye.”\n")).toBe("@Gerald “Hi.”\n@Gerald “Bye.”\n");
    expect(format("@gerald “Hi.”\n", { names: false })).toBe("@gerald “Hi.”\n");
  });

  it("keeps CRLF line endings and a byte order mark", () => {
    expect(format("﻿One.  \r\n\r\n\r\nTwo.")).toBe("﻿One.\r\n\r\nTwo.\r\n");
  });

  it("leaves quotation marks alone unless asked", () => {
    const source = '@Gerald "Could you not?" he said.\n';
    expect(format(source)).toBe(source);
  });

  it("makes straight quotes curly in the story's language, apostrophes too", () => {
    expect(format(`@Gerald "Don't," he said, "it's a six-inch nail."\n`, { quotes: "curly" })).toBe(
      "@Gerald “Don’t,” he said, “it’s a six-inch nail.”\n",
    );
    // A mark after a digit stays as written (§13, rule 8). Here the parser reads `6"` as the
    // quote's end, so as curly marks the line would be heard differently: it stays as it is.
    expect(format(`@Gerald "It's a 6" nail," he said.\n`, { quotes: "curly" })).toBe(
      `@Gerald "It's a 6" nail," he said.\n`,
    );
    expect(format(`@Mother 'Now run along,' she said.\n`, { quotes: "curly" })).toBe(
      "@Mother ‘Now run along,’ she said.\n",
    );
    expect(
      format(`---\nlanguage: de\n---\n\n@Anna "Guten Morgen", sagte Anna.\n`, { quotes: "curly" }),
    ).toBe("---\nlanguage: de\n---\n\n@Anna „Guten Morgen“, sagte Anna.\n");
    expect(format(`@Anna "Bonjour."\n`, { quotes: "curly", language: "fr" })).toBe(
      "@Anna «Bonjour.»\n",
    );
  });

  it("never touches escaped marks, names or the inside of sounds and notes", () => {
    const source = `@O'Brien "Hi." [a "loud" bang] %% say "hi" %% \\"literal\\"\n`;
    expect(format(source, { quotes: "curly" })).toBe(
      `@O'Brien “Hi.” [a "loud" bang] %% say "hi" %% \\"literal\\"\n`,
    );
  });

  const files = readdirSync(join(root, "examples")).filter((name) => name.endsWith(".vxd"));
  it.each(files)("formats %s without changing who says what, and settles at once", (name) => {
    const source = readFileSync(join(root, "examples", name), "utf8");
    for (const options of [{}, { quotes: "curly" as const }]) {
      const once = format(source, options);
      expect(format(once, options)).toBe(once);
      expect(voices(once)).toEqual(voices(source));
    }
  });

  it("never gives a file front matter, and settles at once", () => {
    expect(format("---")).toBe("\n---\n");
    expect(parse(format("  ---\nHi")).frontMatter).toBe(null);
    for (const source of [" # Title\nText", "One.\uFEFF\nTwo.\r\r\n", "Hi\n  ***  \nThere"]) {
      const once = format(source);
      expect(format(once)).toBe(once);
    }
    expect(format("One.\uFEFF\nTwo.")).toBe("One.\nTwo.\n");
  });

  it("keeps feet and inches, makes rock 'n' roll's marks apostrophes, and never touches an address", () => {
    const curly = { quotes: "curly" as const };
    expect(format(`He is 6'2" tall.`, curly)).toBe(`He is 6'2" tall.\n`);
    expect(format("It was rock 'n' roll.", curly)).toBe("It was rock ’n’ roll.\n");
    expect(format(`@Gerald "I like rock 'n' roll."`, curly)).toBe(
      "@Gerald “I like rock ’n’ roll.”\n",
    );
    expect(format("See [it](https://example.com/it's).", curly)).toBe(
      "See [it](https://example.com/it's).\n",
    );
  });

  it("keeps group lines and each line's own line ending as written", () => {
    expect(format(":::   @Gerald   (whispering)  \nHi  there\n:::  ")).toBe(
      ":::   @Gerald   (whispering)  \nHi there\n:::  \n",
    );
    expect(format("One.\r\nTwo.\n## Head\r\nThree.\n")).toBe(
      "One.\r\nTwo.\n\n## Head\r\n\r\nThree.\n",
    );
  });

  it("refuses curly quotes that would move words to another speaker, line by line", () => {
    const curly = { quotes: "curly" as const };
    // As curly marks, the first ” would close Ann's quote and give "she said" to the narrator.
    expect(format('@Ann "Wait,” she said" and left.', curly)).toBe(
      '@Ann "Wait,” she said" and left.\n',
    );
    // One line that can't change doesn't stop the others.
    expect(format(`@Tom 'Hello,’ said Tom, 'it's late.'\n@Ann "Hi," she said.\n`, curly)).toBe(
      `@Tom 'Hello,’ said Tom, 'it's late.'\n@Ann “Hi,” she said.\n`,
    );
  });

  it("tidies every line it can, and leaves one whose tidying would change who says what", () => {
    // Without its stray carriage return the second line would open a group.
    expect(format("Hi  there.\n\r::: whispering\nHello\n:::\n")).toBe(
      "Hi there.\n\r::: whispering\nHello\n:::\n",
    );
    // `#` alone is no heading: an empty heading keeps its space, and the rest is tidied.
    expect(format("---\ntitle: X\n---\n# \n\n")).toBe("---\ntitle: X\n---\n\n# \n");
  });

  it("curls quotes inside quotes with the language's inner marks", () => {
    const curly = (text: string, language?: string) =>
      format(text, { quotes: "curly", ...(language ? { language } : {}) }).trimEnd();
    expect(curly(`@Tom "'Hello,' he said," she told me.`)).toBe(
      "@Tom “‘Hello,’ he said,” she told me.",
    );
    expect(curly(`@Tom "She called it '_The Raven_'."`)).toBe(
      "@Tom “She called it ‘_The Raven_’.”",
    );
    expect(curly(`@Tom "It was '*no*', then '2 o'clock', then '...and so on'."`)).toBe(
      "@Tom “It was ‘*no*’, then ‘2 o’clock’, then ‘...and so on’.”",
    );
    expect(curly(`@Tom "Er sagte 'nein' und ging", sagte sie.`, "de")).toBe(
      "@Tom „Er sagte ‚nein‘ und ging“, sagte sie.",
    );
    expect(curly(`@Tom «Il a dit 'non', puis il est parti», dit-elle.`, "fr")).toBe(
      "@Tom «Il a dit “non”, puis il est parti», dit-elle.",
    );
    // Apostrophes: a word's own, a plural's, a decade's, and rock 'n' roll's.
    expect(curly(`The '90s were great. The dogs' bowls. Rock 'n' roll.`)).toBe(
      "The ’90s were great. The dogs’ bowls. Rock ’n’ roll.",
    );
  });

  it("keeps a link or image as written, the spaces in an address in angle brackets too", () => {
    expect(format("See  [the map](<maps/old  town.png>)  now.")).toBe(
      "See [the map](<maps/old  town.png>) now.\n",
    );
    expect(format('![a  pic](<a  b.png> "A  title")  x')).toBe(
      '![a  pic](<a  b.png> "A  title") x\n',
    );
  });
});
