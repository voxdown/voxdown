import { describe, expect, it } from "vitest";
import type { Paragraph } from "../src/writer/convert";
import { headerWord, manuscriptDocx, wordsAbout } from "../src/writer/manuscript";
import { unzip } from "../src/writer/zip";

const decoder = new TextDecoder();
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
    expect(document.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
    expect(document).toContain(">END</w:t>");
    expect(header).toContain("Teller / OWL / ");
    expect(header).toContain(" PAGE ");
  });
});
