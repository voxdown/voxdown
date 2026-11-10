/**
 * The views on stories made at random: they never fail, every tag they open is closed, and with
 * positions, each part's place is inside the text and inside its parent's.
 * FUZZ_RUNS and FUZZ_SEED as in the core package's fuzz tests.
 */
import fc from "fast-check";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { bookText, parse } from "voxdown";
import { renderBook, renderDocument, renderScript } from "../src/index";

const RUNS = Number(process.env.FUZZ_RUNS ?? 1000);
const SEED =
  process.env.FUZZ_SEED === "random" ? undefined : Number(process.env.FUZZ_SEED ?? 20261110);
const settings = { numRuns: RUNS, ...(SEED === undefined ? {} : { seed: SEED }) };

const PIECES = [
  "@Gerald",
  "@Wanda",
  "@",
  "@(yawning)",
  "(yawning)",
  "@()",
  "“",
  "”",
  "‘",
  "’",
  '"',
  "'",
  "„",
  "«",
  "»",
  "“Hello,”",
  "[snores]",
  "@Gerald [snores]",
  "[",
  "]",
  "{page}",
  "{page 3}",
  "{pause 2s}",
  "{book only}",
  "{audio only}",
  "{hidden}",
  "{recorder:take 3}",
  "{",
  "}",
  "%% note %%",
  "%%",
  ":::",
  "::: whispering",
  "::: @Gerald (whispering)",
  "# ",
  "## Title",
  "***",
  "---",
  "[link](https://example.com)",
  "![i](a.png)",
  "[x](javascript:alert(1))",
  "<script>",
  "&",
  "*em*",
  "**strong**",
  "*very **quiet** indeed*",
  "***",
  "_",
  "snake_case",
  "`code`",
  "Hello",
  " ",
  "\n",
  "\n\n",
  "\r\n",
  "\\",
  "\\@",
  "—",
  "…",
  "😀",
  "﻿",
  "---\ncast:\n  Gerald:\n    name: Gerald the Dragon\n---\n",
];
const story = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.array(fc.constantFrom(...PIECES), { maxLength: 40 }).map((p) => p.join("")),
  },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 80 }) },
);

/** Every element's tag that opens is closed, in a simple count: the views write no void tags but these. */
function balanced(html: string): boolean {
  for (const tag of [
    "span",
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "article",
    "header",
    "ul",
    "li",
    "em",
    "strong",
    "a",
    "code",
  ]) {
    const opened = html.match(new RegExp(`<${tag}[\\s>]`, "g"))?.length ?? 0;
    const closed = html.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0;
    if (opened !== closed) return false;
  }
  return true;
}

/** A link as its text and an image as nothing, an address running to its balancing `)`. */
function withoutLinks(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const bang = text[i] === "!" && text[i + 1] === "[";
    if (text[i] === "[" || bang) {
      const open = bang ? i + 1 : i;
      const close = text.indexOf("]", open + 1);
      let end = -1;
      for (
        let at = close + 1, depth = 0;
        close > 0 && text[close + 1] === "(" && at < text.length;
        at++
      ) {
        if (text[at] === "(") depth++;
        else if (text[at] === ")" && --depth === 0) {
          end = at;
          break;
        }
      }
      if (end > 0) {
        out += bang ? "" : text.slice(open + 1, close);
        i = end;
        continue;
      }
    }
    out += text[i];
  }
  return out;
}

/**
 * Text as a reader sees it: Markdown's own signs (a heading's `#` and a scene break's `---` too,
 * which a paragraph may hold once its marks are gone) and the spaces between words don't count.
 */
const plain = (text: string) =>
  text
    .split("\n")
    .map(withoutLinks)
    .join("\n")
    .replace(/[*_#]|-{3,}/g, "")
    .replace(/\s+/g, "");

describe("the views, on stories made at random", () => {
  it("print the book text in the book view, as a reader sees it", () => {
    const window = new Window();
    fc.assert(
      // The book text drops escapes, so a story with one can't be told from one without.
      fc.property(
        story.filter((source) => !source.includes("\\")),
        (source) => {
          const parsed = parse(source);
          window.document.body.innerHTML = renderBook(parsed, { header: false });
          expect(plain(window.document.body.textContent ?? "")).toBe(
            plain(bookText(parsed).replace(/^-{3,}$|^\*{3,}$|^_{3,}$/gm, "")),
          );
        },
      ),
      settings,
    );
  });

  it("never fail, and close every tag they open", () => {
    fc.assert(
      fc.property(story, (source) => {
        const parsed = parse(source);
        for (const html of [
          renderScript(parsed),
          renderBook(parsed, { pages: true }),
          renderScript(parsed, { positions: true, narratorName: true }),
          renderBook(parsed, { positions: true }),
        ]) {
          expect(balanced(html)).toBe(true);
          expect(html).not.toMatch(/<script/i);
        }
        renderDocument(source, "script");
      }),
      settings,
    );
  });

  it("place each part inside the text and inside its parent", () => {
    const window = new Window();
    fc.assert(
      fc.property(story, (source) => {
        const parsed = parse(source);
        for (const html of [
          renderScript(parsed, { positions: true }),
          renderBook(parsed, { positions: true }),
        ]) {
          window.document.body.innerHTML = html;
          for (const element of window.document.querySelectorAll("[data-from]")) {
            const from = Number(element.getAttribute("data-from"));
            const to = Number(element.getAttribute("data-to"));
            expect(0 <= from && from <= to && to <= source.length).toBe(true);
            const parent = element.parentElement?.closest("[data-from]");
            if (parent) {
              expect(Number(parent.getAttribute("data-from"))).toBeLessThanOrEqual(from);
              expect(to).toBeLessThanOrEqual(Number(parent.getAttribute("data-to")));
            }
          }
        }
      }),
      { ...settings, numRuns: Math.max(20, Math.round(RUNS / 4)) },
    );
  });
});
