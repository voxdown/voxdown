// @vitest-environment happy-dom
import { deflateRawSync } from "node:zlib";
import { renderBook } from "@voxdown/render";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { escapeText, paragraphsOf, writeRuns, writeStory } from "../src/writer/convert";
import { docxOf, storyOfDocx } from "../src/writer/docx";
import { epubOf, storyOfEpub } from "../src/writer/epub";
import { crc32, unzip, zip } from "../src/writer/zip";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A zip with one deflated file, as Word and most tools write them. */
function deflatedZip(name: string, text: string): Uint8Array {
  const data = encoder.encode(text);
  const packed = new Uint8Array(deflateRawSync(data));
  const nameBytes = encoder.encode(name);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint32(14, crc32(data), true);
  local.setUint32(18, packed.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, 8, true);
  central.setUint32(20, packed.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, nameBytes.length, true);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, 30 + nameBytes.length + packed.length, true);
  const parts = [
    new Uint8Array(local.buffer),
    nameBytes,
    packed,
    new Uint8Array(central.buffer),
    nameBytes,
    new Uint8Array(end.buffer),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("zip files", () => {
  it("are written and read back, stored and deflated", async () => {
    const written = zip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "dir/été.txt", data: "Café" },
    ]);
    const read = await unzip(written);
    expect(decoder.decode(read.get("mimetype"))).toBe("application/epub+zip");
    expect(decoder.decode(read.get("dir/été.txt"))).toBe("Café");
    // An ebook's first file, stored, its name at a fixed place.
    expect(decoder.decode(written.subarray(30, 38))).toBe("mimetype");
    const deflated = await unzip(deflatedZip("word/document.xml", "<w:p>Hello</w:p>".repeat(50)));
    expect(decoder.decode(deflated.get("word/document.xml"))).toContain("<w:p>Hello</w:p>");
  });

  it("say so when they aren't zip files", async () => {
    await expect(unzip(encoder.encode("not a zip"))).rejects.toThrow("zip");
  });
});

describe("a story's text from other documents", () => {
  it("escapes signs that would read as marks, and keeps emphasis as signs", () => {
    expect(escapeText("mail@example.com [1] {note} 50%% *star*")).toBe(
      "mail\\@example.com \\[1] \\{note} 50\\%% \\*star\\*",
    );
    expect(
      writeRuns([
        { text: "A ", italic: false, bold: false },
        { text: "quiet ", italic: true, bold: false },
        { text: "word", italic: false, bold: true },
        { lineBreak: true },
        { text: "# not a heading", italic: false, bold: false },
      ]),
    ).toBe("A *quiet* **word**\n\\# not a heading");
    expect(writeStory([], { title: "A: B" })).toContain('title: "A: B"');
  });
});

/** The book of an example, as paragraphs. */
function book(source: string) {
  const html = renderBook(parse(source));
  const root = new DOMParser().parseFromString(html, "text/html").body;
  return paragraphsOf(root);
}

const STORY = `---
title: The Owl
author: A. Teller
language: en-GB
---

# One

The night was *very* still, and **cold**.
A second line.

* * *

# Two

@Ann “Who’s there?” she asked.
`;

describe("Word documents", () => {
  it("are written from a story's book and read back as a story", async () => {
    const paragraphs = book(STORY);
    const written = docxOf(paragraphs, {
      title: "The Owl",
      author: "A. Teller",
      language: "en-GB",
    });
    const files = await unzip(written);
    expect([...files.keys()]).toContain("word/document.xml");
    const story = await storyOfDocx(written.buffer as ArrayBuffer);
    expect(story).toContain("title: The Owl");
    expect(story).toContain("author: A. Teller");
    expect(story).toContain("# One");
    expect(story).toContain("The night was *very* still, and **cold**.\nA second line.");
    expect(story).toContain("* * *");
    expect(story).toContain("“Who’s there?” she asked.");
    // Read back as VoxDown, it reads with no warning.
    expect(parse(story).warnings).toEqual([]);
  });
});

describe("ebooks", () => {
  it("are written a chapter to a heading, and read back as a story", async () => {
    const paragraphs = book(STORY);
    const written = epubOf(paragraphs, {
      title: "The Owl",
      author: "A. Teller",
      language: "en-GB",
      id: "00000000-0000-4000-8000-000000000000",
      when: new Date("2026-11-11T00:00:00Z"),
    });
    const files = await unzip(written);
    expect(decoder.decode(files.get("mimetype"))).toBe("application/epub+zip");
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(["OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml", "OEBPS/nav.xhtml"]),
    );
    const story = await storyOfEpub(written.buffer as ArrayBuffer);
    expect(story).toContain("title: The Owl");
    expect(story).toContain("# One");
    expect(story).toContain("# Two");
    expect(story).toContain("*very*");
    expect(story.indexOf("# One")).toBeLessThan(story.indexOf("# Two"));
  });
});
