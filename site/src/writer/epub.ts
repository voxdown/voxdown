/**
 * Ebooks (EPUB 3): a story's book written as one, a chapter to each `#` heading, with its table of
 * contents, title, author and language; and one read in as a new story, its chapters in reading
 * order, ready to be marked up.
 */
import { type Paragraph, type Run, fromXml, paragraphsOf, writeStory, xmlText } from "./convert";
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

/** An ebook's chapters, in reading order, as a story; its title, author and language too. */
export async function storyOfEpub(bytes: ArrayBuffer): Promise<string> {
  const files = await unzip(bytes);
  const decoder = new TextDecoder();
  const text = (name: string) => {
    const data = files.get(name);
    return data ? decoder.decode(data) : undefined;
  };
  const container = text("META-INF/container.xml");
  const root = container ? /full-path="([^"]+)"/.exec(container)?.[1] : undefined;
  const opf = root ? text(root) : undefined;
  if (!root || !opf) throw new Error("This isn’t an ebook (no package file).");
  // The package file read by its tags: no more of XML than its metadata, manifest and spine.
  const attributes = (tag: string) => {
    const out = new Map<string, string>();
    for (const [, name, value] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g))
      if (name && value !== undefined) out.set(name, fromXml(value));
    return out;
  };
  const meta = (tag: string) => {
    const found = new RegExp(`<dc:${tag}\\b[^>]*>([\\s\\S]*?)</dc:${tag}>`).exec(opf)?.[1];
    return found ? fromXml(found.replace(/<[^>]+>/g, "")).trim() || undefined : undefined;
  };
  const items = new Map<string, string>();
  for (const [tag] of opf.matchAll(/<item\b[^>]*>/g)) {
    const item = attributes(tag);
    const id = item.get("id");
    const href = item.get("href");
    if (
      id &&
      href &&
      /html/.test(item.get("media-type") ?? "") &&
      !/\bnav\b/.test(item.get("properties") ?? "")
    )
      items.set(id, href);
  }
  const parser = new DOMParser();
  const paragraphs: Paragraph[] = [];
  for (const [tag] of opf.matchAll(/<itemref\b[^>]*>/g)) {
    const href = items.get(attributes(tag).get("idref") ?? "");
    const page = href ? text(joined(root, href)) : undefined;
    if (!page) continue;
    // Only its words: nothing it links to (a style, an image) is fetched.
    const words = page
      .replace(/<(?:link|img|image|source|video|audio)\b[^>]*>/gi, "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
    const body = parser.parseFromString(words, "text/html").body;
    if (body) paragraphs.push(...paragraphsOf(body));
  }
  const title = meta("title");
  const author = meta("creator");
  const language = meta("language");
  return writeStory(paragraphs, {
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
  });
}
