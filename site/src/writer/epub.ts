/**
 * Ebooks (EPUB 3): a story's book written as one, a chapter to each `#` heading, with its table of
 * contents, title, author and language; and one read in as a new story, its chapters in reading
 * order, ready to be marked up.
 */
import {
  type Emphasis,
  type Paragraph,
  type Run,
  type StyleOf,
  fromXml,
  paragraphsOf,
  writeStory,
  xmlText,
} from "./convert";
import { unzip, zip } from "./zip";

const STYLE = `body { font-family: Georgia, "Iowan Old Style", serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3 { font-weight: 600; line-height: 1.2; page-break-after: avoid; }
h1 { margin: 2em 0 1em; text-align: center; }
p { margin: 0; text-indent: 1.4em; }
h1 + p, h2 + p, h3 + p, hr + p { text-indent: 0; }
hr { border: 0; margin: 1.2em 0; text-align: center; }
hr::after { content: "* * *"; }`;

function runsXhtml(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      if ("lineBreak" in run) return "<br/>";
      let text = xmlText(run.text);
      if (run.italic) text = `<em>${text}</em>`;
      if (run.bold) text = `<strong>${text}</strong>`;
      return text;
    })
    .join("");
}

const words = (runs: readonly Run[]) =>
  runs
    .map((run) => ("text" in run ? run.text : " "))
    .join("")
    .trim();

/** A book's paragraphs as an ebook: a chapter to each `#` heading (or each `##`, if none). */
export function epubOf(
  paragraphs: readonly Paragraph[],
  details: { title?: string; author?: string; language?: string; id: string; when: Date },
): Uint8Array {
  const top = paragraphs.some((p) => p.kind === "heading" && p.level === 1) ? 1 : 2;
  const chapters: Array<{ title: string; paragraphs: Paragraph[] }> = [];
  for (const paragraph of paragraphs) {
    if (paragraph.kind === "heading" && paragraph.level <= top)
      chapters.push({ title: words(paragraph.runs), paragraphs: [] });
    if (!chapters.length) chapters.push({ title: details.title ?? "Start", paragraphs: [] });
    (chapters.at(-1) as (typeof chapters)[number]).paragraphs.push(paragraph);
  }
  if (!chapters.length) chapters.push({ title: details.title ?? "Story", paragraphs: [] });
  const language = details.language ?? "en";
  const title = details.title ?? chapters[0]?.title ?? "Story";
  const page = (heading: string, body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xmlText(language)}" xml:lang="${xmlText(language)}">
<head><meta charset="utf-8"/><title>${xmlText(heading)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
  const chapterFiles = chapters.map((chapter, index) => ({
    name: `chapter-${index + 1}.xhtml`,
    data: page(
      chapter.title,
      chapter.paragraphs
        .map((paragraph) =>
          paragraph.kind === "break"
            ? "<hr/>"
            : paragraph.kind === "heading"
              ? `<h${Math.min(paragraph.level, 6)}>${runsXhtml(paragraph.runs)}</h${Math.min(paragraph.level, 6)}>`
              : `<p>${runsXhtml(paragraph.runs)}</p>`,
        )
        .join("\n"),
    ),
  }));
  const nav = page(
    title,
    `<nav epub:type="toc" id="toc"><h1>${xmlText(title)}</h1><ol>${chapters
      .map(
        (chapter, index) =>
          `<li><a href="chapter-${index + 1}.xhtml">${xmlText(chapter.title)}</a></li>`,
      )
      .join("")}</ol></nav>`,
  );
  const modified = `${details.when.toISOString().slice(0, 19)}Z`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="${xmlText(language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:uuid:${xmlText(details.id)}</dc:identifier>
<dc:title>${xmlText(title)}</dc:title>
<dc:language>${xmlText(language)}</dc:language>
${details.author ? `<dc:creator>${xmlText(details.author)}</dc:creator>` : ""}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="style" href="style.css" media-type="text/css"/>
${chapterFiles.map((file, index) => `<item id="c${index + 1}" href="${file.name}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
${chapterFiles.map((_, index) => `<itemref idref="c${index + 1}"/>`).join("\n")}
</spine>
</package>`;
  return zip([
    // First, and stored: how a reader knows it for an ebook.
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/style.css", data: STYLE },
    ...chapterFiles.map((file) => ({ name: `OEBPS/${file.name}`, data: file.data })),
  ]);
}

/** A path from another, as a book's files point to each other. */
function joined(base: string, href: string): string {
  const parts = base.split("/").slice(0, -1);
  for (const part of decodeURIComponent(href.split("#")[0] ?? "").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/** A tag's attributes, however they are quoted. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, double, single] of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    if (name) out.set(name.replace(/^[\w.-]+:/, ""), fromXml(double ?? single ?? ""));
  return out;
}

/** The elements named `name` in some XML, whatever namespace prefix they carry. */
const elements = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>`, "g"))].map((found) => found[0]);

/** What some CSS declarations say of emphasis: `font-style`, `font-weight`, the `font` shorthand. */
export function emphasisOf(declarations: string): Emphasis {
  const out: Emphasis = {};
  for (const declaration of declarations.split(";")) {
    const [property = "", value = ""] = declaration
      .split(":")
      .map((part) => part.trim().toLowerCase());
    if (property === "font-style") {
      if (/^(italic|oblique)/.test(value)) out.italic = true;
      else if (value === "normal") out.italic = false;
    } else if (property === "font-weight") {
      if (/^(bold|bolder)$/.test(value) || Number(value) >= 600) out.bold = true;
      else if (/^(normal|lighter)$/.test(value) || (Number(value) > 0 && Number(value) < 600))
        out.bold = false;
    } else if (property === "display") {
      if (value === "block") out.block = true;
    } else if (property === "font") {
      if (/\b(italic|oblique)\b/.test(value)) out.italic = true;
      if (/\b(bold|bolder|[6-9]00)\b/.test(value)) out.bold = true;
    }
  }
  return out;
}

/**
 * Emphasis from a book's style sheets and `style` attributes: rules for an element (`em`), a
 * class (`.calibre3`) or both (`span.italic`), the ones books are made with; a `style` attribute
 * over them.
 */
export function styleSheets(css: readonly string[]): StyleOf {
  const rules = new Map<string, Emphasis>();
  for (const sheet of css)
    for (const [, selectors = "", body = ""] of sheet
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const said = emphasisOf(body);
      if (said.italic === undefined && said.bold === undefined && said.block === undefined)
        continue;
      for (const selector of selectors.split(",")) {
        const key = selector.trim().toLowerCase();
        if (/^[a-z0-9]*(\.[\w-]+)?$/.test(key) && key)
          rules.set(key, { ...rules.get(key), ...said });
      }
    }
  return (element) => {
    const tag = element.tagName.toLowerCase();
    let found: Emphasis = { ...rules.get(tag) };
    for (const name of element.classList) {
      const key = name.toLowerCase();
      found = { ...found, ...rules.get(`.${key}`), ...rules.get(`${tag}.${key}`) };
    }
    const inline = element.getAttribute("style");
    return inline ? { ...found, ...emphasisOf(inline) } : found;
  };
}

/** What an ebook holds that a story doesn't take, said plainly. */
function leftOut(pages: readonly string[]): string[] {
  const all = pages.join("");
  const left: string[] = [];
  if (/<(img|image|svg)\b/i.test(all)) left.push("pictures");
  if (/<table\b/i.test(all)) left.push("tables (their text is kept, as paragraphs)");
  if (/(?:epub:type|role)\s*=\s*["'][^"']*\b(?:doc-)?(?:foot|end|rear)?notes?\b|noteref/i.test(all))
    left.push("notes and their numbers");
  return left;
}

/** An ebook's chapters, in reading order, as a story; its title, author and language too. */
export async function storyOfEpub(
  bytes: ArrayBuffer,
): Promise<{ story: string; left: string[]; missing: string[]; chapters: number }> {
  const files = await unzip(bytes);
  const decoder = new TextDecoder();
  const text = (name: string) => {
    const data = files.get(name) ?? files.get(decodeURIComponent(name));
    return data ? decoder.decode(data) : undefined;
  };
  const container = text("META-INF/container.xml");
  const root = container
    ? elements(container, "rootfile")
        .map((tag) => attributes(tag))
        .find(
          (rootfile) =>
            (rootfile.get("media-type") ?? "").includes("oebps-package") ||
            rootfile.has("full-path"),
        )
        ?.get("full-path")
    : undefined;
  const opf = root ? text(root) : undefined;
  if (!root || !opf) throw new Error("This isn’t an ebook (no package file).");
  const meta = (tag: string) => {
    const found = new RegExp(
      `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`,
    ).exec(opf)?.[1];
    return found ? fromXml(found.replace(/<[^>]+>/g, "")).trim() || undefined : undefined;
  };
  const items = new Map<string, { href: string; type: string; nav: boolean }>();
  const css: string[] = [];
  for (const tag of elements(opf, "item")) {
    const item = attributes(tag);
    const id = item.get("id");
    const href = item.get("href");
    const type = item.get("media-type") ?? "";
    if (!id || !href) continue;
    items.set(id, { href, type, nav: /\bnav\b/.test(item.get("properties") ?? "") });
    if (type === "text/css") css.push(text(joined(root, href)) ?? "");
  }
  const parser = new DOMParser();
  const pages: Array<{ name: string; page: string }> = [];
  const missing: string[] = [];
  const refs = elements(opf, "itemref").map((tag) => attributes(tag));
  const spine = refs.map((ref) => ref.get("idref") ?? "");
  let chapters = 0;
  let aside = 0;
  for (const ref of refs) {
    const idref = ref.get("idref") ?? "";
    const item = items.get(idref);
    // Out of the reading order (`linear="no"`): notes and the like, left out and said.
    if (ref.get("linear") === "no") {
      aside++;
      continue;
    }
    // A picture page (a cover), or the contents: not part of the text.
    if (item && (!/html/.test(item.type) || item.nav)) continue;
    chapters++;
    const page = item ? text(joined(root, item.href)) : undefined;
    // A chapter the reading order names, that isn't there: said, never left out quietly.
    if (!page) missing.push(item?.href ?? idref);
    else pages.push({ name: item?.href ?? idref, page });
  }
  // Its style sheets, and those inside its pages, say which words are in italics or bold.
  for (const { page } of pages)
    for (const [, sheet = ""] of page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
      css.push(sheet);
  const styleOf = styleSheets(css);
  const paragraphs: Paragraph[] = [];
  for (const { page } of pages) {
    // Only its words: nothing it links to (a style, an image) is fetched.
    const words = page
      .replace(/<(?:link|img|image|source|video|audio)\b[^>]*>/gi, "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
    const body = parser.parseFromString(words, "text/html").body;
    if (body) paragraphs.push(...paragraphsOf(body, styleOf));
  }
  // An ebook whose chapters couldn't be found isn't opened empty, as if it had none.
  if (paragraphs.length === 0)
    throw new Error(
      spine.length
        ? "None of this ebook's chapters could be read."
        : "This ebook lists no chapters to read.",
    );
  const title = meta("title");
  const author = meta("creator");
  const language = meta("language");
  return {
    story: writeStory(paragraphs, {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(language ? { language } : {}),
    }),
    left: [
      ...leftOut(pages.map(({ page }) => page)),
      ...(aside
        ? [`${aside} page${aside === 1 ? "" : "s"} outside the reading order (notes and the like)`]
        : []),
    ],
    missing,
    chapters,
  };
}
