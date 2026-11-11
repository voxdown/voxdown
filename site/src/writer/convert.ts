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

/** Elements that make blocks of their own; anything else is part of the text around it. */
const BLOCK =
  /^(address|article|aside|blockquote|body|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|hr|li|main|menu|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/;

/**
 * A book's HTML (an element holding it) as paragraphs. Paragraphs, list items and headings are
 * read as such; any other block that holds text of its own (a `div` paragraph, a quotation, a
 * verse's stanza, a table cell) is a paragraph too, its line breaks kept, so no words are lost.
 */
/** What a style sheet says of an element's emphasis: italic or not, bold or not, or nothing. */
export type Emphasis = {
  italic?: boolean;
  bold?: boolean;
  /** Shown as a block of its own (`display: block`): a verse's line in a `span`. */
  block?: boolean;
};

/** A note's reference or the note itself, in an ebook: left out, never read in the text. */
export function isNote(element: Element): boolean {
  const type = `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("role") ?? ""}`;
  return /\b(noteref|footnote|endnote|endnotes|rearnote|rearnotes|doc-noteref|doc-footnote|doc-endnote|doc-endnotes)\b/i.test(
    type,
  );
}

/**
 * A title page: the book's own header (its title and author, which the front matter holds), or an
 * ebook's title page or cover. Its words aren't the story's, to be read aloud.
 */
export function isTitlePage(element: Element): boolean {
  if (element.classList.contains("vxd-header")) return true;
  const type = `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("role") ?? ""}`;
  return /\b(titlepage|halftitlepage|cover|doc-cover)\b/i.test(type);
}

/** An element's emphasis from its style sheets and its `style` attribute, where a book has them. */
export type StyleOf = (element: Element) => Emphasis;

export function paragraphsOf(root: Element, styleOf?: StyleOf): Paragraph[] {
  const out: Paragraph[] = [];
  const runsOf = (nodes: readonly Node[], start: { italic: boolean; bold: boolean }, pre = false) =>
    readRuns(nodes, start, styleOf, pre);
  const text = (runs: Run[]) => {
    if (runs.some((run) => "text" in run && run.text.trim())) out.push({ kind: "text", runs });
  };
  const visit = (element: Element, inherited: { italic: boolean; bold: boolean }) => {
    const tag = element.tagName.toLowerCase();
    if (/^(script|style|nav|head|title|template)$/.test(tag) || isNote(element)) return;
    if (isTitlePage(element)) return;
    // A block's own style (`<p style="font-style: italic">`, a class) holds for all it contains.
    const own = styleOf?.(element) ?? {};
    const here = {
      italic: own.italic ?? inherited.italic,
      bold: own.bold ?? inherited.bold,
    };
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      // A heading is bold by itself: that isn't emphasis.
      const runs = runsOf([...element.childNodes], { italic: here.italic, bold: false });
      if (runs.length) out.push({ kind: "heading", level: Number(heading[1]), runs });
      return;
    }
    if (tag === "hr") {
      out.push({ kind: "break" });
      return;
    }
    if (tag === "pre") {
      text(runsOf([...element.childNodes], here, true));
      return;
    }
    // The text between blocks, a paragraph to each stretch of it; the blocks, each as itself.
    let inline: Node[] = [];
    const flush = () => {
      if (inline.length) text(runsOf(inline, here));
      inline = [];
    };
    for (const child of element.childNodes) {
      if (child.nodeType === 1 && BLOCK.test((child as Element).tagName.toLowerCase())) {
        flush();
        visit(child as Element, here);
      } else inline.push(child);
    }
    flush();
  };
  visit(root, { italic: false, bold: false });
  return out;
}

/**
 * Nodes' text as runs: italics and bold as their tags and styles say, line breaks kept (all, in
 * `pre`).
 */
function readRuns(
  nodes: readonly Node[],
  start: { italic: boolean; bold: boolean },
  styleOf: StyleOf | undefined,
  pre = false,
): Run[] {
  const runs: Run[] = [];
  const walk = (node: Node, italic: boolean, bold: boolean) => {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? "";
      if (pre) {
        raw.split("\n").forEach((part, index) => {
          if (index > 0) runs.push({ lineBreak: true });
          if (part) runs.push({ text: part.replace(/[ \t]+/g, " "), italic, bold });
        });
        return;
      }
      const text = raw.replace(/\s+/g, " ");
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
    // Pronunciation over ruby text, and a note's number, aren't the words.
    if (/^(script|style|template|rt|rp)$/.test(tag) || isNote(node as Element)) return;
    const own = styleOf?.(node as Element) ?? {};
    // A verse's line in a span shown as a block: a line of its own.
    const block = own.block === true;
    const breakHere = () => {
      const last = runs.at(-1);
      if (last && !("lineBreak" in last)) runs.push({ lineBreak: true });
    };
    if (block) breakHere();
    const isItalic = own.italic ?? (italic || tag === "em" || tag === "i" || tag === "cite");
    const isBold = own.bold ?? (bold || tag === "strong" || tag === "b");
    for (const child of node.childNodes) walk(child, isItalic, isBold);
    if (block) breakHere();
  };
  for (const node of nodes) walk(node, start.italic, start.bold);
  // Spaces at the ends of the paragraph and of its lines go.
  runs.forEach((run, index) => {
    if (!("text" in run)) return;
    const before = runs[index - 1];
    const after = runs[index + 1];
    if (!before || "lineBreak" in before) run.text = run.text.trimStart();
    if (!after || "lineBreak" in after) run.text = run.text.trimEnd();
  });
  // No line break at either end.
  const kept = runs.filter((run) => !("text" in run) || run.text);
  while (kept[0] && "lineBreak" in kept[0]) kept.shift();
  while (kept.at(-1) && "lineBreak" in (kept.at(-1) as Run)) kept.pop();
  return kept;
}

/**
 * Runs side by side in the same style as one: Word splits a word into several runs (`Drag` and
 * `ons`), which written one by one would read `*Drag**ons*`.
 */
export function mergedRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (
      last &&
      "text" in last &&
      "text" in run &&
      last.italic === run.italic &&
      last.bold === run.bold
    )
      out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push({ ...run });
  }
  return out;
}

/** Text as it reads, its signs escaped where they would read as marks or emphasis. */
export function escapeText(text: string): string {
  return text.replace(/[\\@[{*_]|%%/g, (sign) => (sign === "%%" ? "\\%%" : `\\${sign}`));
}

/** Runs as a story's text: italics as `*…*`, bold as `**…**`, a line break as one. */
export function writeRuns(runs: readonly Run[]): string {
  let out = "";
  for (const run of mergedRuns(runs)) {
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
  // A line that would open as a heading or a group, or be a scene break, keeps its first sign as
  // text. Lists and quotations aren't marks in a story (§11): `1. Not a list` stays as it is.
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .map((line) => line.replace(/^(#|:::)(?=\s|#|$)/, "\\$1").replace(/^(-{3,}\s*)$/, "\\$1"))
    .join("\n");
}

/** Paragraphs as a story: a front matter with its details, then the text. */
export function writeStory(
  paragraphs: readonly Paragraph[],
  details: { title?: string; subtitle?: string; author?: string; language?: string },
): string {
  const front = ["---", "voxdown: 1.1"];
  const quoted = (value: string) =>
    /^[\p{L}\p{N}][\p{L}\p{N} ,.'’!?-]*$/u.test(value) ? value : JSON.stringify(value);
  if (details.title) front.push(`title: ${quoted(details.title)}`);
  if (details.subtitle) front.push(`subtitle: ${quoted(details.subtitle)}`);
  if (details.author) front.push(`author: ${quoted(details.author)}`);
  if (details.language) front.push(`language: ${quoted(details.language)}`);
  front.push("cast:", "---", "");
  // A paragraph that is only a scene break's signs (`#`, `* * *`, `~~~`) is one.
  const isBreak = (paragraph: Paragraph) =>
    paragraph.kind === "text" &&
    /^(?:[*#~·•—–-]\s*){3,}$|^[#*]$/.test(
      paragraph.runs
        .map((run) => ("text" in run ? run.text : " "))
        .join("")
        .trim(),
    );
  const body = paragraphs.map((paragraph) =>
    paragraph.kind === "break" || isBreak(paragraph)
      ? "* * *"
      : paragraph.kind === "heading"
        ? `${"#".repeat(Math.min(6, paragraph.level))} ${writeRuns(paragraph.runs)
            .replace(/\s*\n\s*/g, " ")
            .trim()}`
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
