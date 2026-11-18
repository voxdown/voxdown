import { type Browser, type Page, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_FDX_BYTES, exportFdx } from "../src/studio/fdx";
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
afterAll(async () => {
  await browser.close();
});
async function parse(xml: string) {
  return page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return {
      errors: doc.querySelectorAll("parsererror").length,
      root: doc.documentElement.tagName,
      body: [...doc.querySelectorAll("FinalDraft > Content > Paragraph")].map((p) => ({
        type: p.getAttribute("Type"),
        text: p.textContent,
        number: p.getAttribute("Number"),
        alignment: p.getAttribute("Alignment"),
      })),
      dual: [...doc.querySelectorAll("DualDialogue")].map((p) =>
        [...p.children].map((child) => ({
          type: child.getAttribute("Type"),
          text: child.textContent,
        })),
      ),
      runs: [...doc.querySelectorAll("Text")].map((t) => ({
        text: t.textContent,
        style: t.getAttribute("Style"),
      })),
      title: doc.querySelector("TitlePage")?.textContent ?? "",
      text: doc.documentElement.textContent ?? "",
      scripts: doc.querySelectorAll("script, img, ENTITY, DOCTYPE").length,
      doctype: doc.doctype?.name ?? null,
    };
  }, xml);
}
describe("conservative FDX export", () => {
  it("writes independent-parser-valid UTF-8 typed XML with scene numbers and styled runs", async () => {
    const source =
      "Title: Café 😀\nAuthor: Writer\nContact: author@example.test\n\nINT. CAFÉ - DAY #12A#\n\n!An **important** *quiet* _underlined_ ***both*** café.\n\n@MARA (V.O.)\n(softly)\nHello & 世界 😀.\nNext line.\n\n> CUT TO:";
    const result = exportFdx(source);
    const doc = await parse(result.xml);
    expect(doc.errors).toBe(0);
    expect(doc.root).toBe("FinalDraft");
    expect(doc.body[0]).toMatchObject({
      type: "Scene Heading",
      number: "12A",
      text: "INT. CAFÉ - DAY",
    });
    expect(doc.body.map((p) => p.type)).toEqual([
      "Scene Heading",
      "Action",
      "Character",
      "Parenthetical",
      "Dialogue",
      "Transition",
    ]);
    expect(doc.body[4]?.text).toBe("Hello & 世界 😀.\nNext line.");
    expect(doc.runs).toEqual(
      expect.arrayContaining([
        { text: "important", style: "Bold" },
        { text: "quiet", style: "Italic" },
        { text: "underlined", style: "Underline" },
        { text: "both", style: "Bold+Italic" },
      ]),
    );
    expect(doc.title).toContain("Café 😀");
    expect(doc.title).toContain("author@example.test");
    expect(result.bytes).toBe(new TextEncoder().encode(result.xml).byteLength);
    expect(new TextDecoder().decode(new TextEncoder().encode(result.xml))).toBe(result.xml);
  });
  it("wraps exactly two speeches in linked dual dialogue without leaking intervening notes", async () => {
    const result = exportFdx(
      "@MARA\nLeft.\n\n[[PRIVATE]]\n@JONAH ^\n(softly)\nRight.\n\n@ELSE\nAfter.",
    );
    const doc = await parse(result.xml);
    expect(doc.errors).toBe(0);
    expect(result.dualPairs).toBe(1);
    expect(doc.dual[0]?.map((p) => p.type)).toEqual([
      "Character",
      "Dialogue",
      "Character",
      "Parenthetical",
      "Dialogue",
    ]);
    expect(doc.dual[0]?.map((p) => p.text)).toEqual([
      "MARA",
      "Left.",
      "JONAH",
      "(softly)",
      "Right.",
    ]);
    expect(result.xml).not.toContain("PRIVATE");
    expect(doc.body.at(-1)?.text).toBe("After.");
  });
  it("keeps intentional blank dialogue and ordinary action paragraph boundaries", async () => {
    const doc = await parse(
      exportFdx("!First action.\nContinues.\n\n!Second action.\n\n@MARA\nFirst.\n  \nThird.").xml,
    );
    expect(doc.body.map((paragraph) => [paragraph.type, paragraph.text])).toEqual([
      ["Action", "First action.\nContinues."],
      ["Action", "Second action."],
      ["Character", "MARA"],
      ["Dialogue", "First.\n\nThird."],
    ]);
  });
  it.each(["INT. ROOM - DAY", "!An action interrupts.", "==="])(
    "does not link dual dialogue across a structural boundary: %s",
    async (boundary) => {
      const result = exportFdx(`@MARA\nLeft.\n\n${boundary}\n\n@JON ^\nRight.`);
      expect(result.dualPairs).toBe(0);
      expect((await parse(result.xml)).dual).toEqual([]);
      expect(result.report.join(" ")).toContain("1 unpaired dual-dialogue cues");
    },
  );
  it("pairs a dual chain once and retains the remaining unpaired speech", async () => {
    const result = exportFdx("@MARA\nLeft.\n\n@JON ^\nRight.\n\n@ELSE ^\nLast.");
    const doc = await parse(result.xml);
    expect(result.dualPairs).toBe(1);
    expect(doc.dual[0]?.map((paragraph) => paragraph.text)).toEqual([
      "MARA",
      "Left.",
      "JON",
      "Right.",
    ]);
    expect(doc.body.slice(-2).map((paragraph) => paragraph.text)).toEqual(["ELSE", "Last."]);
    expect(result.report.join(" ")).toContain("1 unpaired dual-dialogue cues");
  });
  it("excludes private text from inline elements, title fields and scene numbers", async () => {
    const result = exportFdx(
      "Title: Safe [[PRIVATE TITLE]]\nContact: public [[PRIVATE CONTACT]]\nCustom: PRIVATE CUSTOM\n\n# PRIVATE OUTLINE\n= PRIVATE SUMMARY\n\nINT. ROOM [[PRIVATE HEADING]] #1#\n\n!A [[PRIVATE INLINE]] B.\n/*PRIVATE BLOCK\nINT. SECRET\n*/\n@MARA\nSaid [[PRIVATE SPEECH]].",
    );
    const doc = await parse(result.xml);
    expect(doc.errors).toBe(0);
    expect(result.xml).not.toContain("PRIVATE");
    expect(doc.text).not.toContain("SECRET");
    expect(result.report.join(" ")).not.toContain("PRIVATE");
    expect(result.report.join(" ")).toContain("1 unrecognized title-page fields omitted");
  });
  it.each([
    "!Public [[PRIVATE [[NESTED]] PRIVATE TAIL]]",
    "!Public /*PRIVATE /*NESTED*/ PRIVATE TAIL*/",
    "!Public /*PRIVATE [[NESTED]]*/",
  ])("rejects ambiguous nested comments without producing a file: %s", (source) => {
    expect(() => exportFdx(source)).toThrow(/Nested private/);
  });
  it.each(["!Public [[PRIVATE", "!Public /*PRIVATE"])(
    "blocks malformed private syntax: %s",
    (source) => {
      expect(() => exportFdx(source)).toThrow(/unfinished private/);
    },
  );
  it("escapes hostile text and attribute payloads without creating XML nodes or entities", async () => {
    const result = exportFdx(
      'INT. ROOM #1" injected="yes#\n\n!<script>alert("x")</script> & <!DOCTYPE x [<!ENTITY steal SYSTEM "file:///private">]>',
    );
    const doc = await parse(result.xml);
    expect(doc.errors).toBe(0);
    expect(doc.scripts).toBe(0);
    expect(doc.doctype).toBeNull();
    // Invalid scene-number syntax stays literal text, never an XML attribute.
    expect(doc.body[0]?.number).toBeNull();
    expect(doc.body[0]?.text).toContain('1" injected="yes');
    expect(doc.body[1]?.text).toContain('<script>alert("x")</script>');
    expect(result.xml).toContain("&lt;!ENTITY");
  });
  it("excludes all title metadata when requested and reports lossy conversions", async () => {
    const result = exportFdx(
      "Title: Hidden title\nContact: Hidden contact\n\n> Centered <\n\n~Sung words\n\n===\n\n@ALONE ^\nSpeech.",
      { includeTitle: false },
    );
    const doc = await parse(result.xml);
    expect(doc.title).toBe("");
    expect(result.xml).not.toContain("Hidden");
    expect(doc.body[0]).toMatchObject({ type: "Action", alignment: "Center", text: "Centered" });
    expect(result.report.join(" ")).toMatch(/page breaks omitted/);
    expect(result.report.join(" ")).toMatch(/lyric lines converted/);
    expect(result.report.join(" ")).toMatch(/unpaired dual-dialogue/);
    expect(result.report.join(" ")).toMatch(/Pagination, paper size/);
  });
  it.each(["\u0001", "\uD800", "\uDC00", "\uFFFE", "\uFFFF"])(
    "rejects printable XML-invalid code point %j",
    (value) => {
      expect(() => exportFdx(`!${value}`)).toThrow(/XML cannot represent/);
    },
  );
  it("supports max-size source and limits line and source size without mutation", async () => {
    const source = `!${"x".repeat(499999)}`;
    const result = exportFdx(source);
    expect(result.bytes).toBeLessThan(MAX_FDX_BYTES);
    expect((await parse(result.xml)).body[0]?.text?.length).toBe(499999);
    expect(() => exportFdx(`${source}x`)).toThrow(/500,000/);
    expect(() => exportFdx("\n".repeat(20000))).toThrow(/20,000/);
    expect(() => exportFdx("!binary\0")).toThrow(/binary/);
  });
  it("accepts BOM/mixed line endings without changing caller source", async () => {
    const source = "\uFEFF!One\r\nTwo\r\n\r@MARA\nHello.";
    const original = source;
    const result = exportFdx(source);
    expect((await parse(result.xml)).errors).toBe(0);
    expect(source).toBe(original);
  });
});
