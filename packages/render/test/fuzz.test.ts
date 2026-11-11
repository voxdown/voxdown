/**
 * The views on stories made at random: they never fail, every tag they open is closed, and with
 * positions, each part's place is inside the text and inside its parent's.
 * FUZZ_RUNS and FUZZ_SEED as in the core package's fuzz tests.
 */
import fc from "fast-check";
import { Window } from "happy-dom";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { bookText, parse, spokenScript } from "voxdown";
import { renderBook, renderDocument, renderScript } from "../src/index";

const RUNS = Number(process.env.FUZZ_RUNS ?? 1000);
const SEED =
  process.env.FUZZ_SEED === "random" ? undefined : Number(process.env.FUZZ_SEED ?? 20261110);
/**
 * Checks a property in chunks of stories, giving the event loop a turn between them, so a deep
 * run (FUZZ_RUNS=20000) never blocks the test worker long enough for vitest to give up on it.
 */
async function check<T>(property: fc.IProperty<T>, runs = RUNS): Promise<void> {
  const chunk = 250;
  for (let done = 0, part = 0; done < runs; done += chunk, part++) {
    fc.assert(property, {
      numRuns: Math.min(chunk, runs - done),
      ...(SEED === undefined ? {} : { seed: SEED + part }),
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
}

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
  "&amp;",
  "&quot;",
  "&constructor;",
  "&__proto__;",
  "&#0;",
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

/**
 * A link as its text and an image as nothing, an address running to its balancing `)`, the link
 * opening at the `[` nearest its `]`.
 */
function withoutLinks(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const bang = text[i] === "!" && text[i + 1] === "[";
    if (text[i] === "[" || bang) {
      const open = bang ? i + 1 : i;
      // The `]` that balances it, if a `(` follows; else the next `]`, but a `[` before that one
      // is the link's, if it is one: Markdown pairs a `]` with the nearest `[`.
      let balanced = -1;
      for (let at = open, depth = 0; at < text.length; at++) {
        if (text[at] === "[") depth++;
        else if (text[at] === "]" && --depth === 0) {
          balanced = at;
          break;
        }
      }
      let close = text.indexOf("]", open + 1);
      if (balanced > 0 && text[balanced + 1] === "(") close = balanced;
      const nested = text.indexOf("[", open + 1);
      if (close !== balanced && nested >= 0 && nested < close) {
        out += text[i];
        continue;
      }
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

/**
 * Lines of Markdown alone (§8.3: links and images work as in Markdown, and so does emphasis): words,
 * emphasis signs, brackets, parentheses, escapes, links with titles and addresses in `<…>`.
 */
const markdownLine = fc
  .array(
    fc.constantFrom(
      "a",
      "word",
      " ",
      "*",
      "**",
      "***",
      "_",
      "__",
      ".",
      ",",
      "!",
      "snake_case",
      "x*y",
      "[",
      "]",
      "(",
      ")",
      "[x](y)",
      "![i](p.png)",
      "\\*",
      "\\_",
      "\\[",
      '[t](u "T (a")',
      "[t](<u v>)",
      "](",
      "*[x](y)*",
      "[![i](p.png)](y)",
      "![a [b](x)](q.png)",
      "[![i](p.png) and more](y)",
      "&amp;",
      "&quot;",
      "&#8217;",
      "&ast;",
      "&nosuch;",
      "[t](u?a=1&amp;b=2)",
      '[t](caf&eacute; "caf&eacute;")',
      // (Not a reference in an image's description: markdown-it 14 drops it from `alt`, where
      // CommonMark keeps its character. The views' own tests check that one.)
      "&#106;",
    ),
    { minLength: 1, maxLength: 12 },
  )
  .map((pieces) => pieces.join("").trim())
  // Not a list item, a scene break or a line of nothing but signs, which Markdown reads as blocks.
  .filter((line) => line !== "" && !/^[*-] /.test(line) && !/^[-*_ ]+$/.test(line));

/** Whether the line holds a sound (§8.1), VoxDown's own: Markdown keeps its brackets as text. */
const hasSound = (line: string) =>
  parse(line).blocks.some(
    (block) =>
      block.kind === "paragraph" &&
      block.lines.some((row) =>
        row.items.some((item) => item.kind === "sound" || item.kind === "image"),
      ),
  );

describe("Markdown, as a CommonMark reader (markdown-it) reads it", () => {
  const markdown = new MarkdownIt("commonmark");
  /** markdown-it's HTML as the views write it: `<img …>`, and addresses not percent-encoded. */
  const theirs = (line: string) =>
    markdown
      .renderInline(line)
      .replace(/ \/>/g, ">")
      .replace(
        /(href|src)="([^"]*)"/g,
        (_, name: string, url: string) => `${name}="${decodeURI(url).replace(/"/g, "&quot;")}"`,
      );

  it("the book view shows a line's emphasis, links and images as Markdown does", async () => {
    let compared = 0;
    await check(
      fc.property(markdownLine, (line) => {
        // A sound is left out of the book; a line with one isn't Markdown alone.
        const story = parse(line);
        if (
          story.blocks.some(
            (b) =>
              b.kind === "paragraph" &&
              b.lines.some((r) => r.items.some((i) => i.kind === "sound")),
          )
        )
          return;
        const ours = renderBook(story, { header: false }).match(/<p[^>]*>(.*)<\/p>/s)?.[1] ?? "";
        compared++;
        expect(ours, line).toBe(theirs(line));
      }),
    );
    expect(compared).toBeGreaterThan(RUNS / 2);
  });

  it("the parser hears a line's words as Markdown shows them, addresses and signs aside", async () => {
    const words = (html: string) =>
      html
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/[*_]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    await check(
      fc.property(markdownLine, (line) => {
        if (hasSound(line)) return;
        const shown = words(theirs(line));
        // A line with no letter or digit isn't read aloud (§12.1).
        if (!/[\p{L}\p{N}]/u.test(shown)) return;
        expect(words(spokenScript(parse(line)).replace(/^Narrator: /gm, "")), line).toBe(shown);
      }),
    );
  });
});

describe("the views, on stories made at random", () => {
  it("print the book text in the book view, as a reader sees it", async () => {
    const window = new Window();
    await check(
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
    );
  });

  it("never fail, and close every tag they open", async () => {
    await check(
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
    );
  });

  it("say in the script view who says each stretch, as the parser does", async () => {
    const window = new Window();
    let found = 0;
    let missing = 0;
    await check(
      fc.property(story, (source) => {
        const parsed = parse(source);
        window.document.body.innerHTML = renderScript(parsed, { positions: true });
        const shown = new Map<string, string | null>();
        for (const element of window.document.querySelectorAll(".vxd-speech[data-from]")) {
          const at = `${element.getAttribute("data-from")}:${element.getAttribute("data-to")}`;
          shown.set(at, element.getAttribute("data-speaker"));
        }
        for (const block of parsed.blocks) {
          // A `{hidden}` heading shows only as a label (§14).
          if (block.kind === "break" || (block.kind === "heading" && block.visibility === "hidden"))
            continue;
          for (const line of block.kind === "heading" ? [block.line] : block.lines) {
            for (const item of line.items) {
              if (item.kind !== "speech" || !/[\p{L}\p{N}]/u.test(item.text)) continue;
              const at = `${item.range.from}:${item.range.to}`;
              if (!shown.has(at)) {
                missing++;
                continue;
              }
              found++;
              expect(shown.get(at), JSON.stringify(source)).toBe(item.speaker);
            }
          }
        }
      }),
      Math.max(20, Math.round(RUNS / 4)),
    );
    // Every stretch with words is shown as one, but in a hidden heading: none goes missing.
    expect(missing).toBe(0);
    expect(found).toBeGreaterThan(0);
  });

  it("place each part inside the text and inside its parent", async () => {
    const window = new Window();
    await check(
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
      Math.max(20, Math.round(RUNS / 4)),
    );
  });
});
