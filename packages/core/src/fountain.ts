/**
 * An import from Fountain (https://fountain.io), the plain-text screenplay format. Character cues
 * become marks, parentheticals directions, action narration, scene headings `{hidden}` headings,
 * page breaks `{page}`, notes `%% %%` and transitions notes. The cast is gathered from the cues.
 */
import { yamlScalar } from "./edit";
import { SPEC_VERSION } from "./version";

export type FountainOptions = {
  /** Read scene headings aloud instead of keeping them as hidden labels. Default false. */
  readSceneHeadings?: boolean;
};

type Paragraph = {
  kind: "action" | "heading" | "dialogue" | "note" | "page" | "section";
  text: string;
  level?: number;
};

const SCENE = /^(?:\.(?!\.)|(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[. ])/i;
const TRANSITION = /^[A-Z\s]+TO:$/;

/** Converts a Fountain screenplay into a VoxDown story. */
export function fromFountain(fountain: string, options: FountainOptions = {}): string {
  const source = fountain.replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = source.split("\n");
  const { meta, start } = titlePage(lines);
  const cast = new Map<string, string>();
  const out: Paragraph[] = [];

  let i = start;
  while (i < lines.length) {
    const line = (lines[i] ?? "").trimEnd();
    const blankBefore = i === 0 || (lines[i - 1] ?? "").trim() === "";
    const next = lines[i + 1] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (/^={3,}$/.test(line.trim())) {
      out.push({ kind: "page", text: "{page}" });
      i++;
      continue;
    }
    if (/^#+ /.test(line)) {
      const level = /^#+/.exec(line)?.[0].length ?? 1;
      out.push({ kind: "section", text: line.replace(/^#+\s*/, ""), level: Math.min(level, 6) });
      i++;
      continue;
    }
    if (/^=(?!=)/.test(line)) {
      out.push({ kind: "note", text: line.slice(1).trim() });
      i++;
      continue;
    }
    if (blankBefore && SCENE.test(line) && (next.trim() === "" || i + 1 >= lines.length)) {
      const heading = line
        .replace(/^\./, "")
        .replace(/\s*#[^#]+#\s*$/, "")
        .trim();
      out.push({ kind: "heading", text: heading });
      i++;
      continue;
    }
    if (line.startsWith(">") && !line.endsWith("<")) {
      out.push({ kind: "note", text: line.slice(1).trim() });
      i++;
      continue;
    }
    if (blankBefore && TRANSITION.test(line.trim()) && next.trim() === "") {
      out.push({ kind: "note", text: line.trim() });
      i++;
      continue;
    }
    if (blankBefore && isCue(line) && next.trim() !== "") {
      const cue = readCue(line);
      cast.set(cue.handle, cue.name);
      i++;
      const parts: Array<{ direction?: string; text?: string }> = [];
      while (i < lines.length && (lines[i] ?? "").trim() !== "") {
        const said = (lines[i] ?? "").trim();
        if (/^\(.*\)$/.test(said)) parts.push({ direction: said.slice(1, -1).trim() });
        else parts.push({ text: said.replace(/^~/, "") });
        i++;
      }
      out.push({ kind: "dialogue", text: dialogue(cue, parts) });
      continue;
    }
    // Action: every line up to the next blank line.
    const action: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "") {
      action.push(actionLine((lines[i] ?? "").trimEnd()));
      i++;
    }
    out.push({ kind: "action", text: action.join("\n") });
  }

  const front = ["---", `voxdown: ${SPEC_VERSION}`];
  if (meta.title) front.push(`title: ${yamlScalar(meta.title)}`);
  if (meta.author) front.push(`author: ${yamlScalar(meta.author)}`);
  if (cast.size) {
    front.push("cast:");
    for (const [handle, name] of cast) {
      front.push(name === handle ? `  ${handle}:` : `  ${handle}: ${yamlScalar(name)}`);
    }
  }
  front.push("---");
  const body = out.map((paragraph) => {
    switch (paragraph.kind) {
      case "heading":
        return `## ${escapeText(paragraph.text)}${options.readSceneHeadings ? "" : " {hidden}"}`;
      case "section":
        return `${"#".repeat(paragraph.level ?? 1)} ${escapeText(paragraph.text)} {hidden}`;
      case "note":
        return `%% ${paragraph.text.replace(/%%/g, "\\%%")} %%`;
      case "page":
        return "{page}";
      case "dialogue":
        return paragraph.text;
      case "action":
        return paragraph.text
          .split("\n")
          .map((line) => escapeText(line))
          .join("\n");
    }
  });
  return `${front.join("\n")}\n\n${body.join("\n\n")}\n`.replace(/\n{3,}/g, "\n\n");
}

function titlePage(lines: readonly string[]): {
  meta: { title?: string; author?: string };
  start: number;
} {
  if (!/^[A-Za-z][A-Za-z ]*:/.test(lines[0] ?? "")) return { meta: {}, start: 0 };
  const fields = new Map<string, string>();
  let key = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break;
    const match = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(line);
    if (match && !/^\s/.test(line)) {
      key = (match[1] ?? "").toLowerCase();
      fields.set(key, (match[2] ?? "").trim());
    } else if (key) {
      fields.set(key, `${fields.get(key) ?? ""} ${line.trim()}`.trim());
    }
  }
  const clean = (value: string | undefined) =>
    value?.replace(/[*_]+/g, "").replace(/\s+/g, " ").trim() || undefined;
  const title = clean(fields.get("title"));
  const author = clean(fields.get("author") ?? fields.get("authors"));
  return { meta: { ...(title ? { title } : {}), ...(author ? { author } : {}) }, start: i };
}

/** A character cue: a line in capitals (with an optional extension), or one forced with `@`. */
function isCue(line: string): boolean {
  const text = line.trim();
  if (text.startsWith("@")) return true;
  const name = text.replace(/\s*\(.*\)\s*$/, "").replace(/\s*\^$/, "");
  return /\p{Lu}/u.test(name) && name === name.toUpperCase() && !/[.!?:]$/.test(name);
}

type Cue = { handle: string; name: string; extension?: string };

function readCue(line: string): Cue {
  let text = line
    .trim()
    .replace(/^@/, "")
    .replace(/\s*\^$/, "");
  let extension: string | undefined;
  const ext = /\s*\(([^)]*)\)\s*$/.exec(text);
  if (ext) {
    text = text.slice(0, ext.index);
    const value = (ext[1] ?? "").trim();
    if (!/^CONT'?D$|^CONTINUED$|^CONT$/i.test(value)) extension = value;
  }
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => titleCase(word));
  const name = words.join(" ");
  const handle = words
    .map((word) => word.replace(/[^\p{L}\p{M}\p{N}_'’-]/gu, ""))
    .join("")
    .replace(/^[^\p{L}]+/u, "");
  return { handle: handle || "Someone", name, ...(extension ? { extension } : {}) };
}

/**
 * A word in capitals written as a name: `MARY-JANE` is Mary-Jane, `O'BRIEN` O'Brien, but `BOB'S`
 * is Bob's (a capital after an apostrophe only after one letter, as in O', D' or L').
 */
function titleCase(word: string): string {
  return word
    .toLowerCase()
    .replace(
      /(^|[-.]|(?<=^\p{L})['’])(\p{L})/gu,
      (_match, lead: string, letter: string) => lead + letter.toUpperCase(),
    );
}

/** `@Gerald (quietly) “Words. @(louder) More words.”`, with quotes inside the words escaped. */
function dialogue(cue: Cue, parts: ReadonlyArray<{ direction?: string; text?: string }>): string {
  const directions: string[] = cue.extension ? [cue.extension] : [];
  let i = 0;
  while (i < parts.length && parts[i]?.direction !== undefined) {
    directions.push(parts[i]?.direction as string);
    i++;
  }
  const words: string[] = [];
  for (; i < parts.length; i++) {
    const part = parts[i];
    if (part?.direction !== undefined) words.push(`@(${part.direction})`);
    else if (part?.text) words.push(escapeText(part.text).replace(/(["“”])/g, "\\$1"));
  }
  const mark = directions.length ? `@${cue.handle} (${directions.join(", ")})` : `@${cue.handle}`;
  return `${mark} “${words.join(" ")}”`;
}

function actionLine(line: string): string {
  return line
    .replace(/^!/, "")
    .replace(/^>\s*(.*?)\s*<$/, "$1")
    .replace(/^~/, "");
}

/** Story text with VoxDown's own signs made literal, and Fountain notes made notes. */
function escapeText(text: string): string {
  const notes: string[] = [];
  const kept = text.replace(/\[\[([\s\S]*?)\]\]/g, (_m, note: string) => {
    notes.push(`%% ${note.trim()} %%`);
    return `\uE000${notes.length - 1}\uE000`;
  });
  const escaped = kept
    .replace(/\\/g, "\\\\")
    .replace(/([[\]{}])/g, "\\$1")
    .replace(/%%/g, "\\%%")
    .replace(/(^|[^\p{L}\p{N}])@(?=[\p{L}([])/gu, "$1\\@")
    .replace(/^(#{1,6}\s|:{3,}|([-*_])[ \t]*(?:\2[ \t]*){2,}$)/, "\\$1");
  return escaped.replace(/\uE000(\d+)\uE000/g, (_m, index: string) => notes[Number(index)] ?? "");
}
