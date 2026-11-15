/**
 * A manuscript to submit, in the standard manuscript format agents and editors ask for (as
 * William Shunn sets it out): a Word document in Times New Roman, 12 point, double-spaced, with
 * one-inch margins and each paragraph's first line set in half an inch. The first page has the
 * writer's name and contact at the top left, the word count at the top right, and the title and
 * byline halfway down; every page after has the surname, a word of the title and the page number
 * at the top right. Chapters start on a new page, a third of the way down; a scene, after a
 * break or under a heading of its own, starts after a centred `#`; italics stay italics; the
 * story ends with `END`.
 */
import { chapterLevelOf } from "voxdown";
import { type Paragraph, type Run, xmlText } from "./convert";
import { zip } from "./zip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export type ManuscriptDetails = {
  title: string;
  /** The name the story is published under. */
  byline: string;
  /** The writer's legal name and how to reach them, a line each: the first page's top left. */
  contact: string;
  /** The surname for the running header. */
  surname: string;
  /** The words of the story. */
  words: number;
  language?: string;
  /** The level the chapters' headings are (voxdown's `chapterLevel`); a heading under it is a scene's. */
  chapterLevel?: number;
};

/** "about 3,500 words": to the nearest hundred, or the nearest thousand from 10,000 words. */
export function wordsAbout(words: number): string {
  const step = words >= 10000 ? 1000 : 100;
  const about = Math.max(step, Math.round(words / step) * step);
  return `about ${about.toLocaleString("en-US")} words`;
}

/** The title's word for the running header: its first that isn't an article, in capitals. */
export function headerWord(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  const kept = words.find((word) => !/^(the|a|an|le|la|les|der|die|das|el|los|las)$/i.test(word));
  return (kept ?? words[0] ?? "").replace(/[^\p{L}\p{N}’'-]/gu, "").toUpperCase();
}

function runXml(run: Run): string {
  if ("lineBreak" in run) return "<w:r><w:br/></w:r>";
  if (!run.text) return "";
  const style = `${run.bold ? "<w:b/>" : ""}${run.italic ? "<w:i/>" : ""}`;
  return `<w:r>${style ? `<w:rPr>${style}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlText(run.text)}</w:t></w:r>`;
}

const plain = (text: string, properties = "") =>
  `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;

/** The manuscript as a Word document. */
export function manuscriptDocx(
  paragraphs: readonly Paragraph[],
  details: ManuscriptDetails,
): Uint8Array {
  const single = '<w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/>';
  const contactLines = details.contact
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // The first page: name and contact, single-spaced, the words on the right of the first line.
  const top = contactLines.length ? contactLines : [details.byline];
  const first = top
    .map((line, index) =>
      index === 0
        ? `<w:p><w:pPr>${single}<w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">${xmlText(line)}</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">${xmlText(wordsAbout(details.words))}</w:t></w:r></w:p>`
        : plain(line, single),
    )
    .join("");
  // Halfway down the page: the title, and the byline under it.
  const title = `${plain("", '<w:spacing w:before="3600"/>')}${plain(details.title, '<w:jc w:val="center"/><w:ind w:firstLine="0"/>')}${plain(`by ${details.byline}`, '<w:jc w:val="center"/><w:ind w:firstLine="0"/>')}${plain("")}`;
  const level =
    details.chapterLevel ??
    chapterLevelOf(paragraphs.flatMap((each) => (each.kind === "heading" ? [each.level] : []))) ??
    1;
  let chapters = 0;
  // A scene break between words of the same chapter: never two together, never at a chapter's
  // start or end. It waits for the words after it.
  let text = false;
  let pending = false;
  const sceneBreak = () => {
    pending = text;
    return "";
  };
  const body = paragraphs
    .map((paragraph) => {
      if (paragraph.kind === "break") return sceneBreak();
      if (paragraph.kind === "heading") {
        // A heading over the chapters (the book's own title, a part's): the title page has it.
        if (paragraph.level < level) return "";
        // A scene's heading: a break, as the format has them, not a page of its own.
        if (paragraph.level > level) return sceneBreak();
        // A chapter on a new page, a third of the way down; the first follows the title.
        text = false;
        pending = false;
        const newPage = chapters++ > 0 ? "<w:pageBreakBefore/>" : "";
        const runs = paragraph.runs.map(runXml).join("");
        return `<w:p><w:pPr>${newPage}<w:spacing w:before="${newPage ? 2880 : 0}"/><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr>${runs}</w:p>${plain("")}`;
      }
      const before = pending ? plain("#", '<w:jc w:val="center"/><w:ind w:firstLine="0"/>') : "";
      text = true;
      pending = false;
      return `${before}<w:p>${paragraph.runs.map(runXml).join("")}</w:p>`;
    })
    .join("");
  const end = plain(
    "END",
    '<w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="480"/>',
  );
  const language = details.language ? `<w:lang w:val="${xmlText(details.language)}"/>` : "";
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${first}${title}${body}${end}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;
  // Every page after the first: Surname / WORD / page, at the top right.
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:t xml:space="preserve">${xmlText(`${details.surname} / ${headerWord(details.title)} / `)}</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/>${language}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/><w:ind w:firstLine="720"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    { name: "word/header1.xml", data: header },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlText(details.title)}</dc:title><dc:creator>${xmlText(details.byline)}</dc:creator></cp:coreProperties>`,
    },
  ]);
}
