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
