import { type FountainKind, parseFountain } from "./fountain";
import { type FountainRun, fountainRuns } from "./inline";
import { MAX_LINES, MAX_SOURCE, readSource } from "./source";

export const MAX_FDX_IMPORT_BYTES = 8_000_000;
const MAX_XML_TAGS = 60_000;
const MAX_XML_DEPTH = 16;
export interface FdxImportResult {
  source: string;
  paragraphs: number;
  dualPairs: number;
  report: string[];
}
const kinds: Record<string, FountainKind> = {
  "Scene Heading": "scene",
  Action: "action",
  Character: "character",
  Dialogue: "dialogue",
  Parenthetical: "parenthetical",
  Transition: "transition",
};
const metadata = new Set([
  "TitlePage",
  "ScriptNotes",
  "ElementSettings",
  "PageLayout",
  "HeaderAndFooter",
  "SceneNumberOptions",
  "Revisions",
  "RevisionSets",
  "TagData",
  "Cast",
  "Characters",
  "Watermark",
  "SmartType",
  "SpellCheck",
  "BookmarkData",
  "Outline",
  "Colors",
]);
const paragraphAttributes = new Set([
  "Type",
  "Number",
  "Alignment",
  "FirstIndent",
  "LeftIndent",
  "RightIndent",
  "SpaceBefore",
  "Spacing",
  "StartsNewPage",
  "RevisionID",
  "Bookmark",
]);
const textAttributes = new Set([
  "Style",
  "Font",
  "Size",
  "Color",
  "Background",
  "RevisionID",
  "TagNumber",
]);
const escaped = (text: string) => text.replace(/[\\*_\[\]@!>~.#^<]/g, "\\$&");
function runsEqual(a: FountainRun[], b: FountainRun[]): boolean {
  const key = (runs: FountainRun[]) => {
    const out: FountainRun[] = [];
    for (const run of runs) {
      if (!run.text) continue;
      const last = out.at(-1);
      if (
        last &&
        last.bold === run.bold &&
        last.italic === run.italic &&
        last.underline === run.underline
      )
        last.text += run.text;
      else out.push({ ...run });
    }
    return JSON.stringify(out);
  };
  return key(a) === key(b);
}
/** Local, strict UTF-8 interchange import. DOMParser must be provided by a browser.
 * Unsupported body structure is rejected, never flattened into public screenplay.
 */
export function importFdx(bytes: Uint8Array): FdxImportResult {
  if (bytes.byteLength > MAX_FDX_IMPORT_BYTES)
    throw new Error("FDX import supports files up to 8 MB.");
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This FDX file is not valid UTF-8. Export a UTF-8 FDX copy and retry.");
  }
  const declaration = /^\s*<\?xml\s[^?]*\?>/i.exec(xml)?.[0] ?? "";
  const encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(declaration)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding))
    throw new Error("Only UTF-8 FDX files are supported.");
  // Do not ask an XML parser to interpret declarations, entities, CDATA or PIs.
  if (/<!|<\?/u.test(xml.slice(declaration.length)))
    throw new Error(
      "FDX declarations, entities, CDATA and processing instructions are not supported. Export a plain FDX copy.",
    );
  if ((xml.match(/</g)?.length ?? 0) > MAX_XML_TAGS)
    throw new Error("This FDX file has too many XML elements. Split it into smaller files.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror"))
    throw new Error("This FDX XML is malformed. Export a fresh FDX copy.");
  const root = document.documentElement;
  if (root.tagName !== "FinalDraft" || root.getAttribute("DocumentType") !== "Script")
    throw new Error("Choose a Final Draft Script (.fdx) file.");
  let nodes = 0;
  function inspect(element: Element, depth: number) {
    if (++nodes > MAX_XML_TAGS || depth > MAX_XML_DEPTH)
      throw new Error("This FDX XML exceeds the supported structure limits.");
    if (element.namespaceURI || [...element.attributes].some((attr) => attr.namespaceURI))
      throw new Error("Namespaced FDX structures are not supported.");
    for (const child of element.children) inspect(child, depth + 1);
  }
  inspect(root, 1);
  function children(element: Element): Element[] {
    if (
      [...element.childNodes].some(
        (node) =>
          (node.nodeType !== 1 && node.nodeType !== 3) ||
          (node.nodeType === 3 && node.textContent?.trim()),
      )
    )
      throw new Error("Unexpected text or structure outside FDX Text elements.");
    return [...element.children];
  }
  let excluded = 0;
  let layoutAttributes = 0;
  let unknownStyles = 0;
  let simplifiedStyles = 0;
  let normalizedWhitespace = 0;
  let importedCharacters = 0;
  let importedLines = 0;
  let content: Element | undefined;
  for (const child of children(root)) {
    if (child.tagName === "Content" && !content) content = child;
    else if (metadata.has(child.tagName)) excluded++;
    else
      throw new Error(
        "This FDX contains unsupported top-level structure. No screenplay was imported.",
      );
  }
  if (!content) throw new Error("This FDX has no screenplay Content.");
  if (content.attributes.length) throw new Error("Unsupported FDX Content settings.");
  type Paragraph = {
    kind: FountainKind;
    lines: { encoded: string; runs: FountainRun[] }[];
    number?: string;
    dual?: boolean;
  };
  const paragraphs: Paragraph[] = [];
  let dualPairs = 0;
  function attributes(element: Element, allowed: Set<string>, semantic: string[]) {
    for (const attr of element.attributes) {
      if (!allowed.has(attr.name))
        throw new Error(
          `Unsupported attribute on FDX ${element.tagName}. No screenplay was imported.`,
        );
      if (!semantic.includes(attr.name)) layoutAttributes++;
    }
  }
  function paragraph(element: Element): Paragraph {
    if (element.tagName !== "Paragraph")
      throw new Error(
        "Unsupported screenplay body structure. Only typed paragraphs and linked dual dialogue are supported.",
      );
    const kind = kinds[element.getAttribute("Type") ?? ""];
    if (!kind)
      throw new Error("This FDX uses an unsupported paragraph type. No screenplay was imported.");
    attributes(element, paragraphAttributes, ["Type", "Number", "Alignment"]);
    const alignment = element.getAttribute("Alignment");
    if (alignment && alignment !== "Left" && !(kind === "action" && alignment === "Center"))
      layoutAttributes++;
    const number = element.getAttribute("Number");
    if (number && (kind !== "scene" || !/^[\p{L}\p{N}.-]{1,80}$/u.test(number)))
      throw new Error("An FDX scene number cannot be represented safely in Fountain.");
    const rawLines: FountainRun[][] = [[]];
    for (const child of children(element)) {
      if (child.tagName === "ScriptNotes" || child.tagName === "ScriptNote") {
        excluded++;
        continue;
      }
      if (
        child.tagName !== "Text" ||
        child.children.length ||
        [...child.childNodes].some((node) => node.nodeType !== 3)
      )
        throw new Error("Unsupported content inside an FDX paragraph. No screenplay was imported.");
      attributes(child, textAttributes, ["Style"]);
      const styles = (child.getAttribute("Style") ?? "").split("+").filter(Boolean);
      if (styles.some((style) => !["Bold", "Italic", "Underline"].includes(style))) unknownStyles++;
      const text = child.textContent ?? "";
      importedCharacters += text.length;
      importedLines += text.match(/\n/g)?.length ?? 0;
      if (importedCharacters > MAX_SOURCE || importedLines > MAX_LINES)
        throw new Error(
          "This FDX body exceeds Studio’s 500,000-character / 20,000-line limit. Split it into smaller files.",
        );
      if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text.replace(/[\n\r\t]/g, "")))
        throw new Error("FDX text contains unsupported control or direction characters.");
      const parts = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
      if (text.includes("\t")) normalizedWhitespace++;
      for (let index = 0; index < parts.length; index++) {
        if (index) rawLines.push([]);
        rawLines.at(-1)?.push({
          text: parts[index] ?? "",
          bold: styles.includes("Bold"),
          italic: styles.includes("Italic"),
          underline: styles.includes("Underline"),
        });
      }
    }
    if (
      ["scene", "character", "transition", "parenthetical"].includes(kind) &&
      rawLines.length !== 1
    )
      throw new Error(
        "Multiline FDX headings, character cues, transitions and parentheticals need manual conversion.",
      );
    const lines = rawLines.map((originalRuns) => {
      let rawRuns = originalRuns;
      // Fountain trims structural/dialogue edges; disclose normalization explicitly.
      if (kind !== "action" || alignment === "Center") {
        const first = rawRuns.find((run) => run.text.length);
        const last = [...rawRuns].reverse().find((run) => run.text.length);
        if ((first && /^\s/.test(first.text)) || (last && /\s$/.test(last.text)))
          normalizedWhitespace++;
        let start = 0;
        let end = rawRuns.length;
        while (start < end && !rawRuns[start]?.text.trim()) start++;
        while (end > start && !rawRuns[end - 1]?.text.trim()) end--;
        rawRuns = rawRuns.slice(start, end);
        if (rawRuns[0]) rawRuns[0].text = rawRuns[0].text.trimStart();
        const final = rawRuns.at(-1);
        if (final) final.text = final.text.trimEnd();
      }
      let runs = rawRuns.filter((run) => run.text.length);
      let encoded = runs
        .map((run) => {
          const mark = `${run.bold ? "**" : ""}${run.italic ? "*" : ""}${run.underline ? "_" : ""}`;
          return mark + escaped(run.text) + [...mark].reverse().join("");
        })
        .join("");
      if (
        (kind === "scene" && encoded !== escaped(runs.map((run) => run.text).join(""))) ||
        (kind === "parenthetical" && (!encoded.startsWith("(") || !encoded.endsWith(")"))) ||
        !runsEqual(fountainRuns(encoded), runs)
      ) {
        if (runs.some((run) => run.bold || run.italic || run.underline)) simplifiedStyles++;
        runs = runs.map((run) => ({ ...run, bold: false, italic: false, underline: false }));
        encoded = escaped(runs.map((run) => run.text).join(""));
      }
      return { encoded, runs };
    });
    const result: Paragraph = {
      kind: kind === "action" && alignment === "Center" ? "centered" : kind,
      lines,
      ...(number ? { number } : {}),
    };
    paragraphs.push(result);
    return result;
  }
  for (const child of children(content)) {
    const descendants = children(child);
    if (
      child.tagName === "Paragraph" &&
      descendants.length === 1 &&
      descendants[0]?.tagName === "DualDialogue"
    ) {
      if (child.attributes.length || descendants[0].attributes.length)
        throw new Error("Unsupported dual-dialogue wrapper settings.");
      const speech = children(descendants[0]).map(paragraph);
      const cues = speech.filter((item) => item.kind === "character");
      if (
        cues.length !== 2 ||
        speech[0]?.kind !== "character" ||
        speech.some((item) => !["character", "dialogue", "parenthetical"].includes(item.kind))
      )
        throw new Error("A dual-dialogue pair must contain exactly two complete speeches.");
      const second = speech.indexOf(cues[1] as Paragraph);
      if (
        !speech.slice(1, second).some((item) => item.kind === "dialogue") ||
        !speech.slice(second + 1).some((item) => item.kind === "dialogue")
      )
        throw new Error("A dual-dialogue pair must contain exactly two complete speeches.");
      (cues[1] as Paragraph).dual = true;
      dualPairs++;
    } else paragraph(child);
  }
  if (!paragraphs.length) throw new Error("This FDX contains no supported screenplay paragraphs.");
  const output: string[] = [];
  const expected: { kind: FountainKind; runs: FountainRun[]; number?: string; dual?: boolean }[] =
    [];
  let speaker = false;
  let hasDialogue = false;
  for (const item of paragraphs) {
    if (item.kind !== "dialogue" && item.kind !== "parenthetical") {
      if (speaker && !hasDialogue)
        throw new Error("An FDX character cue has no dialogue. Repair it before importing.");
      speaker = item.kind === "character";
      hasDialogue = false;
      if (output.length) output.push("");
    } else if (!speaker)
      throw new Error("FDX dialogue has no preceding character cue. Repair it before importing.");
    if (item.kind === "dialogue") hasDialogue = true;
    for (const line of item.lines) {
      let text = line.encoded;
      if (item.kind === "action") text = `!${text}`;
      else if (item.kind === "scene") {
        if (!/^[\p{L}\p{N}]/u.test(text))
          throw new Error(
            "This scene heading cannot be forced safely in Fountain. Start it with a letter or number in the original file.",
          );
        text = `.${text}${item.number ? ` #${item.number}#` : ""}`;
      } else if (item.kind === "character") text = `@${text}${item.dual ? " ^" : ""}`;
      else if (item.kind === "transition") text = `>${text}`;
      else if (item.kind === "centered") text = `>${text}<`;
      else if (item.kind === "dialogue" && !text) text = "  ";
      output.push(text);
      expected.push({
        kind: item.kind,
        runs: line.runs,
        ...(item.number ? { number: item.number } : {}),
        ...(item.dual ? { dual: true } : {}),
      });
    }
  }
  if (speaker && !hasDialogue)
    throw new Error("An FDX character cue has no dialogue. Repair it before importing.");
  const source = output.join("\n");
  readSource(source);
  const parsed = parseFountain(source);
  const visible = parsed.elements.filter((element) => element.kind !== "blank");
  if (
    parsed.omissions.length ||
    parsed.warnings.length ||
    visible.length !== expected.length ||
    visible.some((element, index) => {
      const target = expected[index];
      return (
        !target ||
        element.kind !== target.kind ||
        element.sceneNumber !== target.number ||
        !!element.dual !== !!target.dual ||
        !runsEqual(fountainRuns(element.text), target.runs)
      );
    })
  )
    throw new Error(
      "Some FDX text cannot retain its exact text, styles and paragraph roles in Fountain. No screenplay was imported.",
    );
  return {
    source,
    paragraphs: paragraphs.length,
    dualPairs,
    report: [
      `${paragraphs.length} screenplay paragraphs and ${dualPairs} dual-dialogue pairs converted. Supported bold, italic, underline and scene numbers are retained, except simplifications listed below.`,
      `${excluded} title-page, script-note or metadata containers excluded. Private notes, original author/contact details and production metadata are not imported.`,
      `${layoutAttributes} layout/production attributes and ${unknownStyles} unsupported text style sets omitted; ${simplifiedStyles} lines simplified to plain text to preserve safe Fountain interpretation.`,
      `${normalizedWhitespace} text edges or tab-containing runs normalized. Paragraph spacing, pagination, fonts, revisions, paper, headers and footers are not transferred.`,
      "This supports a conservative FDX subset based on public producers, not the full Final Draft format. Native Final Draft round trips have not been verified. Keep the original FDX and review the imported screenplay before delivery.",
    ],
  };
}
