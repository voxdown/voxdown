/**
 * The spoken script as data: one row per thing heard, with who says it, how, and where it falls in
 * the story. This is the shape multi-voice text-to-speech tools take, as JSON or CSV.
 */
import { hasLetterOrDigit } from "./chars";
import { visibilityOf } from "./groups";
import type { Block, Item, Line, Story } from "./model";
import { bookLine } from "./readings";

export type ScriptLineKind =
  | "speech"
  | "vocal"
  | "sound"
  | "page"
  | "pause"
  | "instruction"
  | "note"
  | "image";

export type ScriptLine = {
  kind: ScriptLineKind;
  /** Who says it or makes the sound: speech and vocal sounds only. */
  speaker: string | null;
  /** How it is said, after the group rules (§6.4): speech and vocal sounds only. */
  direction: string | null;
  /**
   * Speech: the words heard (§12.1). A sound: its description. A page turn or pause: its value,
   * or "". Another instruction: its value. A note: its text. An image: its description.
   */
  text: string;
  /** An instruction's name, such as `page`, `pause` or `recorder:take`. Null for anything else. */
  name: string | null;
  /** The heading's level when this is a heading read aloud, else null. */
  heading: number | null;
  /** The scene it is in, from 1. A heading or a scene break starts a new scene. */
  scene: number;
  /** The scene's heading as printed, when the scene starts with one. */
  sceneTitle: string | null;
  /** The page it is on: "1" until the first `{page}`, then each page turn's label or the next number. */
  page: string;
  /** Where it starts in the file: 1-based line and column (UTF-16 code units). */
  line: number;
  column: number;
};

export type LinesOptions = {
  /** Only what is said: speech and the sounds characters make. Default false. */
  speechOnly?: boolean;
};

/** Every line of the spoken script, in order, as data. Lines that aren't heard are left out. */
export function lines(story: Story, options: LinesOptions = {}): ScriptLine[] {
  const out: ScriptLine[] = [];
  const position = positions(story.source);
  let scene = 1;
  let sceneTitle: string | null = null;
  let sceneHasContent = false;
  let page = "1";

  const push = (
    item: Item,
    row: Omit<ScriptLine, "scene" | "sceneTitle" | "page" | "line" | "column">,
  ) => {
    if (options.speechOnly && row.kind !== "speech" && row.kind !== "vocal") return;
    out.push({ ...row, scene, sceneTitle, page, ...position(item.range.from) });
  };

  const emit = (block: Block, line: Line, heard: boolean) => {
    for (const item of line.items) {
      const base = { speaker: null, direction: null, name: null, heading: null };
      switch (item.kind) {
        case "speech":
          if (heard && hasLetterOrDigit(item.text))
            push(item, {
              ...base,
              kind: "speech",
              speaker: item.speaker,
              direction: item.direction,
              text: item.text,
              heading: block.kind === "heading" ? block.level : null,
            });
          break;
        case "vocal":
          if (heard)
            push(item, {
              ...base,
              kind: "vocal",
              speaker: item.speaker,
              direction: item.direction,
              text: item.description,
            });
          break;
        case "sound":
          if (heard) push(item, { ...base, kind: "sound", text: item.description });
          break;
        case "instruction": {
          if (visibilityOf(item.name)) break;
          if (item.name === "page") page = item.value ?? nextPage(page);
          const kind = item.name === "page" || item.name === "pause" ? item.name : "instruction";
          push(item, { ...base, kind, name: item.name, text: item.value ?? "" });
          break;
        }
        case "note":
          if (item.text) push(item, { ...base, kind: "note", text: item.text });
          break;
        case "image":
          if (heard) push(item, { ...base, kind: "image", text: item.alt });
          break;
        case "mark":
        case "direction":
          break;
      }
    }
  };

  for (const block of story.blocks) {
    if (block.kind === "break" || block.kind === "heading") {
      if (sceneHasContent) {
        scene++;
        sceneHasContent = false;
        sceneTitle = null;
      }
    }
    if (block.kind === "break") continue;
    const heard = block.visibility === "both" || block.visibility === "audio";
    if (block.kind === "heading") {
      if (!sceneHasContent) sceneTitle = bookLine(story.source, block.line) || null;
      emit(block, block.line, heard);
      sceneHasContent = true;
    } else {
      for (const line of block.lines) emit(block, line, heard);
      // Notes, page turns and other instructions alone don't open a scene.
      if (block.lines.some((line) => line.items.some(isStory))) sceneHasContent = true;
    }
  }
  return out;
}

/** Whether an item is part of the story told, rather than a note or instruction about it. */
function isStory(item: Item): boolean {
  return (
    (item.kind === "speech" && item.text !== "") || ["vocal", "sound", "image"].includes(item.kind)
  );
}

/** The page after one labeled `label`: its last number plus one, or the label with " +1". */
function nextPage(label: string): string {
  const match = /(\d+)(?!.*\d)/u.exec(label);
  return match?.[1] ? String(Number(match[1]) + 1) : `${label} +1`;
}

function positions(source: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
}

const CSV_COLUMNS = ["kind", "speaker", "direction", "text", "scene", "page"] as const;

/** The lines as CSV (RFC 4180): kind, speaker, direction, text, scene, page. */
export function linesToCsv(rows: readonly ScriptLine[]): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => CSV_COLUMNS.map((column) => cell(row[column])).join(","));
  return `${[CSV_COLUMNS.join(","), ...body].join("\r\n")}\r\n`;
}

/**
 * What each character says, as plain text: one line per speech, in order, for a performer's
 * sides. Characters are listed in cast order, then in the order they first speak.
 */
export function textByCharacter(story: Story): Map<string, string> {
  const said = new Map<string, string[]>();
  for (const member of story.cast) said.set(member.handle, []);
  for (const row of lines(story, { speechOnly: true })) {
    if (row.speaker === null) continue;
    const key = [...said.keys()].find((name) => name.toLowerCase() === row.speaker?.toLowerCase());
    const list = said.get(key ?? row.speaker) ?? [];
    const direction = row.direction ? `(${row.direction}) ` : "";
    list.push(row.kind === "vocal" ? `${direction}[${row.text}]` : `${direction}${row.text}`);
    said.set(key ?? row.speaker, list);
  }
  const out = new Map<string, string>();
  for (const [name, list] of said) if (list.length) out.set(name, `${list.join("\n")}\n`);
  return out;
}
