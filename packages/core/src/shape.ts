/**
 * A book come in as plain text (pasted from a web page, an old `.txt`), given its shape: its
 * chapters as headings, its list of contents printed but not read aloud, Project Gutenberg's notices
 * taken out, its title and author from its title page, and the lines it sets out as a play
 * (`STUBB. Avast!`) given to their speakers. `findShape` says what it found; `shapeStory` makes what
 * the writer chooses of it, the words themselves untouched.
 */
import { castMemberNamed } from "./attribution";
import { type TextChange, applyChanges, setFullName, setMeta } from "./edit";
import type { Story } from "./model";
import { parse } from "./parse";

/** A stretch of the source. */
export type Span = { from: number; to: number };

export type Shape = {
  /** Paragraphs that are a chapter's (or a part's) title, to be headings. */
  chapters: Array<Span & { text: string; level: number; joins?: Span; before?: boolean }>;
  /** A list of the chapters before them: printed, not read aloud. */
  contents: Span[];
  /** Project Gutenberg's notices, at the start and the end, to take out. */
  notices: Span[];
  /** The title and author its title page gives, and that page's paragraphs. */
  title?: string;
  author?: string;
  titlePage: Span[];
  /** Lines set out as a play, each given to its speaker: the name before them, to replace. */
  lines: Array<Span & { name: string; handle: string; fullName: string; direction?: string }>;
};

export type ShapeChoice = {
  chapters?: boolean;
  contents?: boolean;
  notices?: boolean;
  details?: boolean;
  lines?: boolean;
};

const START =
  /\\?\*\\?\*\\?\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG E(?:BOOK|TEXT)\b[^\n]*?\\?\*\\?\*\\?\*/i;
const END =
  /\\?\*\\?\*\\?\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG E(?:BOOK|TEXT)\b|^End of (?:the )?Project Gutenberg(?:'s)? /im;
const HEADER = /^[#\s]*The Project Gutenberg e(?:Book|Text)\b/im;

const NUMBER = "(?:[0-9]{1,3}|[IVXLCDM]{1,8}|[A-Za-z]+(?:[- ][A-Za-z]+)?)";
/** A chapter's title, alone on its line. */
const CHAPTER = new RegExp(
  [
    `^(?:CHAPTER|Chapter|CHAP\\.|Chap\\.)\\s+${NUMBER}\\b[.:—–-]?(?:\\s.{0,120})?$`,
    "^(?:PROLOGUE|Prologue|EPILOGUE|Epilogue|PREFACE|Preface|INTRODUCTION|Introduction|FOREWORD|Foreword|AFTERWORD|Afterword|ETYMOLOGY|Etymology|EXTRACTS|Extracts)\\b[.:]?(?:\\s.{0,120})?$",
    "^[IVXLC]{1,7}\\.?$",
  ].join("|"),
);
/** A part's: a heading above the chapters. */
const PART = new RegExp(
  `^(?:BOOK|Book|PART|Part|VOLUME|Volume)\\s+${NUMBER}\\b[.:—–-]?(?:\\s.{0,120})?$`,
);
/** A chapter's title that is only its number, its name on the next line. */
const NUMBER_ONLY = /^(?:CHAPTER|Chapter|CHAP\.|Chap\.)\s+(?:[0-9]{1,3}|[IVXLCDM]{1,8})\.?$/;
const CONTENTS = /^(?:TABLE OF )?CONTENTS\.?$|^Contents\.?$/;
/** A line of a play: `STUBB. Avast!`, `1ST NANTUCKET SAILOR. Oh, boys`, `STARBUCK (aside). No.` */
const PLAY =
  /^((?:\d+(?:ST|ND|RD|TH|D)\s+)?[A-Z][A-Z'’-]+(?:\s+[A-Z][A-Z'’-]+){0,3})(?:\s*\(([^()\n]{1,60})\))?\s*[.:]\s+(?=\S)/;
const NOT_NAMES =
  /^(?:CHAPTER|CHAP|BOOK|PART|VOLUME|CONTENTS|ETYMOLOGY|EXTRACTS|NOTE|NOTES|END|FINIS|PROLOGUE|EPILOGUE|PREFACE|ACT|SCENE|MR|MRS|MS|MX|DR|ST|NO|VOL|FIG|P\.S|N\.B|I|A|O)$/;

/** A title written in capitals, as a reader would write it: `MOBY-DICK; or, THE WHALE`. */
export function titleCased(title: string): string {
  const letters = title.replace(/[^\p{L}]/gu, "");
  const capitals = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (!letters || capitals / letters.length < 0.7) return title;
  const small = /^(?:a|an|and|as|at|but|by|for|in|nor|of|on|or|the|to|with)$/;
  return title.replace(/[\p{L}'’]+/gu, (word, at: number) => {
    // A word written in small letters stays so (`or,` in `MOBY-DICK; or, THE WHALE`).
    if (!/\p{Lu}/u.test(word)) return word;
    const lower = word.toLowerCase();
    // A small word is small, except first, and after a stop or a comma (`; or, The Whale`).
    const before = title.slice(0, at).trimEnd();
    const opens = before === "" || /[;:,.!?—–-]$/.test(before);
    return small.test(lower) && !opens
      ? lower
      : lower.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
  });
}

/** The story's paragraphs after its front matter: where each is, and its text. */
function paragraphs(story: Story): Array<Span & { text: string }> {
  const source = story.source;
  const out: Array<Span & { text: string }> = [];
  const start = story.frontMatter?.range.to ?? 0;
  const pattern = /[^\n]+(?:\n[^\n]*\S[^\n]*)*/g;
  pattern.lastIndex = start;
  for (let found = pattern.exec(source); found; found = pattern.exec(source)) {
    if (!found[0].trim()) continue;
    out.push({ from: found.index, to: found.index + found[0].length, text: found[0] });
  }
  return out;
}

const plainOf = (text: string) =>
  text
    .replace(/\\(.)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();

/** A name as a mark writes it: one word, from `1ST NANTUCKET SAILOR`, `NantucketSailor1`. */
function handleOf(name: string): { handle: string; fullName: string } {
  const words = name.split(/\s+/);
  const ordinal = /^(\d+)(?:ST|ND|RD|TH|D)$/i.exec(words[0] ?? "");
  const rest = ordinal ? words.slice(1) : words;
  const titled = rest.map((word) =>
    word
      .toLowerCase()
      .replace(
        /(^|[-’'])(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      ),
  );
  const handle = titled.join("").replace(/['’]/g, "") + (ordinal ? ordinal[1] : "");
  const fullName = [ordinal ? (words[0] ?? "").toLowerCase() : "", ...titled]
    .filter(Boolean)
    .join(" ");
  return { handle, fullName };
}

export function findShape(story: Story): Shape {
  const source = story.source;
  const shape: Shape = { chapters: [], contents: [], notices: [], titlePage: [], lines: [] };
  const all = paragraphs(story);
  const bodyFrom = story.frontMatter?.range.to ?? 0;

  // Project Gutenberg's notices: from its header (or its START line) to the end of that line, and
  // from its END line to the end of the file. Its header names the title and author.
  let after = bodyFrom;
  const start = START.exec(source.slice(bodyFrom));
  if (start) {
    const at = bodyFrom + start.index;
    const header = HEADER.exec(source.slice(bodyFrom, at));
    const from = header ? bodyFrom + header.index : source.lastIndexOf("\n", at - 1) + 1;
    const lineEnd = source.indexOf("\n", at);
    const to = lineEnd < 0 ? source.length : lineEnd;
    shape.notices.push({ from, to });
    after = to;
    const said = source.slice(from, at);
    const title = /^\s*\**Title\**:\**\s*(.+)$/im.exec(said)?.[1];
    const author = /^\s*\**Author\**:\**\s*(.+)$/im.exec(said)?.[1];
    if (title) shape.title = plainOf(title);
    if (author) shape.author = plainOf(author);
  }
  const end = END.exec(source.slice(after));
  if (end) shape.notices.push({ from: after + end.index, to: source.length });
  const until = end ? after + end.index : source.length;
  const inside = all
    .map((paragraph) => ({
      ...paragraph,
      // The START line's paragraph goes on after it: only what is after it counts.
      from: Math.max(
        paragraph.from,
        after > paragraph.from && after < paragraph.to ? after + 1 : paragraph.from,
      ),
    }))
    .filter((paragraph) => paragraph.from >= after && paragraph.to <= until)
    .map((paragraph) => ({ ...paragraph, text: source.slice(paragraph.from, paragraph.to) }))
    .filter((paragraph) => paragraph.text.trim());

  // Each paragraph by its first line: a chapter's title, a part's, or the story's own words. A
  // title can head its chapter's first paragraph with no blank line between (a web page's text).
  // A title can be long (`CHAPTER 56. Of the Less Erroneous Pictures of Whales, and the True
  // Pictures of Whaling Scenes.`), but not a paragraph's length.
  const short = (line: string) => line.trim().length <= 130;
  const kind = (line: string): "chapter" | "part" | "contents" | "text" => {
    const plain = plainOf(line);
    // Not a title: a quote, a heading already, or a sentence run on after a dash (`BOOK I.
    // (Folio).—This whale, well known to the French…`; `Midnight.—The Forecastle Bulwarks.` is one).
    const after = /[.)]\s*[—–]\s*(.*)$/u.exec(plain)?.[1] ?? "";
    if (
      !short(line) ||
      plain.startsWith("#") ||
      /[“”"]/.test(plain) ||
      after.split(/\s+/).filter(Boolean).length >= 6
    )
      return "text";
    if (CONTENTS.test(plain)) return "contents";
    if (PART.test(plain)) return "part";
    if (CHAPTER.test(plain)) return "chapter";
    return "text";
  };
  const heads = inside.map((paragraph) => {
    const end = paragraph.text.indexOf("\n");
    return end < 0 ? paragraph.text : paragraph.text.slice(0, end);
  });
  const kinds = heads.map(kind);
  /** Whether a paragraph is its title alone, or its title and the words after it. */
  const alone = inside.map((paragraph) => !paragraph.text.includes("\n"));
  const hasParts = kinds.includes("part");

  // Titles one after another, three or more, are a list of contents; the last of them is a
  // chapter's own title when the story's words follow it.
  for (let at = 0; at < inside.length; ) {
    if (kinds[at] === "text") {
      at++;
      continue;
    }
    let to = at;
    while (to + 1 < inside.length && alone[to] && kinds[to + 1] !== "text") to++;
    const run = to - at + 1;
    // The last of a list is the first chapter's own title when the story's words follow it (not a
    // heading already marked, as an ebook's chapters are) and the list named it above: a list's
    // last entry before a transcriber's note is no chapter.
    const following = alone[to] ? (inside[to + 1]?.text.trimStart() ?? "") : "words";
    const key = (index: number) =>
      plainOf(heads[index] as string)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
    const named = Array.from({ length: to - at }, (_, offset) => key(at + offset)).includes(
      key(to),
    );
    const lastIsTitle =
      following !== "" &&
      !following.startsWith("#") &&
      kinds[to] !== "contents" &&
      (run < 3 || named);
    const listed = run >= 3 ? (lastIsTitle ? to - 1 : to) : at - 1;
    for (let index = at; index <= listed; index++) {
      const paragraph = inside[index] as (typeof inside)[number];
      shape.contents.push({ from: paragraph.from, to: paragraph.to });
    }
    for (let index = Math.max(at, listed + 1); index <= to; index++) {
      const paragraph = inside[index] as (typeof inside)[number];
      if (kinds[index] === "contents") continue;
      const head = (heads[index] as string).trim();
      const level = kinds[index] === "part" ? 1 : hasParts ? 2 : 1;
      const headEnd = paragraph.from + (heads[index] as string).length;
      // `CHAPTER IV.` and its name on the next line (or in the next paragraph), made one heading.
      const titleLike = (line: string) =>
        short(line) && line.trim().length <= 60 && !/[,;!?]$|[a-z]\.$/.test(line.trim());
      const nextLine = alone[index]
        ? undefined
        : paragraph.text.slice(head.length + 1).split("\n")[0];
      const next = inside[index + 1];
      if (NUMBER_ONLY.test(head) && nextLine !== undefined && titleLike(nextLine)) {
        const lineEnd = headEnd + 1 + nextLine.length;
        shape.chapters.push({
          from: paragraph.from,
          to: lineEnd,
          text: `${head.replace(/\.$/, "")}. ${nextLine.trim()}`,
          level,
          ...(lineEnd < paragraph.to ? { before: true } : {}),
        });
      } else if (
        NUMBER_ONLY.test(head) &&
        alone[index] &&
        next &&
        kinds[index + 1] === "text" &&
        !next.text.includes("\n") &&
        titleLike(next.text)
      )
        shape.chapters.push({
          from: paragraph.from,
          to: paragraph.to,
          text: `${head.replace(/\.$/, "")}. ${next.text.trim()}`,
          level,
          joins: { from: next.from, to: next.to },
        });
      else
        shape.chapters.push({
          from: paragraph.from,
          to: headEnd,
          text: head,
          level,
          ...(alone[index] ? {} : { before: true }),
        });
    }
    at = to + 1;
  }

  shape.chapters.sort((a, b) => a.from - b.from);

  // Its title page: the short lines before a `By …` line, before anything else.
  const firstTitle = Math.min(
    ...[...shape.contents, ...shape.chapters].map((span) => span.from),
    until,
  );
  const opening = inside.filter((paragraph) => paragraph.to <= firstTitle).slice(0, 8);
  const by = opening.findIndex((paragraph) => /^by\s+\S.{1,60}$/i.test(paragraph.text.trim()));
  if (by > 0) {
    const named = opening.slice(0, by).filter((paragraph) => paragraph.text.trim().length <= 80);
    if (named.length && named.length === by) {
      shape.title ??= titleCased(
        named
          .map((paragraph) => paragraph.text.trim().replace(/\s*\n\s*/g, " "))
          .join(" ")
          .replace(/\.$/, ""),
      );
      shape.author ??= (opening[by] as (typeof opening)[number]).text.trim().replace(/^by\s+/i, "");
      for (const paragraph of opening.slice(0, by + 1))
        shape.titlePage.push({ from: paragraph.from, to: paragraph.to });
    }
  }

  // Lines set out as a play, when there are a few of them: a name said twice or more, or among
  // other lines of a play, so that `WARNING: keep out` alone is no one's line.
  const lines: Array<Shape["lines"][number] & { index: number }> = [];
  // Each line, not each paragraph: a scene set out as a play can be one paragraph, a line to a
  // speech. Counted in lines, to tell which are near one another.
  let index = 0;
  for (const paragraph of inside) {
    let at = paragraph.from;
    for (const text of paragraph.text.split("\n")) {
      const lineFrom = at;
      at += text.length + 1;
      index++;
      const found = PLAY.exec(text);
      if (!found) continue;
      const name = (found[1] ?? "").trim();
      if (
        name.split(/\s+/).some((word) => NOT_NAMES.test(word) || /^[IVXLCDM]+$/.test(word)) ||
        name.replace(/[^A-Z]/g, "").length < 2
      )
        continue;
      if (!/\p{Ll}/u.test(text.slice(found[0].length, found[0].length + 80))) continue;
      const titled = handleOf(name);
      const known = castMemberNamed(story, titled.fullName);
      lines.push({
        index,
        from: lineFrom,
        to: lineFrom + found[0].length,
        name,
        handle: known ?? titled.handle,
        fullName: titled.fullName,
        ...(found[2] ? { direction: found[2].trim() } : {}),
      });
    }
  }
  const said = new Map<string, number>();
  for (const line of lines) said.set(line.name, (said.get(line.name) ?? 0) + 1);
  const play = lines.filter(
    (line) =>
      (said.get(line.name) ?? 0) >= 2 ||
      // A scene's songs and stage directions between its speeches: some lines apart.
      lines.some((other) => other !== line && Math.abs(other.index - line.index) <= 15),
  );
  if (play.length >= 3) shape.lines = play.map(({ index: _, ...line }) => line);
  return shape;
}

/** The story with what the writer chose of its shape made: one text, to replace the old. */
export function shapeStory(story: Story, shape: Shape, choice: ShapeChoice): string {
  const changes: TextChange[] = [];
  const cut = (span: Span) => {
    // A paragraph taken out takes the blank line after it.
    let to = span.to;
    while (story.source[to] === "\n") to++;
    changes.push({ from: span.from, to, insert: "" });
  };
  if (choice.notices) for (const span of shape.notices) cut(span);
  if (choice.details) for (const span of shape.titlePage) cut(span);
  if (choice.contents)
    for (const span of shape.contents)
      changes.push({ from: span.from, to: span.from, insert: "{book only} " });
  if (choice.chapters)
    for (const chapter of shape.chapters) {
      changes.push({
        from: chapter.from,
        to: chapter.to,
        // A heading on the line before its chapter's first words: a blank line between them.
        insert: `${"#".repeat(chapter.level)} ${chapter.text}${chapter.before ? "\n" : ""}`,
      });
      if (chapter.joins) cut(chapter.joins);
    }
  if (choice.lines)
    for (const line of shape.lines)
      changes.push({
        from: line.from,
        to: line.to,
        insert: `@${line.handle} ${line.direction ? `(${line.direction}) ` : ""}`,
      });
  // Taken out wholly, or changed: never both for one stretch (a heading in the notices goes).
  const sorted = changes.sort((a, b) => a.from - b.from || a.to - b.to);
  const kept: TextChange[] = [];
  for (const change of sorted) {
    const last = kept.at(-1);
    if (last && change.from < last.to) {
      if (change.to - change.from > last.to - last.from) kept[kept.length - 1] = change;
      continue;
    }
    kept.push(change);
  }
  let text = applyChanges(story.source, kept);
  if (choice.details) {
    for (const [key, value] of [
      ["title", shape.title],
      ["author", shape.author],
    ] as const) {
      if (!value) continue;
      const now = parse(text);
      const was = now.meta[key];
      if (was && was !== "Untitled") continue;
      text = applyChanges(text, setMeta(now, key, value));
    }
    // A new story's `# Untitled` heading: the book's title now.
    if (shape.title) text = text.replace(/^# Untitled[ \t]*$/m, `# ${shape.title}`);
  }
  if (choice.lines) {
    const added = new Set<string>();
    for (const line of shape.lines) {
      const now = parse(text);
      if (added.has(line.handle) || now.cast.some((member) => member.handle === line.handle))
        continue;
      added.add(line.handle);
      text = applyChanges(text, setFullName(now, line.handle, line.fullName));
    }
  }
  return text;
}
