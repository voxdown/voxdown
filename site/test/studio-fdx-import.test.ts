import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportFdx } from "../src/studio/fdx";
import type { importFdx } from "../src/studio/fdx-import";
import { parseFountain } from "../src/studio/fountain";
import { fountainRuns } from "../src/studio/inline";
declare global {
  interface Window {
    importFdx: typeof importFdx;
  }
}
const modules = new Map<string, string>();
function compile(name: string): string {
  const found = modules.get(name);
  if (found) return found;
  const js = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
  ).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dep: string) => JSON.stringify(compile(dep)));
  const result = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
  modules.set(name, result);
  return result;
}
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.addScriptTag({
    type: "module",
    content: `import {importFdx} from ${JSON.stringify(compile("fdx-import"))};window.importFdx=importFdx;`,
  });
  await page.waitForFunction(() => !!window.importFdx);
});
afterAll(async () => browser.close());
const body = (value: string, extra = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><FinalDraft DocumentType="Script"><Content>${value}</Content>${extra}</FinalDraft>`;
const p = (type: string, text: string, attrs = "") =>
  `<Paragraph Type="${type}"${attrs}><Text>${text}</Text></Paragraph>`;
async function convert(xml: string) {
  return page.evaluate((xml) => window.importFdx(new TextEncoder().encode(xml)), xml);
}
async function failure(xml: string) {
  return page.evaluate((xml) => {
    try {
      window.importFdx(new TextEncoder().encode(xml));
      return "accepted";
    } catch (error) {
      return String(error);
    }
  }, xml);
}
function visible(source: string) {
  return parseFountain(source)
    .elements.filter(
      (e) => !["blank", "title", "note", "boneyard", "section", "synopsis"].includes(e.kind),
    )
    .map((e) => ({
      kind: e.kind,
      text: fountainRuns(e.text)
        .map((r) => r.text)
        .join(""),
      number: e.sceneNumber,
      dual: e.dual,
    }));
}
describe("strict browser FDX import", () => {
  it("imports supported body/Unicode/scene numbers/styles and excludes title/contact/private metadata", async () => {
    const source =
      "Title: Secret title\nContact: secret@example.test\n\nINT. CAFÉ - DAY #12A#\n\n!An **important** *quiet* _underlined_ ***both*** café.\n\n@MARA (V.O.)\n(softly)\nHello & 世界 😀.\nNext line.\n\n> CUT TO:";
    const result = await convert(exportFdx(source).xml);
    expect(visible(result.source)).toEqual(visible(source));
    expect(result.source).not.toContain("secret");
    expect(result.report.join(" ")).not.toContain("secret@example");
    expect(result.source).toContain("**important**");
    expect(result.paragraphs).toBe(6);
  });
  it("imports complete dual-dialogue pairs and keeps later ordinary speeches separate", async () => {
    const source = "@MARA\nLeft.\n\n@JONAH ^\n(softly)\nRight.\n\n@OTHER\nAfter.";
    const result = await convert(exportFdx(source).xml);
    expect(visible(result.source)).toEqual(visible(source));
    expect(result.dualPairs).toBe(1);
  });
  it("escapes literal private/Fountain syntax and markup instead of activating it", async () => {
    const literal =
      "[[not a note]] /*not omitted*/ **not bold** _not underlined_ \\ @ ! &lt;script&gt;alert(1)&lt;/script&gt;";
    const result = await convert(
      body(p("Action", literal) + p("Character", "MARA^") + p("Dialogue", literal)),
    );
    const parsed = parseFountain(result.source);
    expect(parsed.omissions).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(visible(result.source)[0]?.text).toBe(
      literal.replaceAll("&lt;", "<").replaceAll("&gt;", ">"),
    );
    expect(visible(result.source)[1]?.text).toBe("MARA^");
    expect(parsed.elements.some((e) => e.dual)).toBe(false);
  });
  it("reports style/layout loss without leaking excluded script notes or metadata", async () => {
    const result = await convert(
      body(
        '<Paragraph Type="Action" LeftIndent="2"><Text Style="Bold+Strikeout" Font="Courier">Hello</Text><ScriptNotes><ScriptNote>PRIVATE</ScriptNote></ScriptNotes></Paragraph>',
        "<TitlePage><Content><Paragraph><Text>CONTACT</Text></Paragraph></Content></TitlePage><TagData><Text>PRIVATE TAG</Text></TagData>",
      ),
    );
    expect(result.source).toBe("!**Hello**");
    expect(result.report.join(" ")).toContain("1 unsupported text style");
    expect(result.report.join(" ")).toContain("3 title-page");
    expect(result.report.join(" ")).not.toMatch(/PRIVATE|CONTACT/);
  });
  it("handles multiline action/dialogue and intentional empty dialogue lines", async () => {
    const result = await convert(
      body(p("Action", "First\n\nLast") + p("Character", "MARA") + p("Dialogue", "Hello\n\nAgain")),
    );
    expect(visible(result.source).map((e) => e.text)).toEqual([
      "First",
      "",
      "Last",
      "MARA",
      "Hello",
      "",
      "Again",
    ]);
  });
  it("retains centered action and safely simplifies styled scene headings with a report", async () => {
    const result = await convert(
      body(
        `<Paragraph Type="Scene Heading"><Text Style="Bold">INT. ROOM</Text></Paragraph>${p("Action", "Centered", ' Alignment="Center"')}`,
      ),
    );
    expect(visible(result.source).map((e) => e.kind)).toEqual(["scene", "centered"]);
    expect(result.report.join(" ")).toContain("1 lines simplified");
  });
  it.each([
    [
      `<!DOCTYPE FinalDraft SYSTEM "https://attacker.test/private">${body(p("Action", "Text"))}`,
      /declarations/,
    ],
    [`<!DOCTYPE x [<!ENTITY x "secret">]>${body(p("Action", "&x;"))}`, /declarations/],
    [body(p("Action", "<![CDATA[private]]>")), /CDATA/],
    [`${body(p("Action", "x"))}<?xml-stylesheet href="https://attacker.test"?>`, /processing/],
    [body(p("Action", "&custom;")), /malformed/],
    [body(p("Action", "Text")).replace('encoding="UTF-8"', 'encoding="UTF-16"'), /UTF-8/],
    [body(p("Action", "Text")).replace('DocumentType="Script"', 'DocumentType="Novel"'), /Script/],
    [
      body(
        '<Paragraph Type="Action"><Text><Image src="https://attacker.test"/></Text></Paragraph>',
      ),
      /Unsupported/,
    ],
    [body(p("Action", "Text"), "<Unknown>data</Unknown>"), /unsupported top-level/],
    [body(p("Shot", "PAN LEFT")), /unsupported paragraph/],
    [body(p("Dialogue", "Orphan")), /no preceding/],
    [body(p("Character", "MARA")), /no dialogue/],
    [body(p("Scene Heading", "(somewhere)")), /heading cannot/],
    [body(p("Scene Heading", "INT. ROOM", ' Number="1 #bad#"')), /scene number/],
    [body(p("Action", "Text", ' Hidden="Yes"')), /Unsupported attribute/],
    [body(p("Character", "MARA") + p("Dialogue", "= not a synopsis")), /cannot retain/],
    [body(p("Action", "Text")).replace("<Content>", '<Content xmlns="urn:test">'), /Namespaced/],
  ])(
    "rejects unsafe or unsupported structure without returning partial source %#",
    async (xml, pattern) => {
      expect(await failure(xml as string)).toMatch(pattern as RegExp);
    },
  );
  it("reports parenthetical style simplification while preserving its role and visible text", async () => {
    const result = await convert(
      body(
        `${p("Character", "MARA")}<Paragraph Type="Parenthetical"><Text Style="Italic">(softly)</Text></Paragraph>${p("Dialogue", "Hello")}`,
      ),
    );
    expect(visible(result.source).map((e) => e.kind)).toEqual([
      "character",
      "parenthetical",
      "dialogue",
    ]);
    expect(visible(result.source)[1]?.text).toBe("(softly)");
    expect(result.report.join(" ")).toContain("1 lines simplified");
  });
  it("requires valid UTF-8 bytes and enforces byte/XML/depth/source bounds", async () => {
    expect(
      await page.evaluate(() => {
        try {
          window.importFdx(new Uint8Array([0xff]));
          return "accepted";
        } catch (e) {
          return String(e);
        }
      }),
    ).toMatch(/valid UTF-8/);
    expect(
      await page.evaluate(() => {
        try {
          window.importFdx(new Uint8Array(8_000_001));
          return "accepted";
        } catch (e) {
          return String(e);
        }
      }),
    ).toMatch(/8 MB/);
    expect(
      await failure(
        body(p("Action", "x"), `<TagData>${"<X>".repeat(20)}${"</X>".repeat(20)}</TagData>`),
      ),
    ).toMatch(/structure limits/);
    expect(
      await failure(body(p("Action", "x"), `<TagData>${"<X/>".repeat(60000)}</TagData>`)),
    ).toMatch(/too many/);
    expect(await failure(body(p("Action", "x".repeat(500001))))).toMatch(/500,000/);
  });
  it("does not issue requests for inert URL-like imported text", async () => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const result = await convert(
      body(p("Action", "https://attacker.test/image.png &lt;img src='https://attacker.test'&gt;")),
    );
    expect(visible(result.source)[0]?.text).toContain("https://attacker.test");
    expect(requests).toEqual([]);
  });
});
