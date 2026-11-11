/**
 * Pasting from a web page, Word or Google Docs: its paragraphs, headings, italics and bold kept as
 * the story writes them (`*`, `**`, `#`, a blank line between paragraphs), read as a Word document
 * or an ebook is read in, by their tags, their style sheets and their `style` attributes. Text
 * with nothing of that pastes as itself, as does a paste with Ctrl+Shift+V, which brings text only.
 */
import { type Paragraph, paragraphsOf, writeBody } from "./convert";
import { styleSheets } from "./epub";

/** The story's text for pasted HTML, or undefined where the plain text says as much. */
export function pastedStory(html: string): string | undefined {
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
  return shaped ? writeBody(paragraphs) : undefined;
}
