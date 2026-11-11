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
    const { story, left } = await storyOfDocx(written.buffer as ArrayBuffer);
    expect(left).toEqual([]);
    expect(story).toContain("title: The Owl");
    expect(story).toContain("author: A. Teller");
    expect(story).toContain("# One");
    expect(story).toContain("The night was *very* still, and **cold**.\nA second line.");
    expect(story).toContain("* * *");
    expect(story).toContain("“Who’s there?” she asked.");
    // Read back as VoxDown, it reads with no warning.
    expect(parse(story).warnings).toEqual([]);
    // Nothing more: the title page is the story's details, not words to read aloud.
    expect(book(story)).toEqual(book(STORY));
    expect(story).not.toMatch(/^The Owl$/m);
  });

  it("read a title page as the story's title and author, when Word's own record has none", async () => {
    const files = await unzip(docxOf(book(STORY), { title: "The Owl", author: "A. Teller" }));
    files.delete("docProps/core.xml");
    const bare = zip([...files].map(([name, data]) => ({ name, data })));
    const { story } = await storyOfDocx(bare.buffer as ArrayBuffer);
    expect(story).toContain("title: The Owl");
    expect(story).toContain("author: A. Teller");
    expect(book(story)).toEqual(book(STORY));
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
    expect([...files.keys()]).toContain("OEBPS/title.xhtml");
    const { story } = await storyOfEpub(written.buffer as ArrayBuffer);
    // The title page is the story's details: the book read back is the book written.
    expect(book(story)).toEqual(book(STORY));
    expect(story).toContain("title: The Owl");
    expect(story).toContain("# One");
    expect(story).toContain("# Two");
    expect(story).toContain("*very*");
    expect(story.indexOf("# One")).toBeLessThan(story.indexOf("# Two"));
  });
});

/** A Word document as another program writes it: its own styles, inherited, and more. */
function wordFile(body: string, styles: string): ArrayBuffer {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: `<w:document ${W}><w:body>${body}</w:body></w:document>` },
    { name: "word/styles.xml", data: `<w:styles ${W}>${styles}</w:styles>` },
  ]).buffer as ArrayBuffer;
}

describe("Word documents from other programs", () => {
  const styles = `
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="ChapterTitle"><w:name w:val="Chapter Title"/><w:basedOn w:val="Heading1"/></w:style>
    <w:style w:type="paragraph" w:styleId='PartTitle'><w:name w:val='Part'/><w:pPr><w:outlineLvl w:val='0'/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Letter"><w:name w:val="Letter"/><w:rPr><w:i/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b w:val="1"/></w:rPr></w:style>`;

  it("take headings and emphasis from the styles they inherit", async () => {
    const { story, left } = await storyOfDocx(
      wordFile(
        `<w:p><w:pPr><w:pStyle w:val="ChapterTitle"/></w:pPr><w:r><w:t>The Owl</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val='PartTitle'/></w:pPr><w:r><w:t>Part One</w:t></w:r></w:p>
         <w:p><w:r><w:t xml:space="preserve">It was </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>very</w:t></w:r><w:r><w:t xml:space="preserve"> still, and </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>cold</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val="Letter"/></w:pPr><w:r><w:t xml:space="preserve">Dear Tom, </w:t></w:r><w:r><w:rPr><w:i w:val="0"/></w:rPr><w:t>come</w:t></w:r></w:p>
         <w:tbl><w:tr><w:tc><w:p><w:r><w:t>In a table.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
         <w:p><w:r><w:drawing/></w:r><w:r><w:t>After a picture.</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`,
        styles,
      ),
    );
    expect(story).toContain("# The Owl\n");
    expect(story).toContain("# Part One\n");
    expect(story).not.toContain("**The Owl**");
    expect(story).toContain("It was *very* still, and **cold**.");
    expect(story).toContain("*Dear Tom,* come");
    expect(story).toContain("In a table.");
    expect(left).toEqual(["tables (their text is kept, as paragraphs)", "pictures", "footnotes"]);
  });

  it("with no text, say so rather than open empty", async () => {
    await expect(storyOfDocx(wordFile("<w:p/>", ""))).rejects.toThrow("No text could be read");
  });
});

/** An ebook as another program writes it: its quotes and prefixes its own. */
function ebookFile(options: {
  container: string;
  opf: string;
  pages?: Record<string, string>;
}): ArrayBuffer {
  return zip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: options.container },
    { name: "OPS/package.opf", data: options.opf },
    ...Object.entries(options.pages ?? {}).map(([name, data]) => ({ name: `OPS/${name}`, data })),
  ]).buffer as ArrayBuffer;
}

describe("ebooks from other programs", () => {
  const page = (body: string) =>
    `<?xml version='1.0' encoding='utf-8'?><html xmlns='http://www.w3.org/1999/xhtml'><head><title>x</title></head><body>${body}</body></html>`;

  it("are read whatever their quotes and namespace prefixes", async () => {
    for (const container of [
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      `<container version='1.0'><rootfiles><rootfile full-path='OPS/package.opf' media-type='application/oebps-package+xml'/></rootfiles></container>`,
    ]) {
      const { story, left } = await storyOfEpub(
        ebookFile({
          container,
          opf: `<opf:package xmlns:opf='http://www.idpf.org/2007/opf' xmlns:dc='http://purl.org/dc/elements/1.1/'>
            <opf:metadata><dc:title>Two Rooms</dc:title><dc:creator opf:role='aut'>A. Teller</dc:creator></opf:metadata>
            <opf:manifest>
              <opf:item id='c1' href='one.xhtml' media-type='application/xhtml+xml'/>
              <opf:item id='c2' href='two%20b.xhtml' media-type='application/xhtml+xml'/>
              <opf:item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/>
            </opf:manifest>
            <opf:spine toc='ncx'><opf:itemref idref='c1'/><opf:itemref idref='c2'/></opf:spine>
          </opf:package>`,
          pages: {
            "one.xhtml": page("<h1>One</h1><p>The first room.</p>"),
            "two b.xhtml": page("<h1>Two</h1><p>The <em>second</em> room.</p><img src='x.png'/>"),
          },
        }),
      );
      expect(story).toContain("title: Two Rooms");
      expect(story).toContain("author: A. Teller");
      expect(story).toContain("# One\n\nThe first room.\n\n# Two\n\nThe *second* room.");
      expect(left).toEqual(["pictures"]);
    }
  });

  it("whose chapters can't be found say so, rather than open empty", async () => {
    const container = `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`;
    await expect(
      storyOfEpub(
        ebookFile({
          container,
          opf: `<package><manifest><item id="c1" href="gone.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
        }),
      ),
    ).rejects.toThrow("None of this ebook's chapters could be read.");
    await expect(storyOfEpub(ebookFile({ container: "<container/>", opf: "" }))).rejects.toThrow(
      "This isn’t an ebook",
    );
  });
});

describe("Word documents as Word writes them", () => {
  it("keep words Word splits, tabs, hyphens and scene breaks; leave text boxes out, saying so", async () => {
    const { story, left } = await storyOfDocx(
      wordFile(
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Drag</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">ons </w:t></w:r><w:r><w:t>are </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ve</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ry</w:t></w:r><w:r><w:t> old.</w:t></w:r></w:p>
         <w:p><w:r><w:t>Line two</w:t><w:tab/><w:t>tabbed, well</w:t><w:noBreakHyphen/><w:t>known.</w:t></w:r></w:p>
         <w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Boxed text.</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>Boxed text.</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>Beside the box.</w:t></w:r></w:p>
         <w:p><w:r><w:t>After box.</w:t></w:r></w:p>
         <w:p><w:r><w:t>#</w:t></w:r></w:p>
         <w:p><w:r><w:t>Next scene.</w:t></w:r></w:p>`,
        "",
      ),
    );
    expect(story).toContain("*Dragons* are **very** old.");
    expect(story).toContain("Line two tabbed, well-known.");
    expect(story).not.toContain("Boxed text.");
    expect(story).toContain("Beside the box.\n\nAfter box.");
    expect(story).toContain("After box.\n\n* * *\n\nNext scene.");
    expect(left).toEqual(["pictures", "text boxes"]);
  });
});

describe("ebooks' text, wherever it is", () => {
  const page = (body: string) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

  it("is read from any block that holds it, verse with its lines", async () => {
    const { story } = await storyOfEpub(
      ebookFile({
        container: `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
        opf: `<package><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
        pages: {
          "one.xhtml": page(`<h1>One</h1>
            <p>A paragraph.</p>
            <div>A paragraph in a div.</div>
            <blockquote>A quotation, <em>quoted</em>.</blockquote>
            <section>Text in a section.<p>And a paragraph in it.</p>More after it.</section>
            <div class="poem"><div class="stanza"><span>The first line,</span><br/><span>the second line.</span></div></div>
            <table><tr><td>In a cell.</td></tr></table>
            <pre>Kept
  as written.</pre>
            <p class="center">* * *</p>
            <p>The end.</p>`),
        },
      }),
    );
    for (const words of [
      "A paragraph.",
      "A paragraph in a div.",
      "A quotation, *quoted*.",
      "Text in a section.\n\nAnd a paragraph in it.\n\nMore after it.",
      "The first line,\nthe second line.",
      "In a cell.",
      "Kept\nas written.",
      "* * *\n\nThe end.",
    ])
      expect(story).toContain(words);
  });
});

describe("a book written as Word", () => {
  it("has no space at the start of a line after a line break", () => {
    const html = renderBook(parse("Bang.\nClank.\n"));
    const root = new DOMParser().parseFromString(html, "text/html").body;
    const [paragraph] = paragraphsOf(root);
    expect(paragraph).toEqual({
      kind: "text",
      runs: [
        { text: "Bang.", italic: false, bold: false },
        { lineBreak: true },
        { text: "Clank.", italic: false, bold: false },
      ],
    });
  });
});

describe("ebooks with chapters missing, and emphasis in their style sheets", () => {
  const page = (body: string, head = "") =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title>${head}</head><body>${body}</body></html>`;
  const container = `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`;

  it("say which chapters couldn't be read, and read the rest", async () => {
    const read = await storyOfEpub(
      ebookFile({
        container,
        opf: `<package><manifest>
          <item id="cover" href="cover.svg" media-type="image/svg+xml"/>
          <item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="gone"/></spine></package>`,
        pages: { "one.xhtml": page("<p>The first chapter.</p>") },
      }),
    );
    expect(read.story).toContain("The first chapter.");
    expect(read.missing).toEqual(["two.xhtml", "gone"]);
    expect(read.chapters).toBe(3);
  });

  it("keep italics and bold set by style sheets, classes and style attributes", async () => {
    const { story } = await storyOfEpub(
      ebookFile({
        container,
        opf: `<package><manifest>
          <item id="css" href="style.css" media-type="text/css"/>
          <item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine><itemref idref="c1"/></spine></package>`,
        pages: {
          "style.css":
            ".calibre3 { font-style: italic } span.loud, .strong { font-weight: 700 } .plain { font-style: normal }",
          "one.xhtml": page(
            `<p style="font-style:italic">A letter, all in italics.</p>
             <p>A <span class="calibre3">quiet</span> and <span class="loud">loud</span> word.</p>
             <div class="calibre3">Italic, but <span class="plain">not this.</span></div>
             <p class="note">From its own sheet.</p>`,
            "<style>.note { font: italic bold 1em serif }</style>",
          ),
        },
      }),
    );
    expect(story).toContain("*A letter, all in italics.*");
    expect(story).toContain("A *quiet* and **loud** word.");
    expect(story).toContain("*Italic, but* not this.");
    expect(story).toContain("***From its own sheet.***");
  });
});

describe("imports, written as a story", () => {
  it("leave numbers and dashes at a line's start as they are: a story has no lists", () => {
    expect(
      writeRuns([{ text: "1. Not a list - and > not a quote", italic: false, bold: false }]),
    ).toBe("1. Not a list - and > not a quote");
    expect(writeRuns([{ text: "---", italic: false, bold: false }])).toBe("\\---");
    expect(writeRuns([{ text: "::: not a group", italic: false, bold: false }])).toBe(
      "\\::: not a group",
    );
  });

  it("leave notes, their numbers and ruby out, and keep verse lines shown as blocks", async () => {
    const page = (body: string, head = "") =>
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title>${head}</head><body>${body}</body></html>`;
    const { story, left } = await storyOfEpub(
      ebookFile({
        container: `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
        opf: `<package><manifest>
          <item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/>
          <item id="n" href="notes.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine><itemref idref="c1"/><itemref idref="n" linear="no"/></spine></package>`,
        pages: {
          "one.xhtml": page(
            `<p>It was a <em>dark</em> night<a epub:type="noteref" href="notes.xhtml#n1">1</a>.</p>
             <aside epub:type="footnote" id="n1"><p>A note.</p></aside>
             <p><ruby>漢<rt>kan</rt>字<rt>ji</rt></ruby> written.</p>
             <div class="stanza"><span class="line">Twinkle twinkle,</span><span class="line">little star.</span></div>`,
            "<style>.line { display: block }</style>",
          ),
          "notes.xhtml": page("<p>1. The notes.</p>"),
        },
      }),
    );
    expect(story).toContain("It was a *dark* night.");
    expect(story).not.toContain("A note.");
    expect(story).not.toContain("The notes.");
    expect(story).toContain("漢字 written.");
    expect(story).toContain("Twinkle twinkle,\nlittle star.");
    expect(left).toEqual([
      "notes and their numbers",
      "1 page outside the reading order (notes and the like)",
    ]);
  });

  it("from Word, say list numbering was left out, and give a heading after a page break one space", async () => {
    const { story, left } = await storyOfDocx(
      wordFile(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:br w:type="page"/></w:r><w:r><w:t>Chapter One</w:t></w:r></w:p>
         <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>A step.</w:t></w:r></w:p>
         <w:p><w:r><w:t xml:space="preserve">A </w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F0E0"/></w:r><w:r><w:t xml:space="preserve"> symbol.</w:t></w:r></w:p>`,
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>`,
      ),
    );
    expect(story).toContain("# Chapter One\n");
    expect(story).toContain("A symbol.");
    expect(left).toEqual(["list numbering", "symbols from symbol fonts"]);
  });
});
