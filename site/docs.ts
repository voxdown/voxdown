/**
 * The site's document pages, written from the repository's Markdown when the site is built: the
 * spec and the cheat sheet, with headings GitHub would link to and the spec's examples drawn as
 * input, spoken script and book text side by side.
 */
import { readFileSync } from "node:fs";
import { Marked, type Tokens } from "marked";

const LINKS: Record<string, string> = {
  "SPEC.md": "./spec.html",
  "CHEATSHEET.md": "./cheatsheet.html",
  "conformance.json": "https://github.com/voxdown/voxdown/blob/main/spec/conformance.json",
  "CHANGELOG.md": "https://github.com/voxdown/voxdown/blob/main/spec/CHANGELOG.md",
};

/** GitHub's heading anchors: lower case, punctuation dropped, spaces as hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function markdownToHtml(markdown: string): string {
  const marked = new Marked();
  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const html = this.parser.parseInline(tokens);
        const id = slug(html);
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        // `example`, or `example 1.1` for one new in a later version of the spec.
        const [kind, since] = (lang ?? "").split(/\s+/);
        if (kind !== "example") {
          return `<pre class="code"><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(text)}</code></pre>\n`;
        }
        const [input = "", script = "", book] = text
          .split(/^\.$/m)
          .map((part) => part.replace(/^\n|\n$/g, ""));
        const cell = (label: string, body: string) =>
          `<div class="example-part"><div class="example-label">${label}</div><pre><code>${escapeHtml(body)}</code></pre></div>`;
        const caption = since
          ? `<figcaption class="example-since">New in ${escapeHtml(since)}</figcaption>`
          : "";
        return `<figure class="example">${caption}${cell("You write", input)}${cell("A listener hears", script)}${book === undefined ? "" : cell("A reader sees", book)}</figure>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const target = LINKS[href] ?? href;
        const titled = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(target)}"${titled}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}

export function markdownFile(path: string): string {
  return markdownToHtml(readFileSync(path, "utf8"));
}
