/** The views on real books (corpus/README.md), and on a long story made of them. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { renderBook, renderScript } from "../src/index";

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), "../../../corpus");
const books = readdirSync(corpus)
  .filter((name) => name.endsWith(".vxd"))
  .map((name) => ({ name, source: readFileSync(join(corpus, name), "utf8") }));

describe("the views, on real books", () => {
  for (const { name, source } of books) {
    it(`place every stretch of ${name} heard, each inside its line`, () => {
      const story = parse(source);
      const document = new Window().document;
      document.body.innerHTML = renderScript(story, { positions: true });
      const heard = story.blocks
        .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
        .flatMap((line) => line.items)
        .filter((item) => item.kind === "speech" && /[\p{L}\p{N}]/u.test(item.text));
      for (const speech of heard) {
        const element = document.querySelector(`.vxd-speech[data-from="${speech.range.from}"]`);
        expect(element, speech.kind === "speech" ? speech.text : "").not.toBe(null);
        const line = element?.closest(".vxd-line");
        expect(Number(line?.getAttribute("data-from"))).toBeLessThanOrEqual(speech.range.from);
        expect(speech.range.to).toBeLessThanOrEqual(Number(line?.getAttribute("data-to")));
      }
      document.body.innerHTML = renderBook(story, { positions: true, pages: true });
      expect(document.querySelectorAll(".vxd-p").length).toBeGreaterThan(50);
    });
  }

  it("draw a long story in good time", () => {
    const bodies = books.map(({ source }) => source.slice(source.indexOf("\n---\n", 4) + 5));
    const story = parse(Array.from({ length: 18 }, () => bodies.join("\n\n")).join("\n\n"));
    const time = (work: () => unknown) => {
      const start = performance.now();
      work();
      return performance.now() - start;
    };
    // About 100,000 words. Generous limits, for slow machines.
    expect(time(() => renderScript(story, { positions: true }))).toBeLessThan(5000);
    expect(time(() => renderBook(story, { positions: true, pages: true }))).toBeLessThan(5000);
  }, 60_000);
});
