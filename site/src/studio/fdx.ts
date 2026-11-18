import { type FountainElement, type FountainKind, parseFountain } from "./fountain";
import { fountainRuns } from "./inline";
import { assertUnambiguousOmissions } from "./public-source";
import { readSource } from "./source";

export const MAX_FDX_BYTES = 8_000_000;
export interface FdxExport {
  xml: string;
  bytes: number;
  paragraphs: number;
  dualPairs: number;
  report: string[];
}
const types: Partial<Record<FountainKind, string>> = {
  scene: "Scene Heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
  centered: "Action",
  lyric: "Dialogue",
};
const titleFields = [
  "title",
  "credit",
  "author",
  "authors",
  "source",
  "draft date",
  "contact",
  "copyright",
];
const speechKinds = new Set<FountainKind>(["dialogue", "parenthetical", "lyric"]);
const excluded = new Set<FountainKind>(["note", "boneyard", "title", "section", "synopsis"]);

/** XML 1.0 text only: no DTD, entity definitions, external references or raw markup. */
function escapeXml(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if (
      (code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      throw new Error(
        "The printable screenplay contains a character XML cannot represent. Remove control characters or incomplete Unicode before exporting FDX.",
      );
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function text(value: string): string {
  const runs = fountainRuns(value);
  return runs.length
    ? runs
        .map((run) => {
          const style = [run.bold && "Bold", run.italic && "Italic", run.underline && "Underline"]
            .filter(Boolean)
            .join("+");
          return `<Text${style ? ` Style="${style}"` : ""}>${escapeXml(run.text)}</Text>`;
        })
        .join("")
    : "<Text></Text>";
}

/** Conservative FDX interchange; the Fountain source remains the document of record.
 * Verified format references and deliberate omissions: docs/plans/studio-fdx.md.
 */
export function exportFdx(source: string, options: { includeTitle?: boolean } = {}): FdxExport {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error("Close unfinished private notes and omitted passages before exporting FDX.");
  assertUnambiguousOmissions(source, document);
  const includeTitle = options.includeTitle !== false;
  let paragraphs = 0;
  let dualPairs = 0;
  let orphanDual = 0;
  let outputLength = 0;
  const output: string[] = [];
  const append = (value: string) => {
    outputLength += value.length;
    if (outputLength > MAX_FDX_BYTES)
      throw new Error(
        "The FDX export exceeds the 8 MB limit. Split this screenplay into smaller files.",
      );
    output.push(value);
  };
  const paragraph = (elements: FountainElement[]) => {
    const first = elements[0] as FountainElement;
    paragraphs++;
    return `<Paragraph Type="${types[first.kind]}"${first.kind === "centered" ? ' Alignment="Center"' : ""}${first.sceneNumber !== undefined ? ` Number="${escapeXml(first.sceneNumber)}"` : ""}>${elements.map((element, index) => text(element.text) + (index < elements.length - 1 ? "<Text>\n</Text>" : "")).join("")}</Paragraph>\n`;
  };
  const elements = document.elements.filter((element) => !excluded.has(element.kind));
  const speechEnd = (index: number) => {
    let end = index + 1;
    while (elements[end] && speechKinds.has((elements[end] as FountainElement).kind)) end++;
    return end;
  };
  const writeRange = (start: number, end: number) => {
    for (let i = start; i < end; ) {
      const element = elements[i] as FountainElement;
      if (!types[element.kind]) {
        i++;
        continue;
      }
      let next = i + 1;
      if (element.kind === "action" || element.kind === "dialogue" || element.kind === "lyric")
        while (next < end && elements[next]?.kind === element.kind) next++;
      append(paragraph(elements.slice(i, next)));
      i = next;
    }
  };
  append(
    '<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script" Template="No" Version="1">\n<Content>\n',
  );
  for (let i = 0; i < elements.length; ) {
    const element = elements[i] as FountainElement;
    if (element.kind === "character") {
      const end = speechEnd(i);
      let next = end;
      while (elements[next]?.kind === "blank") next++;
      if (
        elements[next]?.kind === "character" &&
        elements[next]?.dual &&
        !element.dual &&
        end > i + 1 &&
        speechEnd(next) > next + 1
      ) {
        append("<Paragraph><DualDialogue>\n");
        writeRange(i, end);
        const rightEnd = speechEnd(next);
        writeRange(next, rightEnd);
        append("</DualDialogue></Paragraph>\n");
        dualPairs++;
        i = rightEnd;
      } else {
        if (element.dual) orphanDual++;
        writeRange(i, end);
        i = end;
      }
    } else {
      let end = i + 1;
      while (end < elements.length && elements[end]?.kind !== "character") end++;
      writeRange(i, end);
      i = end;
    }
  }
  append("</Content>\n");
  const fields = titleFields.filter((key) => document.title[key]?.trim());
  if (includeTitle && fields.length) {
    append("<TitlePage><Content>\n");
    for (const key of fields) {
      for (const line of (document.title[key] as string).split("\n"))
        append(
          `<Paragraph${["title", "credit", "author", "authors", "source"].includes(key) ? ' Alignment="Center"' : ""}>${text(line)}</Paragraph>\n`,
        );
    }
    append("</Content></TitlePage>\n");
  }
  append("</FinalDraft>\n");
  const xml = output.join("");
  const bytes = new TextEncoder().encode(xml).byteLength;
  if (bytes > MAX_FDX_BYTES)
    throw new Error(
      "The FDX export exceeds the 8 MB limit. Split this screenplay into smaller files.",
    );
  const count = (kind: FountainKind) =>
    document.elements.filter((element) => element.kind === kind).length;
  const unknownFields = Object.keys(document.title).filter(
    (key) => !titleFields.includes(key),
  ).length;
  const report = [
    `${paragraphs} screenplay paragraphs; ${dualPairs} linked dual-dialogue pairs. Bold, italic, underline and scene numbers are retained.`,
    `Private notes and omitted passages are excluded (${document.omissions.length} completed passages). Outline headings and summaries are excluded (${count("section") + count("synopsis")} lines).`,
    includeTitle
      ? `${fields.length} recognized title-page fields included, including author/contact details when present. Title-page layout is simplified.`
      : "All title-page fields are excluded by your choice.",
    "Pagination, paper size, margins, fonts, headers, footers and production revisions are not transferred. Blank separators use the receiving app's paragraph spacing. Review its layout before sharing. Keep your Fountain file for exact source and backups.",
    "FDX compatibility is based on public exporter implementations. Opening this file in Final Draft itself has not been verified here.",
  ];
  if (unknownFields) report.push(`${unknownFields} unrecognized title-page fields omitted.`);
  if (count("page-break"))
    report.push(`${count("page-break")} explicit page breaks omitted; page positions may change.`);
  if (count("lyric"))
    report.push(
      `${count("lyric")} lyric lines converted to Dialogue without a dedicated lyric type.`,
    );
  if (count("centered"))
    report.push(`${count("centered")} centered lines exported as centered Action.`);
  if (orphanDual)
    report.push(
      `${orphanDual} unpaired dual-dialogue cues exported as ordinary Character paragraphs.`,
    );
  return { xml, bytes, paragraphs, dualPairs, report };
}
