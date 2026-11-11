import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { bookText, lines, parse } from "voxdown";
import {
  characterColors,
  render,
  renderBook,
  renderDocument,
  renderScript,
  stylesheet,
} from "../src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtures = JSON.parse(readFileSync(join(root, "spec", "conformance.json"), "utf8")) as Array<{
  example: number;
  input: string;
}>;
const files = readdirSync(join(root, "examples"))
  .filter((name) => name.endsWith(".vxd"))
  .map((name) => [name, readFileSync(join(root, "examples", name), "utf8")] as const);
const inputs: Array<readonly [string, string]> = [
  ...fixtures.map((fixture) => [`spec example ${fixture.example}`, fixture.input] as const),
  ...files,
];

function dom(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

/** Text as a reader sees it: Markdown's own signs and the spaces between words don't count. */
const plain = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, "");

describe("the book view", () => {
  it.each(inputs)("%s prints exactly the book text", (_name, source) => {
    const story = parse(source);
    const document = dom(renderBook(story, { header: false }));
    expect(plain(document.body.textContent ?? "")).toBe(
      plain(bookText(story).replace(/^-{3,}$|^\*{3,}$|^_{3,}$|^#+ /gm, "")),
    );
  });

  it("typesets emphasis, links and images, and keeps escapes literal", () => {
    const html = renderBook(
      parse("A *very* **bold** [link](https://example.com) ![a cat](cat.png) \\*not\\*"),
      { header: false },
    );
    expect(html).toContain(
      'A <em>very</em> <strong>bold</strong> <a href="https://example.com">link</a> <img src="cat.png" alt="a cat"> *not*',
    );
  });

  it("pairs emphasis as Markdown does, nested and in runs", () => {
    const html = (text: string) =>
      renderBook(parse(text), { header: false })
        .match(/<p[^>]*>(.*)<\/p>/s)?.[1]
        ?.trim();
    expect(html("*very **quiet** indeed*")).toContain(
      "<em>very <strong>quiet</strong> indeed</em>",
    );
    expect(html("***Hello***")).toContain("<em><strong>Hello</strong></em>");
    expect(html("**bold *and em* here**")).toContain("<strong>bold <em>and em</em> here</strong>");
    expect(html("*foo**bar**baz*")).toContain("<em>foo<strong>bar</strong>baz</em>");
    // Not emphasis: signs with spaces inside, and underscores inside a word.
    expect(html("* a * and snake_case_word")).toContain("* a * and snake_case_word");
    expect(html("**a*")).toContain("*<em>a</em>");
  });

  it("pairs emphasis over a paragraph's lines and across a direction, in both views", () => {
    const book = (text: string) => renderBook(parse(text), { header: false });
    const script = (text: string) => renderScript(parse(text), { header: false });
    expect(book("*one\ntwo*")).toContain("<em>one</em><br>\n<em>two</em>");
    expect(script("*one\ntwo*")).toContain("<em>one</em>");
    expect(script("*one\ntwo*")).toContain("<em>two</em>");
    expect(book("@A “*Hello @(softly) there.*”")).toContain("“<em>Hello there.</em>”");
    const directed = script("@A “*Hello @(softly) there.*”");
    expect(directed).toContain("“<em>Hello</em>");
    expect(directed).toContain("<em>there.</em>”");
    expect(directed).not.toContain("*");
  });

  it("reads links with brackets in their text, and an address's title and angle brackets", () => {
    const html = (text: string) => renderBook(parse(text), { header: false });
    expect(html("[a [fine] story](https://example.com)")).toContain(
      '<a href="https://example.com">a [fine] story</a>',
    );
    expect(html('[story](https://example.com "A story")')).toContain(
      '<a href="https://example.com" title="A story">story</a>',
    );
    expect(html("[story](<https://example.com>)")).toContain(
      '<a href="https://example.com">story</a>',
    );
  });

  it("reads a link's address and title as Markdown does, lone parentheses and all", () => {
    // Each as CommonMark reads it (checked with markdown-it), and as the parser does.
    const html = (text: string) =>
      renderBook(parse(`Read ${text} now.`), { header: false }).match(/<p[^>]*>(.*)<\/p>/s)?.[1];
    expect(html('[the chapter](book.html "Chapter (one")')).toBe(
      'Read <a href="book.html" title="Chapter (one">the chapter</a> now.',
    );
    expect(html("[this](<https://example.com/a)b>)")).toBe(
      'Read <a href="https://example.com/a)b">this</a> now.',
    );
    expect(html('[a](b "t)")')).toBe('Read <a href="b" title="t)">a</a> now.');
    expect(html("[a](b (t))")).toBe('Read <a href="b" title="t">a</a> now.');
    expect(html("[a](b\\)c)")).toBe('Read <a href="b)c">a</a> now.');
    expect(html("[a](<b\\>c>)")).toBe('Read <a href="b&gt;c">a</a> now.');
    expect(html('![pic](a.png "A (big" )')).toBe(
      'Read <img src="a.png" alt="pic" title="A (big"> now.',
    );
    // No link: a sound, which the book leaves out, then text.
    expect(html('[a](b "t" x)')).toBe("Read (b &quot;t&quot; x) now.");
    expect(html("[a](b(c d)")).toBe("Read (b(c d) now.");
  });

  it("opens a link at the `[` nearest its `]`, a `[` left open before it being text", () => {
    // As markdown-it reads each.
    const html = (text: string) =>
      renderBook(parse(text), { header: false }).match(/<p[^>]*>(.*)<\/p>/s)?.[1];
    expect(html("[[t](u) now")).toBe('[<a href="u">t</a> now');
    expect(html("[a *[x](y)* b")).toBe('[a <em><a href="y">x</a></em> b');
    expect(html("[![i](p.png) here")).toBe('[<img src="p.png" alt="i"> here');
  });

  it("links an image that is a link's text, and decodes character references", () => {
    const html = (text: string) =>
      renderBook(parse(text), { header: false }).match(/<p[^>]*>(.*)<\/p>/s)?.[1];
    expect(html("[![A map](map.png)](map-large.png)")).toBe(
      '<a href="map-large.png"><img src="map.png" alt="A map"></a>',
    );
    expect(renderScript(parse("[![A map](map.png)](map-large.png)"), { header: false })).toContain(
      '<a href="map-large.png"><img class="vxd-image" src="map.png" alt="A map"></a>',
    );
    expect(html("[Tom &quot;Cat&quot;](c.html?x=1&amp;y=2)")).toBe(
      '<a href="c.html?x=1&amp;y=2">Tom &quot;Cat&quot;</a>',
    );
    expect(html("Tom &amp; Jerry &ast;not em&ast;")).toBe("Tom &amp; Jerry *not em*");
    // In an address, a title and a description, as the characters they stand for.
    expect(html('[x](https://e.com/caf&eacute; "caf&eacute;")')).toBe(
      '<a href="https://e.com/café" title="café">x</a>',
    );
    expect(html("![Tom &amp; Jerry \\*x\\*](caf&eacute;.png)")).toBe(
      '<img src="café.png" alt="Tom &amp; Jerry *x*">',
    );
  });

  it("makes the innermost of links inside links the link, as Markdown and the parser do", () => {
    const html = (text: string) => renderBook(parse(text), { header: false });
    expect(html("[a [b](x) c](y)")).toContain('[a <a href="x">b</a> c](y)');
    expect(html("[[b](x)](y)")).toContain('[<a href="x">b</a>](y)');
  });

  it("reads a link's or an image's address to its balancing parenthesis, as the parser does", () => {
    const link = "See [the bat](https://en.wikipedia.org/wiki/Bat_(animal)) here.";
    const image = "![A bat (flying)](bat_(1).png) here.";
    for (const render of [renderBook, renderScript]) {
      expect(render(parse(link), { header: false })).toContain(
        '<a href="https://en.wikipedia.org/wiki/Bat_(animal)">the bat</a> here.',
      );
      expect(render(parse(image), { header: false })).toMatch(
        /<img[^>]* src="bat_\(1\)\.png" alt="A bat \(flying\)">/,
      );
    }
  });

  it("renders a very long line, and brackets nested deep, in good time", () => {
    for (const text of [
      "word ".repeat(60_000),
      "@Tom “a” [b] {page} %% n %% ".repeat(5_000),
      `${"[".repeat(100_000)}x${"]".repeat(100_000)}(y)`,
    ]) {
      const story = parse(text);
      const start = performance.now();
      renderBook(story, { positions: true });
      renderScript(story, { positions: true });
      expect(performance.now() - start, text.slice(0, 6)).toBeLessThan(3000);
    }
  });

  it("renders a cast of thousands in good time", () => {
    // Each line's full name was found by a search through the cast, and each color by one
    // through the names before it.
    const names = Array.from({ length: 8_000 }, (_, at) => `C${at}`);
    const cast = names.map((name) => `  ${name}: Name ${name}`).join("\n");
    const story = parse(
      `---\ncast:\n${cast}\n---\n\n${names.map((n) => `@${n} “Hi.”`).join("\n\n")}\n`,
    );
    const start = performance.now();
    const html = renderScript(story);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(html).toContain("Name C7999");
  });

  it("renders groups nested thousands deep in good time", () => {
    const story = parse("::: softly\nHello.\n\n".repeat(8_000));
    const start = performance.now();
    const html = renderScript(story) + renderBook(story);
    expect(performance.now() - start).toBeLessThan(5000);
    expect(html).toContain("Hello.");
  });

  it("renders lines built to be slow in good time", () => {
    // Each opening mark once searched the rest of its line for its closing one.
    for (const piece of [
      "*a ",
      "_a ",
      "**a ",
      "a* ",
      "*a **b ",
      "***a ",
      "[",
      "![",
      "[x](",
      "(",
      "[a](<",
      '[a](b "',
      "[a](b (",
      "[a](b      ",
    ]) {
      const story = parse(piece.repeat(Math.ceil(60_000 / piece.length)));
      const start = performance.now();
      renderBook(story);
      renderScript(story);
      expect(performance.now() - start, piece).toBeLessThan(2000);
    }
  });

  it("shows page numbers in the margin when asked", () => {
    const html = renderBook(parse("One. {page}\n\n{page 12}\nTwelve."), {
      pages: true,
      header: false,
    });
    expect(html).toContain('aria-label="Page 2"');
    expect(html).toContain('aria-label="Page 12"');
  });
});

describe("the script view", () => {
  it.each(inputs)("%s puts every line heard under its speaker", (_name, source) => {
    const story = parse(source);
    const document = dom(renderScript(story, { header: false }));
    const spans = [...document.querySelectorAll(".vxd-speech, .vxd-chip-vocal")];
    for (const line of lines(story)) {
      if (line.kind !== "speech" && line.kind !== "vocal") continue;
      const found = spans.some(
        (span) =>
          span.getAttribute("data-speaker") === line.speaker &&
          plain(span.textContent ?? "").includes(plain(line.text)),
      );
      expect(found, `${line.speaker}: ${line.text}`).toBe(true);
    }
    const html = document.body.innerHTML;
    expect((html.match(/<div/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
  });

  it("colors speakers in cast order, names them where the speaker changes, and puts directions above", () => {
    const story = parse(
      "---\ncast:\n  Wanda:\n  Gerald:\n    color: '#ff0000'\n---\n@Gerald (yawning) “Hi.” @Gerald “Again.” @Wanda “Hm.”",
    );
    expect([...characterColors(story)]).toEqual([
      ["Wanda", "#2563eb"],
      ["Gerald", "#ff0000"],
    ]);
    const html = renderScript(story, { header: false });
    expect(html.match(/class="vxd-name"/g)?.length).toBe(2);
    expect(html).toContain(
      '<span class="vxd-direction" aria-label="(yawning)"><span>yawning</span></span>“Hi.”',
    );
    expect(html).toContain('style="--vxd-c: #ff0000"');
  });

  it("names a speaker once a paragraph, through narration, and labels a group's visibility once", () => {
    const html = renderScript(
      parse(
        "@Mother “Now my dears,” said Mrs. Rabbit, “you may go.”\n\n@Mother “Run along.”\n\n::: {book only}\nOne.\n\nTwo.\n:::",
      ),
      { header: false },
    );
    expect(html.match(/class="vxd-name"/g)?.length).toBe(2);
    expect(html.match(/>book only</g)?.length).toBe(1);
  });

  it("repeats no title the story opens with", () => {
    const story = parse(
      "---\ntitle: Toast\nauthor: Me\ncast:\n  Gerald:\n---\n# Toast\n@Gerald “Hi.”",
    );
    expect(renderBook(story)).not.toContain("vxd-header");
    expect(renderScript(story)).not.toContain("vxd-title");
    expect(renderScript(story)).toContain("vxd-cast");
  });

  it("writes a group's direction once, in its label, and a line's own direction over it", () => {
    const html = renderScript(
      parse("::: whispering\nSir Percival crept inside.\nClank.\n\n@(louder) Clank!\n:::"),
      { header: false },
    );
    expect(html.match(/whispering/g)?.length).toBe(1);
    expect(html).toContain('<span class="vxd-group-direction">whispering</span>');
    expect(html.match(/class="vxd-direction"/g)?.length).toBe(1);
    expect(html).toContain('aria-label="(louder)"');
  });

  it("names a group's character once, by their full name, in the group's label", () => {
    const html = renderScript(
      parse(
        "---\ncast:\n  Wind:\n    name: The North Wind\n---\n::: @Wind huffing, louder and louder\nOne puff!\nTwo puffs!\n\nTHREE PUFFS!\n:::\n\n@Wind “Phew.”",
      ),
      { header: false },
    );
    expect(html).toContain('<span class="vxd-group-name">The North Wind</span>');
    expect(html.match(/huffing, louder and louder/g)?.length).toBe(1);
    // In the group, the label names them; after it, their next line does.
    expect(html.match(/class="vxd-name"/g)?.length).toBe(1);
    expect(html).toMatch(/class="vxd-name"[^>]*>The North Wind<\/span><span[^>]*>“Phew\.”/);
  });

  it("draws sounds, pauses, page turns, notes, groups and labels", () => {
    const html = renderScript(
      parse(
        "::: @Wanda (reading)\nDear Gerald. [paper rustles] {pause 2s} %% slowly %%\n:::\n{page 3}\n\n{book only} Printed only.\n\n## The cave {hidden}",
      ),
      { header: false },
    );
    for (const part of [
      'class="vxd-group" data-speaker="Wanda"',
      '<span class="vxd-group-direction">reading</span>',
      '<span class="vxd-chip vxd-chip-sound">paper rustles</span>',
      '<span class="vxd-chip vxd-chip-pause" title="Pause">2s</span>',
      '<span class="vxd-note" role="note">slowly</span>',
      '<span class="vxd-turn" role="separator"><span>page 3</span></span>',
      'data-visibility="book"',
      'data-visibility="hidden"',
    ]) {
      expect(html).toContain(part);
    }
  });
});

describe("positions", () => {
  const views = (source: string, positions: boolean) => [
    render(source, "script", { positions }),
    render(source, "book", { pages: true, positions }),
  ];

  it("are written only when asked for, and change nothing else", () => {
    for (const [, source] of inputs) {
      const [script, book] = views(source, false);
      expect(`${script}${book}`).not.toContain("data-from");
      const [placedScript, placedBook] = views(source, true).map((html) => {
        const doc = dom(html);
        for (const element of doc.querySelectorAll("[data-from]")) {
          element.removeAttribute("data-from");
          element.removeAttribute("data-to");
        }
        // The book view wraps each printed line, to say where it comes from.
        for (const line of doc.querySelectorAll(".vxd-book .vxd-line"))
          line.replaceWith(...line.childNodes);
        return doc.body.innerHTML;
      });
      expect(placedScript).toBe(dom(script ?? "").body.innerHTML);
      expect(placedBook).toBe(dom(book ?? "").body.innerHTML);
    }
  });

  it("place each part inside its parent, and each speech and line on its own source", () => {
    for (const [name, source] of inputs) {
      const story = parse(source);
      const speeches = new Set(
        story.blocks.flatMap((block) =>
          block.kind === "break"
            ? []
            : (block.kind === "heading" ? [block.line] : block.lines).flatMap((line) =>
                line.items
                  .filter((item) => item.kind === "speech")
                  .map((item) => `${item.range.from}-${item.range.to}`),
              ),
        ),
      );
      const lineRanges = new Set(
        story.blocks.flatMap((block) =>
          block.kind === "paragraph"
            ? block.lines.map((line) => `${line.range.from}-${line.range.to}`)
            : [],
        ),
      );
      for (const html of views(source, true)) {
        for (const element of dom(html).querySelectorAll("[data-from]")) {
          const from = Number(element.getAttribute("data-from"));
          const to = Number(element.getAttribute("data-to"));
          expect(0 <= from && from <= to && to <= source.length, name).toBe(true);
          const parent = element.parentElement?.closest("[data-from]");
          if (parent) {
            expect(Number(parent.getAttribute("data-from")) <= from, name).toBe(true);
            expect(to <= Number(parent.getAttribute("data-to")), name).toBe(true);
          }
          if (element.classList.contains("vxd-speech"))
            expect(speeches.has(`${from}-${to}`), name).toBe(true);
          if (element.classList.contains("vxd-line"))
            expect(lineRanges.has(`${from}-${to}`), name).toBe(true);
        }
      }
    }
  });
});

describe("safety", () => {
  it("escapes HTML in the story, its marks and its front matter", () => {
    const source =
      '---\ntitle: <b>T</b>\ncast:\n  Gerald: "<img src=x onerror=alert(1)>"\n---\n@Gerald (<i>) “<script>alert(1)</script>” [<b>] %% <u> %%';
    for (const view of ["book", "script"] as const) {
      const html = render(source, view);
      expect(html).not.toMatch(/<(?:script|img|b|i|u)\b/);
    }
  });

  it("neutralizes script links", () => {
    expect(renderBook(parse("[click](javascript:alert(1))"), { header: false })).toContain(
      'href="#"',
    );
  });
});

describe("pages and the stylesheet", () => {
  it("writes a whole page with the stylesheet and the story's language", () => {
    const html = renderDocument("---\ntitle: Toast\nlanguage: en-US\n---\nHi.", "script");
    expect(html).toMatch(/^<!doctype html>\n<html lang="en-US">/);
    expect(html).toContain("<title>Toast</title>");
    expect(html).toContain(".vxd-speech");
  });

  it("styles nothing outside a rendered view, so the editor's marks on the same page keep their look", () => {
    const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(?:^|[{};])\s*([^{};@]+?)\s*\{/g)].flatMap((match) =>
      (match[1] ?? "").split(","),
    );
    expect(selectors.length).toBeGreaterThan(40);
    const loose = selectors
      .map((selector) => selector.trim())
      .filter(
        (selector) =>
          !/^(?:\.vxd(?![\w-])|\.vxd-(?:script|book)(?![\w-])|:where\(\.vxd\) |:where\(:not|\[data-vxd-theme)/.test(
            selector,
          ),
      );
    expect(loose).toEqual([]);
  });

  it("styles every class the renderer writes", () => {
    const html = inputs
      .map(([, source]) => render(source, "script") + render(source, "book", { pages: true }))
      .join("");
    const used = new Set(
      [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? "").split(" ")),
    );
    // Hooks for a host's own styles: one per line, and each heading label's level.
    const hooks = new Set(["vxd-line", "vxd-h3", "vxd-h4", "vxd-h5", "vxd-h6"]);
    const missing = [...used].filter(
      (name) => !hooks.has(name) && !stylesheet.includes(`.${name}`),
    );
    expect(missing).toEqual([]);
  });
});
