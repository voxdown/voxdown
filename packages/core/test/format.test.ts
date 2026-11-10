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
    expect(format(`@Gerald "Don't," he said, "it's a 6" nail."\n`, { quotes: "curly" })).toBe(
      "@Gerald “Don’t,” he said, “it’s a 6” nail.”\n",
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
});
