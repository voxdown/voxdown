/** Native Fountain interpretation. The source remains the document of record.
 * Syntax reference: https://fountain.io/syntax/
 * Each physical line has an element; offsets address the original UTF-16 source,
 * excluding its newline. Inline emphasis and escapes are left for the renderer.
 */
export type FountainKind =
  | "scene"
  | "action"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition"
  | "centered"
  | "lyric"
  | "section"
  | "synopsis"
  | "note"
  | "boneyard"
  | "page-break"
  | "title"
  | "blank";

export interface FountainElement {
  kind: FountainKind;
  text: string;
  from: number;
  to: number;
  line: number;
  sceneNumber?: string;
  dual?: boolean;
  level?: number;
}

export interface FountainDocument {
  elements: FountainElement[];
  title: Record<string, string>;
  warnings: { line: number; message: string }[];
  omissions: FountainOmission[];
}

interface SourceLine {
  raw: string;
  text: string;
  from: number;
  to: number;
  line: number;
  omitted?: "note" | "boneyard";
}

export interface FountainOmission {
  from: number;
  to: number;
  kind: "note" | "boneyard";
}

function sourceLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  const endings = /\r\n|\n|\r/g;
  let from = 0;
  for (let match = endings.exec(source); match; match = endings.exec(source)) {
    const raw = source.slice(from, match.index);
    result.push({ raw, text: raw, from, to: match.index, line: result.length + 1 });
    from = match.index + match[0].length;
  }
  const raw = source.slice(from);
  result.push({ raw, text: raw, from, to: source.length, line: result.length + 1 });
  return result;
}

function escaped(source: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/** Only completed comments are omitted. Malformed comments stay printable. */
function removeComments(
  source: string,
  lines: SourceLine[],
  warnings: FountainDocument["warnings"],
) {
  const omissions: FountainOmission[] = [];
  let active: { from: number; line: number; kind: "note" | "boneyard" } | undefined;
  const incomplete = () => {
    if (!active) return;
    warnings.push({
      line: active.line,
      message:
        active.kind === "note"
          ? "Unclosed note: add ]] before an empty line. Its text is kept in the screenplay."
          : "Unclosed boneyard: add */. Its text is kept in the screenplay.",
    });
    active = undefined;
  };
  for (const line of lines) {
    // Two spaces intentionally connect a multi-line note across a blank line.
    if (active?.kind === "note" && /^[ \t]?$/.test(line.raw)) incomplete();
    for (let at = line.from; at < line.to - 1; at++) {
      const pair = source.slice(at, at + 2);
      if (pair !== "[[" && pair !== "]]" && pair !== "/*" && pair !== "*/") continue;
      if (escaped(source, at)) continue;
      if (active) {
        if (pair === (active.kind === "note" ? "]]" : "*/")) {
          omissions.push({ from: active.from, to: at + 2, kind: active.kind });
          active = undefined;
          at++;
        }
      } else if (pair === "[[" || pair === "/*") {
        active = { from: at, line: line.line, kind: pair === "[[" ? "note" : "boneyard" };
        at++;
      }
    }
  }
  incomplete();
  let cursor = 0;
  for (const line of lines) {
    while ((omissions[cursor]?.to ?? Number.POSITIVE_INFINITY) <= line.from) cursor++;
    let from = line.from;
    let text = "";
    let hidden: FountainOmission["kind"] | undefined;
    for (let i = cursor; i < omissions.length; i++) {
      const omission = omissions[i];
      if (!omission || omission.from > line.to) break;
      text += source.slice(from, Math.max(from, omission.from));
      from = Math.min(line.to, omission.to);
      hidden = omission.kind;
      if (omission.to >= line.to) break;
    }
    text += source.slice(from, line.to);
    line.text = text;
    if (hidden && !text.trim()) line.omitted = hidden;
  }
  return omissions;
}

function uppercaseCue(text: string): boolean {
  const trimmed = text.trim();
  const extension = trimmed.endsWith(")") ? trimmed.lastIndexOf("(") : -1;
  const name = (extension < 0 ? trimmed : trimmed.slice(0, extension)).trim();
  return /\p{Lu}/u.test(name) && !/\p{Ll}/u.test(name);
}

export function parseFountain(source: string): FountainDocument {
  const document: FountainDocument = {
    elements: [],
    title: Object.create(null),
    warnings: [],
    omissions: [],
  };
  const lines = sourceLines(source);
  document.omissions = removeComments(source, lines, document.warnings);
  const first = lines[0];
  if (first) first.text = first.text.replace(/^\uFEFF/, "");
  const following: (SourceLine | undefined)[] = new Array(lines.length);
  let visible: SourceLine | undefined;
  for (let index = lines.length - 1; index >= 0; index--) {
    following[index] = visible;
    const line = lines[index];
    if (line && !line.omitted) visible = line;
  }
  let dialogue = false;
  let titlePage = true;
  let titleKey = "";
  let boundary = true;

  for (const [index, line] of lines.entries()) {
    const text = line.text.trim();
    const element: FountainElement = {
      kind: "action",
      text: line.text.replace(/\t/g, "    "),
      from: line.from,
      to: line.to,
      line: line.line,
    };
    document.elements.push(element);

    if (line.omitted) {
      element.kind = line.omitted;
      element.text = "";
      continue;
    }

    if (titlePage) {
      const field = /^([\p{L}_][\p{L}\p{N} _-]*):(?:[ \t]*(.*))$/u.exec(line.text);
      // CUT TO: at the beginning is a transition, not title metadata.
      if (field && !(/TO:$/.test(line.text.trimEnd()) && uppercaseCue(line.text))) {
        titleKey = (field[1] ?? "").trim().toLowerCase();
        const value = field[2] ?? "";
        document.title[titleKey] = document.title[titleKey]
          ? `${document.title[titleKey]}\n${value}`
          : value;
        element.kind = "title";
        element.text = value;
        continue;
      }
      if (titleKey && /^(?: {3,}|\t)/.test(line.text) && text) {
        document.title[titleKey] += `${document.title[titleKey] ? "\n" : ""}${text}`;
        element.kind = "title";
        element.text = text;
        continue;
      }
      titlePage = false;
    }

    if (!text) {
      if (dialogue && /^ {2,}$/.test(line.text)) {
        element.kind = "dialogue";
      } else {
        element.kind = "blank";
        dialogue = false;
        boundary = true;
      }
      element.text = "";
      continue;
    }

    const forcedScene = /^\.[\p{L}\p{N}]/u.test(text);
    const scene = /^(?:INT\.?\/EXT|INT|EXT|EST|I\/E)(?:[. ]|$)/i.test(text);
    const section = /^(#+)\s*(.*)$/.exec(text);
    const dual = text.endsWith("^") && !escaped(text, text.length - 1);
    const cue = dual ? text.slice(0, -1).trimEnd() : text;
    const next = following[index];
    if (text.startsWith("!")) {
      element.text = line.text.replace("!", "").replace(/\t/g, "    ");
      dialogue = false;
    } else if (forcedScene || (boundary && scene)) {
      element.kind = "scene";
      element.text = forcedScene ? text.slice(1) : text;
      const number = /#([\p{L}\p{N}.-]+)#$/u.exec(element.text);
      if (number?.[1] && /\s/.test(element.text[number.index - 1] ?? "")) {
        element.sceneNumber = number[1];
        element.text = element.text.slice(0, number.index).trimEnd();
      }
      dialogue = false;
    } else if (section) {
      element.kind = "section";
      element.level = section[1]?.length ?? 1;
      element.text = section[2] ?? "";
      dialogue = false;
    } else if (/^={3,}$/.test(text)) {
      element.kind = "page-break";
      element.text = "";
      dialogue = false;
    } else if (text.startsWith("=")) {
      element.kind = "synopsis";
      element.text = text.slice(1).trim();
      dialogue = false;
    } else if (text.startsWith(">")) {
      element.kind = text.endsWith("<") ? "centered" : "transition";
      element.text = text.slice(1, element.kind === "centered" ? -1 : undefined).trim();
      dialogue = false;
    } else if (text.startsWith("~")) {
      element.kind = "lyric";
      element.text = text.slice(1);
    } else if (boundary && /TO:$/.test(line.text) && uppercaseCue(text) && !next?.text.trim()) {
      element.kind = "transition";
      element.text = text;
      dialogue = false;
    } else if (
      text.startsWith("@") ||
      (boundary &&
        !text.startsWith("\\") &&
        next &&
        (next.text.trim() || /^ {2,}$/.test(next.text)) &&
        uppercaseCue(cue))
    ) {
      element.kind = "character";
      element.text = cue.startsWith("@") ? cue.slice(1).trim() : cue;
      if (dual) element.dual = true;
      dialogue = true;
    } else if (dialogue) {
      element.kind = text.startsWith("(") && text.endsWith(")") ? "parenthetical" : "dialogue";
      element.text = text;
    }
    boundary = false;
  }
  return document;
}
