/**
 * Word documents (DOCX): a story's book written as one, for an editor or a publisher, its
 * headings as Word's headings and its italics and bold kept; and one read in as a new story, its
 * paragraphs, headings and emphasis kept, ready to be marked up.
 */
import { type Paragraph, type Run, fromXml, writeStory, xmlText } from "./convert";
import { unzip, zip } from "./zip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function runXml(run: Run): string {
  if ("lineBreak" in run) return "<w:r><w:br/></w:r>";
  const style = `${run.bold ? "<w:b/>" : ""}${run.italic ? "<w:i/>" : ""}`;
  return `<w:r>${style ? `<w:rPr>${style}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlText(run.text)}</w:t></w:r>`;
}

function paragraphXml(paragraph: Paragraph): string {
  if (paragraph.kind === "break")
    return `<w:p><w:pPr><w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t>* * *</w:t></w:r></w:p>`;
  const style =
    paragraph.kind === "heading"
      ? `<w:pPr><w:pStyle w:val="Heading${Math.min(paragraph.level, 6)}"/></w:pPr>`
      : "";
  return `<w:p>${style}${paragraph.runs.map(runXml).join("")}</w:p>`;
}

/** The document's styles: a book face, Word's headings, and a centred scene break. */
const styles = (language: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="24"/>${language}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4, 5, 6]
  .map(
    (level) =>
      `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 480 : 320}" w:after="160"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(24, 40 - level * 4)}"/></w:rPr></w:style>`,
  )
  .join("\n")}
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene break"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr></w:style>
</w:styles>`;

/** A book's paragraphs as a Word document. */
export function docxOf(
  paragraphs: readonly Paragraph[],
  details: { title?: string; author?: string; language?: string },
): Uint8Array {
  const body = paragraphs.map(paragraphXml).join("");
  const language = details.language ? `<w:lang w:val="${xmlText(details.language)}"/>` : "";
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${details.title ? `<dc:title>${xmlText(details.title)}</dc:title>` : ""}${details.author ? `<dc:creator>${xmlText(details.author)}</dc:creator>` : ""}${details.language ? `<dc:language>${xmlText(details.language)}</dc:language>` : ""}</cp:coreProperties>`;
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles(language) },
    { name: "docProps/core.xml", data: core },
  ]);
}

/** A heading's level from a style's name: Word's own names, and some others' in their languages. */
function levelOfName(name: string | undefined): number | undefined {
  if (!name) return undefined;
  if (/^(title|titel|titre|titolo|t[ií]tulo)$/i.test(name.trim())) return 1;
  const found =
    /(?:heading|berschrift|titre|titolo|kop|encabezado|t[ií]tulo|rubrik|nagłówek)\s*(\d)/i.exec(
      name,
    );
  return found ? Number(found[1]) : undefined;
}

/** An attribute's value, however it is quoted. */
const value = (xml: string, element: string, attribute = "w:val") =>
  new RegExp(`<${element}\\b[^>]*?\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
    .exec(xml)
    ?.slice(1)
    .find((found) => found !== undefined);

/** Whether a run property is on in some properties: present, and not switched off; undefined if not said. */
function said(properties: string, name: string): boolean | undefined {
  const found = new RegExp(`<w:${name}(\\s[^>]*)?/?>`).exec(properties);
  if (!found) return undefined;
  const switched = /w:val\s*=\s*["']?(0|false|off|none)["']?/i.test(found[1] ?? "");
  return !switched;
}

/** A style from styles.xml: what it inherits from, and what it says of headings and emphasis. */
type Style = {
  name?: string;
  basedOn?: string;
  outline?: number;
  italic?: boolean;
  bold?: boolean;
};

/** The document's styles, by id. */
function stylesOf(xml: string): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const [whole] of xml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
    const head = /<w:style\b[^>]*>/.exec(whole)?.[0] ?? "";
    const id = value(head, "w:style", "w:styleId");
    if (!id) continue;
    const properties = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(whole)?.[1] ?? "";
    const outline = value(whole, "w:outlineLvl");
    const italic = said(properties, "i");
    const bold = said(properties, "b");
    styles.set(id, {
      ...(value(whole, "w:name") ? { name: value(whole, "w:name") as string } : {}),
      ...(value(whole, "w:basedOn") ? { basedOn: value(whole, "w:basedOn") as string } : {}),
      ...(outline !== undefined ? { outline: Number(outline) } : {}),
      ...(italic !== undefined ? { italic } : {}),
      ...(bold !== undefined ? { bold } : {}),
    });
  }
  return styles;
}

/** What a style says, itself or through the styles it is based on (a few deep at most). */
function inherited<K extends keyof Style>(
  styles: Map<string, Style>,
  id: string | undefined,
  key: K,
): Style[K] | undefined {
  let at = id;
  for (let depth = 0; at && depth < 12; depth++) {
    const style = styles.get(at);
    if (!style) return undefined;
    if (style[key] !== undefined) return style[key];
    at = style.basedOn;
  }
  return undefined;
}

/** A paragraph style's heading level: by its outline level, or its name, or what it is based on. */
function headingLevel(
  styles: Map<string, Style>,
  id: string | undefined,
  own?: string,
): number | undefined {
  // An outline level on the paragraph itself, 0 to 5 (9 is body text).
  if (own !== undefined && Number(own) < 6) return Number(own) + 1;
  let at = id;
  for (let depth = 0; at && depth < 12; depth++) {
    const style = styles.get(at);
    const level =
      style?.outline !== undefined && style.outline < 6
        ? style.outline + 1
        : levelOfName(style?.name ?? at);
    if (level) return level;
    if (!style) return undefined;
    at = style.basedOn;
  }
  return undefined;
}

/** What a Word document holds that a story doesn't take, said plainly. */
function leftOut(xml: string): string[] {
  const left: string[] = [];
  if (/<w:tbl\b/.test(xml)) left.push("tables (their text is kept, as paragraphs)");
  if (/<w:drawing\b|<w:pict\b/.test(xml)) left.push("pictures");
  if (/<w:footnoteReference\b|<w:endnoteReference\b/.test(xml)) left.push("footnotes");
  if (/<w:commentReference\b/.test(xml)) left.push("comments");
  if (/<w:numPr\b/.test(xml)) left.push("list numbering");
  if (/<w:sym\b/.test(xml)) left.push("symbols from symbol fonts");
  return left;
}

/** A Word document's paragraphs, headings and emphasis, as a story; its title and author too. */
export async function storyOfDocx(bytes: ArrayBuffer): Promise<{ story: string; left: string[] }> {
  const files = await unzip(bytes);
  const decoder = new TextDecoder();
  const document = files.get("word/document.xml");
  if (!document) throw new Error("This isn’t a Word document (no word/document.xml).");
  // Text boxes (and the older copy Word keeps of them) hold paragraphs within a paragraph: they're
  // left out, and said, rather than read twice or swallow the text after them.
  const raw = decoder.decode(document);
  const boxes = /<w:txbxContent\b/.test(raw);
  const xml = raw
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "")
    .replace(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g, "");
  const stylesFile = files.get("word/styles.xml");
  const styles = stylesOf(stylesFile ? decoder.decode(stylesFile) : "");
  const paragraphs: Paragraph[] = [];
  for (const [p] of xml.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const pPr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(p)?.[1] ?? "";
    const style = value(pPr, "w:pStyle");
    const runs: Run[] = [];
    for (const [r] of p.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) {
      const properties = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] ?? "";
      const character = value(properties, "w:rStyle");
      // The run's own word, else its character style's, else its paragraph style's.
      const emphasis = (name: "i" | "b", key: "italic" | "bold") =>
        said(properties, name) ??
        inherited(styles, character, key) ??
        // A heading's style is bold by itself: that isn't emphasis.
        (headingLevel(styles, style) ? undefined : inherited(styles, style, key)) ??
        false;
      const italic = emphasis("i", "italic");
      const bold = emphasis("b", "bold");
      // Text, tabs and breaks, in their order.
      for (const [piece, text] of r.matchAll(
        /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>|<w:softHyphen\b[^>]*\/>/g,
      )) {
        if (piece.startsWith("<w:tab")) runs.push({ text: " ", italic, bold });
        else if (piece.startsWith("<w:noBreakHyphen")) runs.push({ text: "-", italic, bold });
        else if (piece.startsWith("<w:softHyphen")) continue;
        else if (piece.startsWith("<w:t")) runs.push({ text: fromXml(text ?? ""), italic, bold });
        else runs.push({ lineBreak: true });
      }
    }
    const words = runs
      .map((run) => ("text" in run ? run.text : "\n"))
      .join("")
      .trim();
    if (!words) continue;
    const level = headingLevel(styles, style, value(pPr, "w:outlineLvl"));
    if (/^([*#~·•—–-]\s*){3,}$|^[#*]$/.test(words)) paragraphs.push({ kind: "break" });
    else if (level) paragraphs.push({ kind: "heading", level: Math.min(level, 6), runs });
    else paragraphs.push({ kind: "text", runs });
  }
  if (paragraphs.length === 0) throw new Error("No text could be read in this Word document.");
  const core = files.get("docProps/core.xml");
  const coreXml = core ? decoder.decode(core) : "";
  const read = (tag: string) => {
    const found = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(coreXml)?.[1];
    return found ? fromXml(found).trim() || undefined : undefined;
  };
  const title = read("dc:title");
  const author = read("dc:creator");
  const language = read("dc:language");
  return {
    story: writeStory(paragraphs, {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(language ? { language } : {}),
    }),
    left: [...leftOut(xml), ...(boxes ? ["text boxes"] : [])],
  };
}
