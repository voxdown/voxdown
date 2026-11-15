// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import type { Paragraph } from "../src/writer/convert";
import { headerWord, manuscriptDocx, wordsAbout } from "../src/writer/manuscript";
import { manuscriptChapterLevel } from "../src/writer/manuscript-dialog";
import { unzip } from "../src/writer/zip";

const decoder = new TextDecoder();

/** The paragraphs of a Word document that start a page, by their words. */
const pageStarts = (document: string) =>
  [...document.matchAll(/<w:p>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g)]
    .filter((found) => found[0].includes("<w:pageBreakBefore/>"))
    .map((found) => [...found[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));
const run = (text: string, italic = false) => ({ text, italic, bold: false });

describe("a manuscript to submit", () => {
  it("rounds its words, and takes a word of its title for the header", () => {
    expect(wordsAbout(3460)).toBe("about 3,500 words");
    expect(wordsAbout(20)).toBe("about 100 words");
    expect(wordsAbout(81_499)).toBe("about 81,000 words");
    expect(headerWord("The Dragon Who Would Not Roar")).toBe("DRAGON");
    expect(headerWord("Owl!")).toBe("OWL");
  });

  it("is a Word document in the standard format", async () => {
    const paragraphs: Paragraph[] = [
      { kind: "heading", level: 1, runs: [run("One")] },
      { kind: "text", runs: [run("Night fell. "), run("Very", true), run(" still.")] },
      { kind: "break" },
      { kind: "text", runs: [run("Morning.")] },
      { kind: "heading", level: 1, runs: [run("Two")] },
      { kind: "text", runs: [run("The end <of> it.")] },
    ];
    const files = await unzip(
      manuscriptDocx(paragraphs, {
        title: "The Owl",
        byline: "A. Teller",
        contact: "Ann Teller\n1 Harbour Lane\nann@example.com",
        surname: "Teller",
        words: 3460,
      }),
    );
    const document = decoder.decode(files.get("word/document.xml"));
    const styles = decoder.decode(files.get("word/styles.xml"));
    const header = decoder.decode(files.get("word/header1.xml"));
    expect(styles).toContain('w:ascii="Times New Roman"');
    expect(styles).toContain('w:line="480"');
    expect(styles).toContain('<w:ind w:firstLine="720"/>');
    expect(document).toContain(
      'Ann Teller</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">about 3,500 words',
    );
    expect(document).toContain("by A. Teller");
    expect(document).toContain("<w:titlePg/>");
    expect(document).toContain('<w:i/></w:rPr><w:t xml:space="preserve">Very');
    expect(document).toContain(">#</w:t>");
    expect(document).toContain("The end &lt;of&gt; it.");
    // A book of chapters: the title page its own, each chapter starting a page.
    expect(pageStarts(document)).toEqual(["One", "Two"]);
    expect(document).toContain(">END</w:t>");
    expect(header).toContain("Teller / OWL / ");
    expect(header).toContain(" PAGE ");
  });

  it("starts chapters on a new page, and a scene after a #, never two together", async () => {
    const paragraphs: Paragraph[] = [
      { kind: "heading", level: 1, runs: [run("Chapter One")] },
      { kind: "heading", level: 2, runs: [run("Arrival")] },
      { kind: "text", runs: [run("They came.")] },
      { kind: "heading", level: 2, runs: [run("Departure")] },
      { kind: "text", runs: [run("They went.")] },
      { kind: "break" },
      { kind: "text", runs: [run("Later.")] },
      { kind: "break" },
      { kind: "heading", level: 1, runs: [run("Chapter Two")] },
      { kind: "text", runs: [run("Again.")] },
    ];
    const files = await unzip(
      manuscriptDocx(paragraphs, {
        title: "The Owl",
        byline: "A. Teller",
        contact: "Ann Teller",
        surname: "Teller",
        words: 100,
        chapterLevel: 1,
      }),
    );
    const document = decoder.decode(files.get("word/document.xml"));
    expect(pageStarts(document)).toEqual(["Chapter One", "Chapter Two"]);
    // A # between Arrival and Departure, and before Later: none after a chapter's heading.
    expect(document.match(/>#<\/w:t>/g)).toHaveLength(2);
    expect(document).not.toContain("Arrival");
    expect(document).toContain("Chapter Two");
  });

  it("keeps a part's heading on a page of its own, and leaves the book's title to its page", async () => {
    const paragraphs: Paragraph[] = [
      { kind: "heading", level: 1, runs: [run("Review Novel")] },
      { kind: "heading", level: 2, runs: [run("Part One: Arrival")] },
      { kind: "heading", level: 3, runs: [run("Chapter 1")] },
      { kind: "text", runs: [run("They came.")] },
      { kind: "heading", level: 3, runs: [run("Chapter 2")] },
      { kind: "text", runs: [run("They stayed.")] },
    ];
    const files = await unzip(
      manuscriptDocx(paragraphs, {
        title: "Review Novel",
        byline: "A. Teller",
        contact: "Ann Teller",
        surname: "Teller",
        words: 100,
        chapterLevel: 3,
      }),
    );
    const document = decoder.decode(files.get("word/document.xml"));
    expect(document).toContain("Part One: Arrival");
    expect(document.match(/>Review Novel</g)).toHaveLength(1);
    // The title page its own; the part's page, then each chapter on a page of its own.
    expect(pageStarts(document)).toEqual(["Part One: Arrival", "Chapter 1", "Chapter 2"]);
  });

  it("takes a novel's parts as parts, the headings under them as its chapters", () => {
    const story = parse(
      "---\ntitle: Night\n---\n\n# Part One: Dusk\n\n## The Owl\n\nHoot.\n\n## The Mouse\n\nSqueak.\n\n# Part Two: Dawn\n\n## Morning\n\nLight.\n",
    );
    expect(manuscriptChapterLevel(story)).toBe(2);
    // Chapters with scenes under them: the chapters stay chapters.
    expect(
      manuscriptChapterLevel(parse("# One\n\n## A\n\nX.\n\n## B\n\nY.\n\n# Two\n\n## C\n\nZ.\n")),
    ).toBe(1);
  });

  it("starts a story with no chapters under its byline, with no page of its own", async () => {
    const files = await unzip(
      manuscriptDocx([{ kind: "text", runs: [run("Once.")] }], {
        title: "Short",
        byline: "A. Teller",
        contact: "Ann Teller",
        surname: "Teller",
        words: 1,
      }),
    );
    expect(pageStarts(decoder.decode(files.get("word/document.xml")))).toEqual([]);
  });
});
