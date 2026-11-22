import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { layoutScreenplay } from "../src/studio/layout";

afterEach(() => vi.unstubAllGlobals());
const fixture = "Title: Retry\n\nINT. ROOM\n\n!A fresh font preserves the screenplay.";
const layout = layoutScreenplay(parseFountain(fixture));
const regular = () =>
  readFile(new URL("../src/studio/fonts/CourierPrime-Regular.ttf", import.meta.url));

describe("corrupt embedded-font recovery", () => {
  it.each(["html", "truncated", "late-glyph-table"] as const)(
    "evicts an HTTP200 %s font and exports a real PDF on explicit retry",
    async (kind) => {
      vi.resetModules();
      const { screenplayPdf } = await import("../src/studio/pdf");
      const valid = new Uint8Array(await regular());
      let corrupt: Uint8Array;
      if (kind === "html") corrupt = new TextEncoder().encode("<html>Temporary maintenance</html>");
      else if (kind === "truncated") corrupt = valid.slice(0, 256);
      else {
        corrupt = valid.slice();
        const table = new DataView(corrupt.buffer);
        for (let i = 0; i < table.getUint16(4); i++) {
          const at = 12 + i * 16;
          if (new TextDecoder().decode(corrupt.slice(at, at + 4)) === "glyf") {
            table.setUint32(at + 8, corrupt.length + 1024);
            break;
          }
        }
        // This is not merely an invalid signature. Both initial font creation and
        // character-set validation succeed; glyph data fails when used/subsetted.
        const probe = await PDFDocument.create();
        probe.registerFontkit(fontkit);
        const embedded = await probe.embedFont(corrupt, { subset: true });
        expect(embedded.getCharacterSet()).toContain(65);
      }
      vi.stubGlobal("location", new URL("https://voxdown.test/studio/"));
      let healthy = false;
      const requests: RequestInit[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, options: RequestInit) => {
          requests.push(options);
          return new Response(new Uint8Array(healthy ? valid : corrupt).buffer);
        }),
      );
      await expect(screenplayPdf(layout)).rejects.toThrow(/font could not be read.*fresh copy/);
      expect(requests).toHaveLength(1);
      healthy = true;
      const pdf = await PDFDocument.load(await screenplayPdf(layout, "Retry"));
      expect(pdf.getPageCount()).toBe(layout.pages.length);
      expect(pdf.getTitle()).toBe("Retry");
      expect(requests).toHaveLength(2);
      expect(requests.map((options) => options.cache)).toEqual(["default", "reload"]);
      await screenplayPdf(layout);
      expect(requests).toHaveLength(2);
      expect(layoutScreenplay(parseFountain(fixture))).toEqual(layout);
    },
  );

  it("keeps successfully loaded fonts when only a screenplay glyph is unsupported", async () => {
    vi.resetModules();
    const { screenplayPdf } = await import("../src/studio/pdf");
    vi.stubGlobal("location", new URL("https://voxdown.test/studio/"));
    const bytes = new Uint8Array(await regular());
    const fetch = vi.fn(async () => new Response(bytes.slice().buffer));
    vi.stubGlobal("fetch", fetch);
    await expect(screenplayPdf(layoutScreenplay(parseFountain("!A dragon 🐉.")))).rejects.toThrow(
      /Courier Prime cannot print.*U\+1F409/,
    );
    await screenplayPdf(layout);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
