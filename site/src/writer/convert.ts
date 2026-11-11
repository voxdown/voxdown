/**
 * Between a story and the documents other tools make: a book's HTML read as paragraphs of styled
 * runs (for a Word document or an ebook), and paragraphs from them written as a story, its text
 * escaped so that nothing in it reads as a mark it isn't.
 */

/** A stretch of text in one style. */
export type Run = { text: string; italic: boolean; bold: boolean } | { lineBreak: true };

/** A paragraph: a heading (its level), a scene break, or text. */
export type Paragraph =
  | { kind: "heading"; level: number; runs: Run[] }
  | { kind: "break" }
  | { kind: "text"; runs: Run[] };

/** A book's HTML (an element holding it) as paragraphs. */
export function paragraphsOf(root: Element): Paragraph[] {
  const out: Paragraph[] = [];
  const visit = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (/^(script|style|nav|head|title)$/.test(tag)) return;
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const runs = runsOf(element);
      if (runs.length) out.push({ kind: "heading", level: Number(heading[1]), runs });
    } else if (tag === "hr") out.push({ kind: "break" });
    else if (tag === "p" || tag === "li" || tag === "dt" || tag === "dd") {
      const runs = runsOf(element);
      if (runs.some((run) => "text" in run && run.text.trim())) out.push({ kind: "text", runs });
    } else for (const child of element.children) visit(child);
  };
  visit(root);
  return out;
}

/** An element's text as runs: italics and bold as its tags say, line breaks kept. */
function runsOf(element: Element): Run[] {
  const runs: Run[] = [];
  const walk = (node: Node, italic: boolean, bold: boolean) => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text) runs.push({ text, italic, bold });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    // Page numbers and the like the book draws aside are no part of the text.
    if ((node as Element).classList.contains("vxd-page-number")) return;
    if (tag === "br") {
      runs.push({ lineBreak: true });
      return;
    }
    const isItalic = italic || tag === "em" || tag === "i" || tag === "cite";
    const isBold = bold || tag === "strong" || tag === "b";
    for (const child of node.childNodes) walk(child, isItalic, isBold);
  };
  for (const child of element.childNodes) walk(child, false, false);
  // Spaces at the ends of the paragraph and of its lines go.
  const first = runs[0];
  if (first && "text" in first) first.text = first.text.trimStart();
  const last = runs.at(-1);
  if (last && "text" in last) last.text = last.text.trimEnd();
  return runs.filter((run) => !("text" in run) || run.text);
}

/** Text as it reads, its signs escaped where they would read as marks or emphasis. */
export function escapeText(text: string): string {
  return text.replace(/[\\@[{*_]|%%/g, (sign) => (sign === "%%" ? "\\%%" : `\\${sign}`));
}

/** Runs as a story's text: italics as `*…*`, bold as `**…**`, a line break as one. */
export function writeRuns(runs: readonly Run[]): string {
  let out = "";
  for (const run of runs) {
    if ("lineBreak" in run) {
      out = `${out.trimEnd()}\n`;
      continue;
    }
    const sign = run.bold && run.italic ? "***" : run.bold ? "**" : run.italic ? "*" : "";
    const escaped = escapeText(run.text);
    if (!sign || !escaped.trim()) {
      out += escaped;
      continue;
    }
    // The signs hug the words: spaces stay outside them.
    const [, before = "", words = "", after = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(escaped) ?? [];
    out += `${before}${sign}${words}${sign}${after}`;
  }
  // A line that would open as a heading, a group or a list keeps its first sign as text.
  return out
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^(#|:::|-|\+|>|\d+\.)(?=\s|$)/, "\\$1"))
    .join("\n");
}

/** Paragraphs as a story: a front matter with its details, then the text. */
export function writeStory(
  paragraphs: readonly Paragraph[],
  details: { title?: string; author?: string; language?: string },
): string {
  const front = ["---", "voxdown: 1.1"];
  const quoted = (value: string) =>
    /^[\p{L}\p{N}][\p{L}\p{N} ,.'’!?-]*$/u.test(value) ? value : JSON.stringify(value);
  if (details.title) front.push(`title: ${quoted(details.title)}`);
  if (details.author) front.push(`author: ${quoted(details.author)}`);
  if (details.language) front.push(`language: ${quoted(details.language)}`);
  front.push("cast:", "---", "");
  const body = paragraphs.map((paragraph) =>
    paragraph.kind === "break"
      ? "* * *"
      : paragraph.kind === "heading"
        ? `${"#".repeat(Math.min(6, paragraph.level))} ${writeRuns(paragraph.runs).replace(/\n/g, " ")}`
        : writeRuns(paragraph.runs),
  );
  return `${front.join("\n")}\n${body.join("\n\n")}\n`;
}

/** Text for XML: its five signs escaped, and characters XML can't hold left out. */
export function xmlText(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the characters XML can't hold
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

/** XML's escaped text back: the five signs and character references. */
export function fromXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? "";
  });
}
