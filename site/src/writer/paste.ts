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

/**
 * Source, not a page: what a code editor copies (VS Code's lines in `white-space: pre`, a
 * typewriter face), or a page's `<pre>` and `<code>`. Pasted as its text.
 */
const SOURCE =
  /white-space\s*:\s*pre|font-family\s*:[^;"]*(?:monospace|Consolas|Menlo|Monaco|Courier|Cascadia|Fira Code|JetBrains Mono)|<pre[\s>]|<code[\s>]/i;

/**
 * The story's text for pasted HTML, and whether it escaped any of VoxDown's signs; undefined
 * where the text itself is what is meant: VoxDown as written, source code, or a plain sentence.
 */
export function pastedStory(
  html: string,
  plain = "",
): { text: string; escaped: boolean } | undefined {
  if (VOXDOWN.test(plain) || SOURCE.test(html)) return undefined;
  const page = new DOMParser().parseFromString(html, "text/html");
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
  return { text, escaped };
}
