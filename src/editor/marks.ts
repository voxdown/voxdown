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
  | { kind: "in-group"; from: number; to: number };

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
    for (const item of line.items) {
      switch (item.kind) {
        case "speech":
          if (item.speaker.toLowerCase() !== narrator && item.textRange.to > item.textRange.from)
            out.push({ kind: "speech", ...item.textRange, speaker: item.speaker });
          if (item.ownDirection && item.textRange.to > item.textRange.from)
            out.push({ kind: "directed", ...item.textRange });
          break;
        case "mark":
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
          out.push({ kind: "vocal", ...item.range, speaker: item.speaker, text: item.description });
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

  const body = story.frontMatter ? story.frontMatter.range.to : 0;
  for (const m of story.source.slice(body).matchAll(ESCAPE))
    out.push({ kind: "escape", from: body + (m.index ?? 0), to: body + (m.index ?? 0) + 1 });
  return out;
}

export function editorMarks(source: string): EditorMark[] {
  return marksOf(parse(source));
}
