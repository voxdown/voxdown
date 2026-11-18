import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, rgb } from "pdf-lib";
import boldUrl from "./fonts/CourierPrime-Bold.ttf?url";
import boldItalicUrl from "./fonts/CourierPrime-BoldItalic.ttf?url";
import italicUrl from "./fonts/CourierPrime-Italic.ttf?url";
import regularUrl from "./fonts/CourierPrime-Regular.ttf?url";
import type { FountainRun } from "./inline";
import { SCREENPLAY_FONT_SIZE, SCREENPLAY_PITCH, type ScreenplayLayout } from "./layout";

const urls = { regular: regularUrl, bold: boldUrl, italic: italicUrl, boldItalic: boldItalicUrl };
type Face = keyof typeof urls;
/** One cache per loader; the deadline includes headers and the complete body.
 * A failed response is evicted so an explicit export retry can start fresh. */
export function createFontLoader(timeoutMs = 15_000): (path: string) => Promise<Uint8Array> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("The font timeout must be a positive finite duration.");
  const fontBytes = new Map<string, Promise<Uint8Array>>();
  return function load(path: string): Promise<Uint8Array> {
    const url = new URL(path, globalThis.location.href);
    if (url.origin !== globalThis.location.origin)
      return Promise.reject(
        new Error(
          "The screenplay font must be loaded from this site. Reload Studio and try again.",
        ),
      );
    const cached = fontBytes.get(url.href);
    if (cached) return cached;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const loading = Promise.resolve().then(async () => {
      try {
        const response = await fetch(url.href, {
          mode: "same-origin",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Font response was unsuccessful.");
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        controller.abort();
        fontBytes.delete(url.href);
        throw new Error(
          timedOut
            ? "The screenplay font download timed out. Check your connection and try Export PDF again. Your screenplay is unchanged."
            : "The screenplay font could not be loaded. Check your connection and try exporting again. Your screenplay is unchanged.",
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
    });
    fontBytes.set(url.href, loading);
    return loading;
  };
}
const loadFont = createFontLoader();
const faceFor = (run: FountainRun): Face =>
  run.bold ? (run.italic ? "boldItalic" : "bold") : run.italic ? "italic" : "regular";

/** Generate an embedded-font, selectable-text PDF entirely in the browser. */
export async function screenplayPdf(
  layout: ScreenplayLayout,
  title = "Screenplay",
): Promise<Uint8Array> {
  if (layout.exportBlocked)
    throw new Error(
      "Fix the unclosed notes or boneyards before exporting PDF. Their text remains visible in the preview so you can repair the source.",
    );
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title);
  pdf.setCreator("VoxDown Studio");
  pdf.setProducer("VoxDown Studio / pdf-lib");
  const used = new Set<Face>();
  for (const page of layout.pages)
    for (const line of page.lines)
      for (const run of line.runs) if (run.text) used.add(faceFor(run));
  const fonts = new Map<Face, PDFFont>();
  await Promise.all(
    Array.from(used, async (face) => {
      fonts.set(
        face,
        await pdf.embedFont(await loadFont(urls[face]), {
          subset: true,
          features: { liga: false, clig: false, kern: false },
        }),
      );
    }),
  );
  const sets = new Map(
    Array.from(fonts, ([face, font]) => [face, new Set(font.getCharacterSet())]),
  );
  const missing = new Set<string>();
  for (const page of layout.pages)
    for (const line of page.lines)
      for (const run of line.runs) {
        const supported = sets.get(faceFor(run));
        for (const char of run.text)
          if (!supported?.has(char.codePointAt(0) as number)) missing.add(char);
      }
  if (missing.size) {
    const names = Array.from(missing)
      .slice(0, 8)
      .map(
        (char) =>
          `“${char}” (U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")})`,
      )
      .join(", ");
    throw new Error(
      `Courier Prime cannot print ${names}${missing.size > 8 ? " and other characters" : ""}. Replace these characters before exporting PDF. Your Fountain source is unchanged.`,
    );
  }
  for (const sheet of layout.pages) {
    const page = pdf.addPage([layout.width, layout.height]);
    for (const line of sheet.lines) {
      let x = line.x;
      for (const run of line.runs) {
        if (!run.text) continue;
        const font = fonts.get(faceFor(run)) as PDFFont;
        page.drawText(run.text, {
          x,
          y: layout.height - line.y,
          font,
          size: SCREENPLAY_FONT_SIZE,
          color: rgb(0, 0, 0),
        });
        const width = Array.from(run.text).length * SCREENPLAY_PITCH;
        if (run.underline)
          page.drawLine({
            start: { x, y: layout.height - line.y - 1.5 },
            end: { x: x + width, y: layout.height - line.y - 1.5 },
            thickness: 0.5,
            color: rgb(0, 0, 0),
          });
        x += width;
      }
    }
  }
  return pdf.save();
}
