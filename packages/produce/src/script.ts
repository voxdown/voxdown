/**
 * The production script: everything a listener hears, in order, as a voice service needs it. Each
 * line has an id that stays put while the story is edited around it, a hash of what decides its
 * sound (so only changed lines are made again), its chapter and scene, and what comes after it,
 * which sets the silence between. Chapters are the story's headings of the level it divides into.
 *
 * It is plain data: a tool that knows nothing of VoxDown can make an audiobook from it.
 */
import { type Item, type Story, chapterLevel } from "voxdown";

const hasLetterOrDigit = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** What a line is. */
export type LineKind = "speech" | "vocal" | "sound" | "pause" | "page";

/** What comes after a line, and so how long the silence before the next one is. */
export type Next = "part" | "line" | "paragraph" | "heading" | "scene" | "chapter" | "end";

export type ProductionLine = {
  /** `c02-l0041`: its chapter and its place there. */
  id: string;
  /** What decides its sound: kind, speaker, direction, words and their stress. */
  hash: string;
  /** From 1. */
  chapter: number;
  /** From 1, through the whole story: a heading or a scene break starts a new one. */
  scene: number;
  /** The page it is on: "1" until the first `{page}`. */
  page: string;
  kind: LineKind;
  /** Who says it, or makes the sound: speech and a character's sounds. */
  speaker: string | null;
  /**
   * Present, and true, when others say it or make the sound with the speaker (`@FirstPig+`, spec
   * §5.10). `speaker` is the voice to use when only one is made, as here: a tool that can lay
   * other voices over it may. Not in `hash`: the speaker's own voice sounds the same either way.
   */
  together?: true;
  /** How it is said, after the group rules (§6.4). */
  direction: string | null;
  /**
   * Speech: the words heard, as plain text (emphasis, links and brackets gone). A sound: its
   * description. A pause or page turn: "".
   */
  text: string;
  /**
   * Speech: the words the writer stressed (`*stressed*`, `**bold**`), as `[from, to]` offsets in
   * `text`. A service that can stress a word is told; one that can't reads them as any other.
   */
  stress?: Array<[number, number]>;
  /** A pause's length, in milliseconds. */
  ms?: number;
  /** A heading read aloud: its level. */
  heading?: number;
  /** A character's sound beside their words on the same line: the id of the speech it is voiced with. */
  with?: string;
  next: Next;
  /** Where it starts in the file: offset, and 1-based line and column. */
  from: number;
  line: number;
  column: number;
};

export type Chapter = {
  number: number;
  /** Its heading, or the story's title for what comes before the first. */
  title: string;
  /** The ids of its first and last lines. */
  first: string;
  last: string;
};

export type ProductionScript = {
  /** The format of this data. */
  format: "voxdown-production/1";
  title: string;
  author?: string;
  language?: string;
  narrator: string;
  chapters: Chapter[];
  lines: ProductionLine[];
};

/** A short, stable hash (FNV-1a, 64 bits as hex): enough to tell one line's sound from another's. */
export function hashOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code ^ (a >>> 7), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Markdown's own signs are for the page; a voice gets the words. Square brackets would read as tags. */
export function plain(text: string): string {
  return plainWithStress(text).text;
}

// Where emphasis opened and closed, kept through the rest of the cleaning: characters no story
// uses (the Private Use Area), taken out of the text first.
const OPEN = "\uE000";
const CLOSE = "\uE001";

/** The words, as `plain` gives them, and where in them the writer's emphasis was. */
export function plainWithStress(text: string): { text: string; stress: Array<[number, number]> } {
  const marked = text
    .replace(/[\uE000\uE001]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*{1,3}|_{1,3})(?=\S)([\s\S]*?\S)\1/g, `${OPEN}$2${CLOSE}`)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let out = "";
  let depth = 0;
  let start = 0;
  const stress: Array<[number, number]> = [];
  for (const char of marked) {
    if (char === OPEN) {
      if (depth++ === 0) start = out.length;
    } else if (char === CLOSE) {
      if (depth > 0 && --depth === 0) stress.push([start, out.length]);
    } else out += char;
  }
  // Marks at the edges of the trimmed text, or around nothing but a space, stress nothing.
  const words = out.trim();
  const lead = out.length - out.trimStart().length;
  const ranges = stress
    .map(([from, to]): [number, number] => {
      let a = Math.max(0, from - lead);
      let b = Math.min(words.length, to - lead);
      while (a < b && /\s/.test(words[a] as string)) a++;
      while (b > a && /\s/.test(words[b - 1] as string)) b--;
      return [a, b];
    })
    .filter(([from, to]) => to > from);
  return { text: words, stress: ranges };
}

/** The stressed words of a text in capitals, which is how ElevenLabs' newer models hear stress. */
export function capitalized(text: string, stress: ReadonlyArray<[number, number]> = []): string {
  if (!stress.length) return text;
  const chars = [...text];
  let out = "";
  let at = 0;
  for (const char of chars) {
    const inside = stress.some(([from, to]) => at >= from && at < to);
    const upper = char.toUpperCase();
    // Only where the capital is one character too, so every offset after it stays put.
    out += inside && upper.length === char.length ? upper : char;
    at += char.length;
  }
  return out;
}

/** A pause's length from its value: `2s`, `500ms`, `1.5`; a beat (one second) when it says none. */
export function pauseMs(value: string | null): number {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/);
  if (!match) return 1000;
  const amount = Number(match[1]);
  return Math.round(match[2] === "ms" ? amount : amount * 1000);
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1))
    starts.push(index + 1);
  return starts;
}

function position(starts: readonly number[], at: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] as number) <= at) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: at - (starts[low] as number) + 1 };
}

/** The production script of a story. */
export function productionScript(story: Story): ProductionScript {
  const level = chapterLevel(story);
  const starts = lineStarts(story.source);
  const title = story.meta.title ?? "Untitled";
  type Draft = Omit<ProductionLine, "id" | "hash" | "next"> & {
    block: number;
    lineIndex: number;
    isHeading: boolean;
  };
  const drafts: Draft[] = [];
  const chapterTitles: string[] = [];
  let chapter = 0;
  let scene = 1;
  let sceneHasContent = false;
  let page = "1";
  let pageNumber = 1;
  const newScene = () => {
    if (sceneHasContent) scene++;
    sceneHasContent = false;
  };
  story.blocks.forEach((block, blockIndex) => {
    if (block.kind === "break") {
      newScene();
      return;
    }
    if (block.kind === "heading") {
      newScene();
      if (level !== undefined && block.level === level) {
        chapter = chapterTitles.length + 1;
        chapterTitles.push(
          plain(
            story.source
              .slice(block.line.range.from, block.line.range.to)
              .replace(/\{[^}]*\}/g, "")
              .replace(/@\S+/g, ""),
          ) || `Chapter ${chapter}`,
        );
      }
    }
    if (chapter === 0) {
      chapter = 1;
      chapterTitles.push(title);
    }
    const heard = block.visibility === "both" || block.visibility === "audio";
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    lines.forEach((line, lineIndex) => {
      const items = [...line.items].sort((a, b) => a.range.from - b.range.from);
      for (const item of items) {
        // Page turns count even where nothing is heard, so the page labels stay right.
        if (item.kind === "instruction" && item.name === "page") {
          pageNumber++;
          page = item.value?.trim() || String(pageNumber);
          if (/^\d+$/.test(page)) pageNumber = Number(page);
        }
        if (!heard) continue;
        const draft = make(item, block.kind === "heading" ? block.level : undefined);
        if (!draft) continue;
        sceneHasContent = true;
        drafts.push({
          ...draft,
          chapter,
          scene,
          page,
          from: item.range.from,
          ...position(starts, item.range.from),
          block: blockIndex,
          lineIndex,
          isHeading: block.kind === "heading",
        });
      }
    });
  });

  function make(
    item: Item,
    heading: number | undefined,
  ):
    | Pick<
        ProductionLine,
        "kind" | "speaker" | "together" | "direction" | "text" | "stress" | "ms" | "heading"
      >
    | undefined {
    if (item.kind === "speech") {
      const { text, stress } = plainWithStress(item.text);
      if (!hasLetterOrDigit(text)) return undefined;
      return {
        kind: "speech",
        speaker: item.speaker,
        ...(item.together ? { together: true as const } : {}),
        direction: item.direction,
        text,
        ...(stress.length ? { stress } : {}),
        ...(heading !== undefined ? { heading } : {}),
      };
    }
    if (item.kind === "vocal")
      return {
        kind: "vocal",
        speaker: item.speaker,
        ...(item.together ? { together: true as const } : {}),
        direction: item.direction,
        text: item.description,
      };
    if (item.kind === "sound")
      return { kind: "sound", speaker: null, direction: null, text: item.description };
    if (item.kind === "instruction" && item.name === "pause")
      return { kind: "pause", speaker: null, direction: null, text: "", ms: pauseMs(item.value) };
    if (item.kind === "instruction" && item.name === "page")
      return { kind: "page", speaker: null, direction: null, text: "" };
    return undefined;
  }

  // Ids, by chapter; what comes after each line.
  const counters = new Map<number, number>();
  const lines: ProductionLine[] = drafts.map((draft, index) => {
    const count = (counters.get(draft.chapter) ?? 0) + 1;
    counters.set(draft.chapter, count);
    const next = drafts[index + 1];
    const after: Next = !next
      ? "end"
      : next.chapter !== draft.chapter
        ? "chapter"
        : draft.isHeading
          ? "heading"
          : next.scene !== draft.scene
            ? "scene"
            : next.block !== draft.block
              ? "paragraph"
              : next.lineIndex !== draft.lineIndex
                ? "line"
                : "part";
    const { block: _block, lineIndex: _lineIndex, isHeading: _isHeading, ...line } = draft;
    return {
      id: `c${String(draft.chapter).padStart(2, "0")}-l${String(count).padStart(4, "0")}`,
      hash: hashOf(
        JSON.stringify([
          draft.kind,
          draft.speaker,
          draft.direction,
          draft.text,
          draft.ms,
          ...(draft.stress ? [draft.stress] : []),
        ]),
      ),
      ...line,
      next: after,
    };
  });

  // A character's sound beside their own words on the same line is voiced with those words.
  lines.forEach((line, index) => {
    if (line.kind !== "vocal") return;
    const sameLine = (other: ProductionLine | undefined) =>
      other?.kind === "speech" &&
      other.speaker === line.speaker &&
      other.line === line.line &&
      line.next === "part";
    const next = lines[index + 1];
    const previous = lines[index - 1];
    if (sameLine(next)) line.with = (next as ProductionLine).id;
    else if (
      previous?.kind === "speech" &&
      previous.speaker === line.speaker &&
      previous.next === "part"
    )
      line.with = previous.id;
  });

  const chapters: Chapter[] = chapterTitles.map((chapterTitle, index) => {
    const own = lines.filter((line) => line.chapter === index + 1);
    return {
      number: index + 1,
      title: chapterTitle,
      first: own[0]?.id ?? "",
      last: own.at(-1)?.id ?? "",
    };
  });
  return {
    format: "voxdown-production/1",
    title,
    ...(story.meta.author ? { author: story.meta.author } : {}),
    ...(story.meta.language ? { language: story.meta.language } : {}),
    narrator: story.meta.narrator,
    chapters: chapters.filter((entry) => entry.first),
    lines,
  };
}

/**
 * How many lines are said, or sounds made, together with others (`@FirstPig+`, spec §5.10): each
 * is voiced by the one speaker named, alone, where a service speaks one voice at a time.
 */
export function saidTogether(script: ProductionScript): number {
  return script.lines.filter((line) => line.together).length;
}

/**
 * What to tell the writer of lines said together, or "" if there are none: `made` once the book is
 * made, else before.
 */
export function togetherNote(script: ProductionScript, made: boolean): string {
  const count = saidTogether(script);
  if (count === 0) return "";
  const lines = `${count} line${count === 1 ? "" : "s"} said together with others (@Name+)`;
  return made
    ? `${lines} ${count === 1 ? "was" : "were"} voiced by one speaker only, the one named: the others' voices are not in it.`
    : `${lines} will be voiced by one speaker only, the one named: the others' voices won't be in it.`;
}
