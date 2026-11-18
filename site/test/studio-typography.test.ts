import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { layoutScreenplay } from "../src/studio/layout";
import { screenplayPdf } from "../src/studio/pdf";
import { prepareActorSides } from "../src/studio/sides";
import { printedTypographyProblem } from "../src/studio/typography";

const layout = (source: string) => layoutScreenplay(parseFountain(source));
afterEach(() => vi.unstubAllGlobals());
function mockFonts() {
  vi.stubGlobal("location", new URL("https://typography.test/studio/"));
  const fetch = vi.fn(async (url: string) => {
    const filename = new URL(url).pathname.split("/").at(-1);
    const bytes = await readFile(new URL(`../src/studio/fonts/${filename}`, import.meta.url));
    return new Response(new Uint8Array(bytes).buffer);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("printed Unicode positioning guard", () => {
  it("detects a font-supported zero-advance mark which presence checks alone miss", async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const bytes = await readFile(
      new URL("../src/studio/fonts/CourierPrime-Regular.ttf", import.meta.url),
    );
    const font = await pdf.embedFont(bytes, { subset: true });
    expect(font.getCharacterSet()).toContain(0x326);
    expect(font.widthOfTextAtSize("\u0326", 12)).toBe(0);
    const result = layout("!s\u0326");
    expect(printedTypographyProblem(result)).toContain("U+0326 (combining mark)");
    expect(result.warnings).toContain(printedTypographyProblem(result));
    expect(result.pages[0]?.lines.map((line) => line.text).join("")).toContain("s\u0326");
    const fetch = mockFonts();
    await expect(screenplayPdf(result)).rejects.toThrow(/U\+0326/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["\u00ad", "\u200d", "\u202e", "\u2066", "\uFEFF"])(
    "warns and refuses printed formatting control %j without silently deleting it",
    async (character) => {
      const result = layout(`!a${character}b`);
      expect(
        result.pages
          .flatMap((page) => page.lines)
          .map((line) => line.text)
          .join(""),
      ).toBe(`a${character}b`);
      expect(printedTypographyProblem(result)).toContain("formatting character");
      await expect(screenplayPdf(result)).rejects.toThrow(/cannot reliably position/);
    },
  );

  it("handles spacing, enclosing and supplementary marks with at most eight distinct diagnostics", () => {
    for (const character of ["\u0903", "\u20dd", "\u{1D165}"])
      expect(printedTypographyProblem(layout(`!x${character}`))).toContain("combining mark");
    const characters = Array.from({ length: 12 }, (_, index) =>
      String.fromCodePoint(0x300 + index),
    );
    const problem = printedTypographyProblem(layout(`!${characters.join("").repeat(100)}`));
    expect(problem?.match(/U\+/g)).toHaveLength(8);
    expect(problem).toContain("…");
    expect(problem?.length).toBeLessThan(600);
  });

  it("does not reveal or reject marks found only in omitted private text or outlines", async () => {
    const source =
      "# Private \u0326\n= Private \u00ad\n\n!A café [[SECRET \u0326]] remains.\n/* HIDDEN \u00ad */";
    const result = layout(source);
    expect(printedTypographyProblem(result)).toBeUndefined();
    expect(result.warnings.join(" ")).not.toMatch(/0326|00AD|SECRET|HIDDEN/);
    mockFonts();
    const bytes = await screenplayPdf(result);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("checks printed titles and scene numbers as well as body runs", () => {
    expect(printedTypographyProblem(layout("Title: s\u0326\n\n!Body"))).toContain("U+0326");
    expect(printedTypographyProblem(layout("INT. ROOM #1\u00ad#\n\n!Body"))).toContain("U+00AD");
  });

  it("rejects actor sides with printed marks but allows precomposed letters and omitted title marks", async () => {
    const bad = prepareActorSides("INT. ROOM\n\n@ADA\nUnreliable s\u0326.").build("ADA");
    expect(bad.warnings.join(" ")).toContain("U+0326");
    await expect(screenplayPdf(bad.layout)).rejects.toThrow(/U\+0326/);
    const good = prepareActorSides(
      "Title: s\u0326\n\nINT. ROOM\n\n@ADA\nA café [[private \u0326]].",
    );
    const packet = good.build("ADA");
    expect(printedTypographyProblem(packet.layout)).toBeUndefined();
    mockFonts();
    expect((await PDFDocument.load(await screenplayPdf(packet.layout))).getPageCount()).toBe(2);
    expect(
      printedTypographyProblem(good.build("ADA", "letter", { includeScriptTitle: true }).layout),
    ).toContain("U+0326");
  });
});
