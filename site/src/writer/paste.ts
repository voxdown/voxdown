/**
 * Pasting from a web page, Word or Google Docs: its paragraphs, headings, italics and bold kept as
 * the story writes them (`*`, `**`, `#`, a blank line between paragraphs), read as a Word document
 * or an ebook is read in, by their tags, their style sheets and their `style` attributes. Text
 * with nothing of that pastes as itself, as does a paste with Ctrl+Shift+V, which brings text only.
 */
import { type Paragraph, paragraphsOf, writeBody } from "./convert";
import { styleSheets } from "./epub";

/**
 * VoxDown already, as written: the marks a story is written with (`@Ann “…”`, `{pause 2s}`,
 * `%% … %%`, a group's `:::`, a front matter). Pasted as it is, not as a page's text.
 */
const VOXDOWN =
  /(?:^|\s)@[\p{L}\p{N}_'’-]*\s*(?:\([^()\n]*\)\s*)?[“"‘'«(]|\{(?:pause|page|book only|hidden|audio only|heard only|printed only)\b[^}\n]*\}|%%[^\n]*%%|(?:^|\n)(?::::|---[ \t]*\r?\n)/u;

/** A typewriter face, as code editors set their text. */
const MONOSPACE =
  /monospace|Consolas|Menlo|Monaco|Courier|Cascadia|Fira Code|JetBrains Mono|SF Mono/i;

/**
 * Source, not a page: most of what is pasted set as code is (VS Code wraps all it copies in
 * `white-space: pre` and a typewriter face; a `<pre>` or `<code>`). A page with a few such blocks
 * in it (Project Gutenberg's, its licence's tables) is a page, and Google Docs' `pre-wrap` is how
 * it keeps spaces, not code.
 */
function isSource(page: Document): boolean {
  const all = page.body.textContent?.replace(/\s+/g, "").length ?? 0;
  if (all === 0) return false;
  let code = 0;
  const walk = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    const style = (element as HTMLElement).style;
    if (
      tag === "pre" ||
      tag === "code" ||
      style?.whiteSpace === "pre" ||
      MONOSPACE.test(style?.fontFamily ?? "")
    ) {
      code += element.textContent?.replace(/\s+/g, "").length ?? 0;
      return;
    }
    for (const child of element.children) walk(child);
  };
  walk(page.body);
  return code / all > 0.8;
}

/**
 * The story's text for pasted HTML, and whether it escaped any of VoxDown's signs; undefined
 * where the text itself is what is meant: VoxDown as written, source code, or a plain sentence.
 */
export function pastedStory(
  html: string,
  plain = "",
): { text: string; escaped: boolean; marks: string } | undefined {
  if (VOXDOWN.test(plain)) return undefined;
  const page = new DOMParser().parseFromString(html, "text/html");
  if (isSource(page)) return undefined;
  const css = [...page.querySelectorAll("style")].map((style) => style.textContent ?? "");
  const paragraphs: Paragraph[] = paragraphsOf(page.body, styleSheets(css));
  if (paragraphs.length === 0) return undefined;
  const shaped =
    paragraphs.length > 1 ||
    paragraphs.some(
      (paragraph) =>
        paragraph.kind !== "text" ||
        paragraph.runs.some((run) => "text" in run && (run.italic || run.bold)),
    );
  if (!shaped) return undefined;
  const text = writeBody(paragraphs);
  // A sign written as text (`\@`, `\[`): the page meant it as text, or the writer meant it as a
  // mark; asked after, with the other way one click away.
  const escaped = (text.match(/\\/g)?.length ?? 0) > (plain.match(/\\/g)?.length ?? 0);
  // The same shape with its signs as marks: what Paste as VoxDown puts in instead.
  const marks = text.replace(/\\([\\@[{*_#:%-])/g, "$1");
  return { text, escaped, marks };
}
