/**
 * The scene board: the story's chapters side by side, each scene a card with its words, a line
 * about it and how far along it is. The line and the state are the writer's comment straight under
 * the scene's heading or break (`<!-- draft: The knight meets the dragon. -->`, spec §10.1), so a
 * board needs nothing the format doesn't have, and any Markdown viewer hides it.
 */
import type { Story } from "voxdown";
import { scenesOf } from "./story-data";
import { proseWords } from "./words";

export const STATES = ["idea", "draft", "revised", "done"] as const;
export type SceneState = (typeof STATES)[number];

export type BoardScene = {
  from: number;
  to: number;
  name: string;
  words: number;
  state?: SceneState;
  summary: string;
  /** Where the line about it is written, a comment on the line after its heading, if it is. */
  about?: { from: number; to: number };
  /** Where a line about it goes when there is none: the end of its heading's or break's line. */
  aboutAt: number;
  /** A scene break, not a heading. */
  break: boolean;
};

export type BoardChapter = {
  from: number;
  to: number;
  name: string;
  words: number;
  scenes: BoardScene[];
  /** The words before the first chapter: shown, never moved. */
  opening: boolean;
};

/** `draft: The knight meets the dragon.` → its state and its line. */
export function readAbout(text: string): { state?: SceneState; summary: string } {
  const found = /^(idea|draft|revised|done)(?:\s*[:.–—-]\s*(.*))?$/is.exec(text.trim());
  if (!found) return { summary: text.trim() };
  return { state: (found[1] ?? "").toLowerCase() as SceneState, summary: (found[2] ?? "").trim() };
}

/** The comment a scene's state and line are written as, or "" for neither. */
export function aboutComment(state: SceneState | undefined, summary: string): string {
  const line = summary.replace(/\s+/g, " ").replace(/-->/g, "→").trim();
  if (!state && !line) return "";
  const said = state && line ? `${state}: ${line}` : (state ?? line);
  return `<!-- ${said} -->`;
}

/** The story's chapters and their scenes, as the board shows them. */
export function boardOf(story: Story): BoardChapter[] {
  const source = story.source;
  const marks = scenesOf(story).filter((scene) => !scene.title);
  const chapters: BoardChapter[] = [];
  const body = story.frontMatter ? story.frontMatter.range.to : 0;
  const endOf = (index: number) => marks[index + 1]?.from ?? source.length;
  const words = (from: number, to: number) => proseWords(source.slice(from, to));
  const firstChapter = marks.findIndex((mark) => mark.chapter);
  // Words before the first chapter (or a story with none): one column, kept where it is.
  const openingTo =
    firstChapter >= 0 ? (marks[firstChapter]?.from ?? source.length) : source.length;
  // A book's title heading over the chapters is the board's title, not words before them.
  const title = scenesOf(story).find((scene) => scene.title && scene.from < openingTo);
  const titleEnd = title ? source.indexOf("\n", title.from) : -1;
  const opening: BoardChapter = {
    from: title ? (titleEnd < 0 ? source.length : titleEnd) : body,
    to: openingTo,
    name: firstChapter >= 0 ? "Before the first chapter" : "The story",
    words: 0,
    scenes: [],
    opening: true,
  };
  /** A card: its words, and its line and state from the comment under its heading or break. */
  const card = (from: number, to: number, name: string, isBreak: boolean): BoardScene => {
    const lineEnd = source.indexOf("\n", from);
    const headEnd = lineEnd < 0 ? source.length : lineEnd;
    // The line about it: a comment alone on the line straight after its heading or break.
    const next = /^\r?\n[ \t]*<!--((?:(?!-->)[^\n])*)-->[ \t]*(?=\r?\n|$)/.exec(
      source.slice(headEnd),
    );
    const about = next
      ? {
          from: headEnd + (next[0].length - next[0].trimStart().length),
          to: headEnd + next[0].length,
        }
      : undefined;
    const read = next ? readAbout(next[1] ?? "") : { summary: "" };
    return {
      from,
      to,
      name,
      words: words(from, to),
      ...(read.state ? { state: read.state } : {}),
      summary: read.summary,
      ...(about ? { about } : {}),
      aboutAt: headEnd,
      break: isBreak,
    };
  };
  let chapter: BoardChapter = opening;
  for (const [index, mark] of marks.entries()) {
    if (mark.chapter) {
      chapter = {
        from: mark.from,
        to: marks.slice(index + 1).find((next) => next.chapter)?.from ?? source.length,
        name: mark.name,
        words: 0,
        scenes: [],
        opening: false,
      };
      chapters.push(chapter);
      continue;
    }
    const name = mark.break ? `Scene ${chapter.scenes.length + 1}` : mark.name;
    chapter.scenes.push(card(mark.from, endOf(index), name, mark.break));
  }
  opening.words = words(opening.from, opening.to);
  for (const each of chapters) each.words = words(each.from, each.to);
  // A short story's sections, with no scenes inside them: one column, each section a card.
  if (chapters.length > 1 && chapters.every((each) => !each.scenes.length)) {
    const first = chapters[0] as BoardChapter;
    const sections: BoardChapter = {
      from: first.from,
      to: source.length,
      name: story.meta.title ?? "The story",
      words: chapters.reduce((sum, each) => sum + each.words, 0),
      scenes: chapters.map((each) => card(each.from, each.to, each.name, false)),
      opening: true,
    };
    return opening.words > 0 ? [opening, sections] : [sections];
  }
  return opening.words > 0 || opening.scenes.length || !chapters.length
    ? [opening, ...chapters]
    : chapters;
}

/**
 * The changes that move the text from `from` to `to` (a scene, or a chapter) to `at`, the start
 * of another or the story's end: one step, with a blank line between it and what it meets.
 */
export function moveSpan(
  source: string,
  from: number,
  to: number,
  at: number,
): Array<{ from: number; to: number; insert: string }> {
  if (at >= from && at <= to) return [];
  const text = source.slice(from, to).replace(/\s+$/, "");
  // Taken from the end: the blank lines before it go too, so the story ends as it did.
  const start =
    to >= source.length ? from - (/\s*$/.exec(source.slice(0, from))?.[0].length ?? 0) : from;
  const ending = to >= source.length && /\n$/.test(source) ? "\n" : "";
  const removed = { from: start, to, insert: start < from ? ending : "" };
  const added =
    at >= source.length
      ? {
          from: at,
          to: at,
          insert: `${/\n\n$/.test(source) ? "" : /\n$/.test(source) ? "\n" : "\n\n"}${text}\n`,
        }
      : { from: at, to: at, insert: `${text}\n\n` };
  return at < from ? [added, removed] : [removed, added];
}
