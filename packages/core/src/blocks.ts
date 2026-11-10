/**
 * The story's block structure (§4.4): paragraphs, headings, scene breaks and group lines. Notes are
 * found first, because they may run across lines and even blank lines (§10); the lines a note runs
 * over become one line.
 */
import { cleanText, isEscapable } from "./chars";
import type { Range, SourceLine } from "./source";
import type { Warn } from "./warnings";

/** A note, `%% … %%`. `text` is what is between the signs, unescaped, spaces run together. */
export type NoteSpan = Range & { text: string };

export type RawBlock =
  | { kind: "paragraph"; lines: Range[]; range: Range }
  | { kind: "heading"; level: number; content: Range; range: Range }
  | { kind: "break"; range: Range }
  | { kind: "group-open"; content: Range; range: Range }
  | { kind: "group-close"; range: Range };

/** Finds every note from `from` to the end. An unclosed `%%` stays text. */
export function findNotes(source: string, from: number, warn: Warn): NoteSpan[] {
  const notes: NoteSpan[] = [];
  let open = -1;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "\\" && isEscapable(source[i + 1])) {
      i++;
      continue;
    }
    if (source[i] !== "%" || source[i + 1] !== "%") continue;
    if (open < 0) {
      open = i;
    } else {
      notes.push({ from: open, to: i + 2, text: cleanText(source.slice(open + 2, i)) });
      open = -1;
    }
    i++;
  }
  if (open >= 0) {
    warn("unclosed-note", "This note is never closed, so it is read as text.", {
      from: open,
      to: open + 2,
    });
  }
  return notes;
}

/** Physical lines from `start` on, with the lines a note runs over joined into one. */
export function joinLines(
  lines: readonly SourceLine[],
  start: number,
  notes: readonly NoteSpan[],
): Range[] {
  const joined: Range[] = [];
  let next = 0;
  for (let index = start; index < lines.length; index++) {
    const from = lines[index]?.from ?? 0;
    let to = lines[index]?.to ?? from;
    for (;;) {
      while (next < notes.length && (notes[next]?.to ?? 0) <= to) next++;
      const note = notes[next];
      if (!note || note.from >= to) break;
      while (index + 1 < lines.length && (lines[index]?.to ?? 0) < note.to) index++;
      to = lines[index]?.to ?? to;
    }
    joined.push({ from, to });
  }
  return joined;
}

/**
 * Sorts lines into blocks. Headings, breaks and group lines need no blank lines around them: each
 * is always on a line of its own and ends the paragraph before it (§4.4).
 */
export function scanBlocks(source: string, lines: readonly Range[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let paragraph: Range[] = [];
  const endParagraph = () => {
    const first = paragraph[0];
    const last = paragraph[paragraph.length - 1];
    if (first && last) {
      blocks.push({
        kind: "paragraph",
        lines: paragraph,
        range: { from: first.from, to: last.to },
      });
    }
    paragraph = [];
  };
  for (const line of lines) {
    const text = source.slice(line.from, line.to);
    const indent = /^[ \t]*/.exec(text)?.[0].length ?? 0;
    const body = text.slice(indent);
    const from = line.from + indent;
    const range = { from, to: line.to };
    if (body.trim() === "") {
      endParagraph();
      continue;
    }
    const colons = /^:{3,}/.exec(body)?.[0].length ?? 0;
    const hashes = /^(#{1,6})[ \t]/.exec(body)?.[1]?.length ?? 0;
    if (colons > 0) {
      endParagraph();
      const content = { from: from + colons, to: line.to };
      const closing = body.slice(colons).trim() === "";
      blocks.push(
        closing ? { kind: "group-close", range } : { kind: "group-open", content, range },
      );
    } else if (hashes > 0) {
      endParagraph();
      blocks.push({
        kind: "heading",
        level: hashes,
        content: headingContent(body, from, hashes),
        range,
      });
    } else if (/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(body)) {
      endParagraph();
      blocks.push({ kind: "break", range });
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return blocks;
}

/** A heading's text: after the `#` signs and spaces, without a closing run of `#` (§4.4). */
function headingContent(body: string, from: number, hashes: number): Range {
  const start = hashes + (/^[ \t]*/.exec(body.slice(hashes))?.[0].length ?? 0);
  const closing = /(?:^|[ \t]+)#+[ \t]*$/.exec(body.slice(start));
  const trimmed = (
    closing ? body.slice(start, start + closing.index) : body.slice(start)
  ).trimEnd();
  return { from: from + start, to: from + start + trimmed.length };
}
