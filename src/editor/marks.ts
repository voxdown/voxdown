import type { Item, Line, Story } from "../model";
import { parse } from "../parse";

/**
 * What the editor draws, worked out from the parsed story: each mark with its range in the text.
 * Speech by a character is underlined in their colour; marks become chips on lines you aren't
 * typing in; lines inside a group get a bar beside them.
 */
export type EditorMark =
  | { kind: "speech"; from: number; to: number; speaker: string }
  /** Words a direction of their own applies to: dashed, as on Performance's page. */
  | { kind: "directed"; from: number; to: number }
  | { kind: "name"; from: number; to: number; speaker: string }
  | { kind: "direction"; from: number; to: number; text: string }
  | { kind: "cleared"; from: number; to: number }
  | { kind: "sound"; from: number; to: number; text: string }
  | { kind: "vocal"; from: number; to: number; speaker: string; text: string }
  | { kind: "page"; from: number; to: number; label?: string; ownLine: boolean }
  | { kind: "pause"; from: number; to: number; value?: string }
  | { kind: "instruction"; from: number; to: number; text: string; raw: string }
  | { kind: "note"; from: number; to: number; text: string }
  | { kind: "group"; from: number; to: number; text: string; speaker?: string; close?: boolean }
  | { kind: "heading"; from: number; to: number; text: string; hidden: boolean }
  | { kind: "break"; from: number; to: number }
  | { kind: "escape"; from: number; to: number }
  | { kind: "frontmatter"; from: number; to: number }
  | { kind: "in-group"; from: number; to: number }
  /** Something that probably isn't what was meant: an unclosed quote, a bracket left open. */
  | { kind: "warning"; from: number; to: number; message: string };

/** Warnings worth an underline while typing (the rest are for whole-file checks). */
const WARNED = new Set([
  "unclosed-quote",
  "quote-over-line-break",
  "stray-quote",
  "idle-mark",
  "unknown-instruction",
  "pause-value",
  "sound-looks-like-link",
  "unclosed-note",
  "unclosed-group",
  "stray-group-close",
]);

const INSTRUCTIONS = ["page", "pause", "book only", "audio only", "hidden"];

/** Edits between two words, a swap of neighbouring letters counting as one (pasue → pause). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => d[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = d[i];
      if (row) row[j] = best;
    }
  return at(a.length, b.length);
}

/** Warnings in the words of someone writing a story, with a likely fix where there is one. */
function plain(warning: Story["warnings"][number], source: string): string {
  if (warning.code === "unknown-instruction") {
    const raw = source.slice(warning.range.from, warning.range.to);
    const name =
      raw
        .replace(/^\{|\}$/gu, "")
        .trim()
        .split(/\s+/u)[0] ?? "";
    const scored = INSTRUCTIONS.map((i) => ({
      i,
      d: distance(name.toLowerCase(), i.split(" ")[0] ?? i),
    })).sort((x, y) => x.d - y.d);
    const near = scored[0] && scored[0].d <= 2 ? scored[0].i : undefined;
    return near
      ? `${raw} isn't an instruction. Did you mean {${near}}?`
      : `${raw} isn't an instruction this editor knows: it's kept, but does nothing.`;
  }
  return warning.message;
}

export { distance as editDistance };

/** A `[` or `{` with no partner on its line reads aloud as text: say so where it is. */
function unclosedBrackets(story: Story): EditorMark[] {
  const out: EditorMark[] = [];
  const body = story.frontMatter ? story.frontMatter.range.to : 0;
  const inNote = (at: number) =>
    story.blocks.some(
      (b) =>
        b.kind === "paragraph" &&
        b.lines.some((l) =>
          l.items.some((i) => i.kind === "note" && i.range.from <= at && at < i.range.to),
        ),
    );
  let offset = body;
  for (const line of story.source.slice(body).split("\n")) {
    for (const [open, close, what] of [
      ["[", "]", "A sound needs its closing ]"],
      ["{", "}", "An instruction needs its closing }"],
    ] as const) {
      let depth = 0;
      let first = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "\\") {
          i++;
          continue;
        }
        if (line[i] === open) {
          if (depth === 0) first = i;
          depth++;
        } else if (line[i] === close && depth > 0) depth--;
      }
      if (depth > 0 && first >= 0 && !inNote(offset + first))
        out.push({ kind: "warning", from: offset + first, to: offset + first + 1, message: what });
    }
    offset += line.length + 1;
  }
  return out;
}

const ESCAPE = /\\[!-/:-@[-`{-~“”‘’„‚«»‹›「」『』]/gu;

function lineIsOnly(story: Story, line: Line, item: Item) {
  return (
    story.source.slice(line.range.from, line.range.to).trim() ===
    story.source.slice(item.range.from, item.range.to)
  );
}

export function marksOf(story: Story): EditorMark[] {
  const out: EditorMark[] = [];
  const narrator = story.meta.narrator.toLowerCase();
  if (story.frontMatter) out.push({ kind: "frontmatter", ...story.frontMatter.range });

  for (const group of story.groups) {
    out.push({
      kind: "group",
      from: group.range.from,
      to: group.range.to,
      text: group.direction ?? "",
      ...(group.character ? { speaker: group.character } : {}),
    });
    if (group.closeRange) out.push({ kind: "group", ...group.closeRange, text: "", close: true });
  }

  const visit = (line: Line) => {
    // A character's sound and the mark before it are one chip: "Pickle · peep".
    const vocalMarks = new Set(
      line.items.flatMap((i) => (i.kind === "vocal" && i.mark ? [i.mark.range.from] : [])),
    );
    for (const item of line.items) {
      switch (item.kind) {
        case "speech":
          if (item.speaker.toLowerCase() !== narrator && item.textRange.to > item.textRange.from)
            out.push({ kind: "speech", ...item.textRange, speaker: item.speaker });
          if (item.ownDirection && item.textRange.to > item.textRange.from)
            out.push({ kind: "directed", ...item.textRange });
          break;
        case "mark":
          if (vocalMarks.has(item.range.from)) {
            if (item.directionRange)
              out.push({ kind: "direction", ...item.directionRange, text: item.direction ?? "" });
            break;
          }
          // The chip stands for `@Name`, the at sign included.
          out.push({
            kind: "name",
            from: item.range.from,
            to: item.nameRange.to,
            speaker: item.speaker,
          });
          if (item.directionRange)
            out.push({ kind: "direction", ...item.directionRange, text: item.direction ?? "" });
          break;
        case "direction":
          if (item.direction) out.push({ kind: "direction", ...item.range, text: item.direction });
          else out.push({ kind: "cleared", ...item.range });
          break;
        case "vocal":
          out.push({
            kind: "vocal",
            from: item.mark && !item.mark.directionRange ? item.mark.range.from : item.range.from,
            to: item.range.to,
            speaker: item.speaker,
            text: item.description,
          });
          if (item.mark?.directionRange)
            out.push({
              kind: "name",
              from: item.mark.range.from,
              to: item.mark.nameRange.to,
              speaker: item.speaker,
            });
          break;
        case "sound":
          out.push({ kind: "sound", ...item.range, text: item.description });
          break;
        case "note":
          out.push({ kind: "note", ...item.range, text: item.text });
          break;
        case "instruction":
          if (item.name === "page")
            out.push({
              kind: "page",
              ...item.range,
              ...(item.value ? { label: item.value } : {}),
              ownLine: lineIsOnly(story, line, item),
            });
          else if (item.name === "pause")
            out.push({
              kind: "pause",
              ...item.range,
              ...(item.value ? { value: item.value } : {}),
            });
          else
            out.push({
              kind: "instruction",
              ...item.range,
              text: item.value ? `${item.name} ${item.value}` : item.name,
              raw: item.raw,
            });
          break;
        case "image":
          break;
      }
    }
  };

  for (const block of story.blocks) {
    if (block.kind === "break") out.push({ kind: "break", ...block.range });
    else if (block.kind === "heading") {
      const words = block.line.items
        .filter((i) => i.kind === "speech")
        .map((i) => (i.kind === "speech" ? i.text : ""))
        .join(" ")
        .trim();
      out.push({
        kind: "heading",
        ...block.range,
        text:
          words || story.source.slice(block.range.from, block.range.to).replace(/^\s*#+\s*/u, ""),
        hidden: block.visibility === "hidden" || block.visibility === "book",
      });
    } else {
      for (const line of block.lines) {
        if (block.groups.length)
          out.push({ kind: "in-group", from: line.range.from, to: line.range.from });
        visit(line);
      }
    }
  }

  const unclosed = new Set(
    story.warnings.filter((w) => w.code === "unclosed-quote").map((w) => w.range.from),
  );
  for (const warning of story.warnings) {
    if (warning.severity !== "warning" || !WARNED.has(warning.code)) continue;
    // One underline per mistake: a quote never closed also runs over a line break.
    if (warning.code === "quote-over-line-break" && unclosed.has(warning.range.from)) continue;
    const to = Math.max(warning.range.to, Math.min(story.source.length, warning.range.from + 1));
    out.push({
      kind: "warning",
      from: warning.range.from,
      to,
      message: plain(warning, story.source),
    });
  }
  for (const open of unclosedBrackets(story)) out.push(open);

  const body = story.frontMatter ? story.frontMatter.range.to : 0;
  for (const m of story.source.slice(body).matchAll(ESCAPE))
    out.push({ kind: "escape", from: body + (m.index ?? 0), to: body + (m.index ?? 0) + 1 });
  return out;
}

export function editorMarks(source: string): EditorMark[] {
  return marksOf(parse(source));
}
