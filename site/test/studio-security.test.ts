import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { layoutScreenplay } from "../src/studio/layout";
import { screenplayPdf } from "../src/studio/pdf";

afterEach(() => vi.unstubAllGlobals());

describe("Studio export security boundaries", () => {
  it("keeps hostile metadata keys as content without modifying object prototypes", () => {
    const document = parseFountain(
      "__proto__: <script>alert(1)</script>\nconstructor: hostile\nprototype: hostile\nTitle: Safe\n\nINT. ROOM - DAY\n\nVisible.",
    );
    expect(Object.getPrototypeOf(document.title)).toBeNull();
    expect(document.title.__proto__).toBe("<script>alert(1)</script>");
    expect(document.title.constructor).toBe("hostile");
    expect(Object.prototype).not.toHaveProperty("hostile");
    const layout = layoutScreenplay(document);
    expect(layout.exportBlocked).toBe(false);
    expect(layout.pages.flatMap((page) => page.lines).some((line) => line.text === "Safe")).toBe(
      true,
    );
  });

  it("exports hostile source and metadata as passive PDF text with bundled same-origin fonts", async () => {
    const requests: { url: string; options: RequestInit | undefined }[] = [];
    vi.stubGlobal("location", {
      href: "https://studio.example/studio/",
      origin: "https://studio.example",
    });
    vi.stubGlobal("fetch", async (input: string, options?: RequestInit) => {
      const url = new URL(input);
      requests.push({ url: input, options });
      const file = url.pathname.split("/").at(-1);
      if (!file || !/^CourierPrime-(Regular|Bold|Italic|BoldItalic)\.ttf$/.test(file))
        throw new Error("Unexpected font asset");
      return new Response(readFileSync(new URL(`../src/studio/fonts/${file}`, import.meta.url)));
    });
    const title = ") /OpenAction << /S /JavaScript /JS (alert(1)) >> (";
    const source = [
      "INT. ROOM - DAY",
      "",
      "!<script>alert('not executable')</script>",
      "!<img src=https://attacker.invalid/story onerror=alert(1)>",
      "!javascript:alert(1)",
      "!**Bold** *italic* ***both***",
      "[[PRIVATE_SECRET]]",
      "/* PRIVATE_BONEYARD */",
    ].join("\n");
    const layout = layoutScreenplay(parseFountain(source));
    expect(
      layout.pages
        .flatMap((page) => page.lines)
        .map((line) => line.text)
        .join("\n"),
    ).not.toContain("PRIVATE_");
    const pdf = await PDFDocument.load(await screenplayPdf(layout, title));
    expect(pdf.getTitle()).toBe(title);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    // Inspect PDF structure rather than bytes: object streams and text encodings hide names.
    for (const [, object] of pdf.context.enumerateIndirectObjects())
      expect(object.toString()).not.toMatch(
        /\/(?:OpenAction|JavaScript|JS|Launch|URI|EmbeddedFiles|AcroForm|AA)\b/,
      );
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(new URL(request.url).origin).toBe("https://studio.example");
      expect(request.options).toMatchObject({
        mode: "same-origin",
        credentials: "same-origin",
        redirect: "error",
      });
    }
  });
});
