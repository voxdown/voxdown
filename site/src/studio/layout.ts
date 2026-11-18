import type { FountainDocument, FountainElement, FountainKind } from "./fountain";
import { type FountainRun, fountainRuns } from "./inline";

export interface LayoutLine {
  text: string;
  x: number;
  /** Baseline measured from the top of the page, in points. */
  y: number;
  sourceLine: number;
  runs: FountainRun[];
}
export interface ScreenplayLayout {
  width: number;
  height: number;
  pages: { number: number | null; lines: LayoutLine[] }[];
  warnings: string[];
  /** Malformed source remains visible in preview, but must never be exported silently. */
  exportBlocked: boolean;
}
export const SCREENPLAY_FONT_SIZE = 12;
export const SCREENPLAY_LEADING = 12;
export const SCREENPLAY_PITCH = 7.2;
const LEFT = 108;
const TOP = 84;
type Row = Omit<LayoutLine, "y"> & { kind: FountainKind };
type Speech = { cue: FountainElement; body: FountainElement[] };
type Block = { kind: "speech"; speeches: Speech[] } | { kind: "element"; element: FountainElement };
const excluded = new Set<FountainKind>(["title", "note", "boneyard", "section", "synopsis"]);
const speechKinds = new Set<FountainKind>(["dialogue", "parenthetical", "lyric"]);
const chars = (text: string) => Array.from(text).length;

/** Pure layout shared by browser preview and PDF. Source text is never HTML. */
export function layoutScreenplay(
  document: FountainDocument,
  paper: "letter" | "a4" = "letter",
): ScreenplayLayout {
  const width = paper === "a4" ? 595.276 : 612;
  const height = paper === "a4" ? 841.89 : 792;
  const right = width - 72;
  const capacity = Math.floor((height - 72 - TOP) / SCREENPLAY_LEADING) + 1;
  const warnings = document.warnings.map((warning) => `Line ${warning.line}: ${warning.message}`);
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const pages: ScreenplayLayout["pages"] = [];
  const layout: ScreenplayLayout = {
    width,
    height,
    pages,
    warnings,
    exportBlocked: document.warnings.length > 0,
  };

  function wrapped(
    text: string,
    x: number,
    maxWidth: number,
    sourceLine: number,
    kind: FountainKind,
    align: "left" | "right" | "center" = "left",
  ): Row[] {
    const max = Math.floor((maxWidth + 0.001) / SCREENPLAY_PITCH);
    const styled = fountainRuns(text.replaceAll("\t", "    ")).flatMap((run) =>
      Array.from(run.text, (text) => ({ ...run, text })),
    );
    const result: Row[] = [];
    let start = 0;
    do {
      let end = Math.min(start + max, styled.length);
      let next = end;
      if (end < styled.length) {
        let space = end;
        while (space > start && styled[space]?.text !== " ") space--;
        // Leading indentation is not a word boundary. Very long tokens must wrap.
        if (space > start && styled.slice(start, space).some((char) => char.text !== " ")) {
          end = space;
          next = space + 1;
        } else
          warn(
            `Line ${sourceLine}: a word or indentation wider than its column was wrapped. Review this line in the page preview.`,
          );
      }
      const runs: FountainRun[] = [];
      for (const char of styled.slice(start, end)) {
        const previous = runs.at(-1);
        if (
          previous &&
          previous.bold === char.bold &&
          previous.italic === char.italic &&
          previous.underline === char.underline
        )
          previous.text += char.text;
        else runs.push({ ...char });
      }
      const visible = runs.map((run) => run.text).join("");
      const used = chars(visible) * SCREENPLAY_PITCH;
      result.push({
        text: visible,
        runs,
        sourceLine,
        kind,
        x:
          x +
          (align === "right" ? maxWidth - used : align === "center" ? (maxWidth - used) / 2 : 0),
      });
      start = next;
    } while (start < styled.length);
    return result;
  }

  function elementRows(element: FountainElement): Row[] {
    const { kind, text, line } = element;
    if (kind === "transition") return wrapped(text, LEFT, right - LEFT, line, kind, "right");
    if (kind === "centered") return wrapped(text, LEFT, right - LEFT, line, kind, "center");
    const rows = wrapped(text, LEFT, right - LEFT, line, kind);
    if (kind === "lyric") for (const row of rows) for (const run of row.runs) run.italic = true;
    if (kind === "scene" && element.sceneNumber) {
      const number = element.sceneNumber;
      if (chars(number) > 7)
        throw new Error(
          `Scene number on line ${line} is too wide for the page margin. Shorten it to 7 characters or fewer.`,
        );
      // Scene numbers are inserted when the heading is placed, sharing its baseline.
    }
    return rows;
  }

  if (Object.keys(document.title).length) {
    const titleLines: LayoutLine[] = [];
    const middle: Row[] = [];
    const bottom: Row[] = [];
    const titleKeys = new Set([
      "title",
      "credit",
      "author",
      "authors",
      "source",
      "contact",
      "draft date",
      "copyright",
    ]);
    for (const key of ["title", "credit", "author", "authors", "source"]) {
      const value = document.title[key];
      if (!value) continue;
      if (middle.length) middle.push(...wrapped("", LEFT, right - LEFT, 1, "title"));
      for (const line of value.split("\n"))
        middle.push(...wrapped(line, 72, width - 144, 1, "title", "center"));
    }
    for (const key of ["contact", "draft date", "copyright"]) {
      const value = document.title[key];
      if (!value) continue;
      if (bottom.length) bottom.push(...wrapped("", LEFT, right - LEFT, 1, "title"));
      for (const line of value.split("\n"))
        bottom.push(...wrapped(line, LEFT, right - LEFT, 1, "title"));
    }
    for (const key of Object.keys(document.title))
      if (!titleKeys.has(key))
        warn(`Title-page field “${key}” is saved in Fountain but not printed.`);
    const middleTop = Math.max(TOP, Math.round((height * 0.35) / 12) * 12);
    const bottomTop = height - 84 - Math.max(0, bottom.length - 1) * 12;
    if (
      bottomTop < TOP ||
      middleTop + middle.length * 12 > (bottom.length ? bottomTop - 24 : height - 72)
    ) {
      throw new Error(
        "The title-page metadata does not fit on one page. Shorten the title, credits, or contact details before exporting.",
      );
    }
    middle.forEach((row, index) => titleLines.push({ ...row, y: middleTop + index * 12 }));
    bottom.forEach((row, index) => titleLines.push({ ...row, y: bottomTop + index * 12 }));
    pages.push({ number: null, lines: titleLines });
  }

  const elements = document.elements.filter((element) => !excluded.has(element.kind));
  const blocks: Block[] = [];
  function readSpeech(index: number): { speech: Speech; next: number } {
    const cue = elements[index] as FountainElement;
    const body: FountainElement[] = [];
    let next = index + 1;
    while (elements[next] && speechKinds.has((elements[next] as FountainElement).kind))
      body.push(elements[next++] as FountainElement);
    return { speech: { cue, body }, next };
  }
  for (let i = 0; i < elements.length; ) {
    const element = elements[i] as FountainElement;
    if (element.kind !== "character") {
      blocks.push({ kind: "element", element });
      i++;
      continue;
    }
    const first = readSpeech(i);
    let next = first.next;
    while (elements[next]?.kind === "blank") next++;
    const secondCue = elements[next];
    if (secondCue?.kind === "character" && secondCue.dual) {
      const second = readSpeech(next);
      blocks.push({ kind: "speech", speeches: [first.speech, second.speech] });
      i = second.next;
    } else {
      if (element.dual)
        warn(
          `Line ${element.line}: dual dialogue has no preceding speech; printed as a single speech.`,
        );
      blocks.push({ kind: "speech", speeches: [first.speech] });
      i = first.next;
    }
  }

  let bodyPage = 0;
  let page: ScreenplayLayout["pages"][number] | undefined;
  let rowIndex = 0;
  let pendingBlank = 0;
  function newPage() {
    bodyPage++;
    page = { number: bodyPage, lines: [] };
    if (bodyPage > 1) {
      const text = `${bodyPage}.`;
      page.lines.push({
        text,
        runs: fountainRuns(text),
        sourceLine: 0,
        x: right - chars(text) * 7.2,
        y: 48,
      });
    }
    pages.push(page);
    rowIndex = 0;
  }
  function put(row: Row, at = rowIndex) {
    if (!page) newPage();
    (page as ScreenplayLayout["pages"][number]).lines.push({ ...row, y: TOP + at * 12 });
  }
  function spaceBefore(required: number) {
    if (!page) newPage();
    if (rowIndex + pendingBlank + required > capacity) {
      if (rowIndex) newPage();
      if (pendingBlank > 1)
        warn("Blank lines that would create empty pages were omitted at page boundaries.");
    } else if (rowIndex) rowIndex += pendingBlank;
    pendingBlank = 0;
  }

  function speechRows(speech: Speech, column: number, dual: boolean) {
    const columnWidth = dual ? Math.floor((right - LEFT - 28.8) / 2 / 7.2) * 7.2 : 252;
    const columnX = dual ? LEFT + column * (columnWidth + 28.8) : 180;
    const cueX = dual ? columnX + 43.2 : 252;
    const parentX = dual ? columnX + 21.6 : 216;
    const cueText = speech.cue.text;
    const continuedText = cueText + (!/\(CONT['’]D\)$/i.test(cueText) ? " (CONT'D)" : "");
    const cue = wrapped(
      cueText,
      cueX,
      dual ? columnWidth - 43.2 : right - cueX,
      speech.cue.line,
      "character",
    );
    const continuedCue = wrapped(
      continuedText,
      cueX,
      dual ? columnWidth - 43.2 : right - cueX,
      speech.cue.line,
      "character",
    );
    if (continuedCue.length > 3)
      throw new Error(
        `Character cue on line ${speech.cue.line} is too long. Shorten it before exporting.`,
      );
    const body = speech.body.flatMap((element) => {
      const rows = wrapped(
        element.text,
        element.kind === "parenthetical" ? parentX : columnX,
        element.kind === "parenthetical" ? (dual ? columnWidth - 43.2 : 180) : columnWidth,
        element.line,
        element.kind,
      );
      if (element.kind === "lyric")
        for (const row of rows) for (const run of row.runs) run.italic = true;
      return rows;
    });
    return { cue, continuedCue, body, cueX, moreWidth: dual ? columnWidth - 43.2 : right - cueX };
  }
  function minimumBody(rows: Row[], start = 0) {
    let count = 0;
    // Keep a parenthetical intact and with at least two lines of following dialogue.
    while (rows[start + count]?.kind === "parenthetical") count++;
    return Math.min(rows.length - start, count + 2);
  }
  function minimumBlock(block: Block): number {
    if (block.kind === "speech")
      return Math.max(
        ...block.speeches.map((speech, column) => {
          const rows = speechRows(speech, column, block.speeches.length === 2);
          return (
            rows.cue.length +
            minimumBody(rows.body) +
            (rows.body.length > minimumBody(rows.body) ? 1 : 0)
          );
        }),
      );
    return Math.min(2, elementRows(block.element).length);
  }
  function placeSpeech(speeches: Speech[]) {
    const dual = speeches.length === 2;
    const sides = speeches.map((speech, column) => ({
      speech,
      column,
      cursor: 0,
      rows: speechRows(speech, column, dual),
      done: false,
    }));
    for (const side of sides)
      if (!side.rows.body.length)
        warn(`Line ${side.speech.cue.line}: character cue has no dialogue.`);
    let continuation = false;
    while (sides.some((side) => !side.done)) {
      const active = sides.filter((side) => !side.done);
      const minimum = Math.max(
        ...active.map((side) => {
          const cue = continuation ? side.rows.continuedCue : side.rows.cue;
          const bodyMin = minimumBody(side.rows.body, side.cursor);
          return cue.length + bodyMin + (side.cursor + bodyMin < side.rows.body.length ? 1 : 0);
        }),
      );
      if (minimum > capacity)
        throw new Error(
          `Parenthetical or dialogue opening near line ${active[0]?.speech.cue.line} cannot fit on a page. Shorten the parenthetical or split it into action and dialogue.`,
        );
      spaceBefore(minimum);
      const available = capacity - rowIndex;
      const chunks = active.map((side) => {
        const cue = continuation ? side.rows.continuedCue : side.rows.cue;
        const remaining = side.rows.body.length - side.cursor;
        let take = Math.min(
          remaining,
          available - cue.length - (remaining > available - cue.length ? 1 : 0),
        );
        // Never end a page in a parenthetical, or between it and the next speech line.
        if (take < remaining)
          while (take > 0 && side.rows.body[side.cursor + take - 1]?.kind === "parenthetical")
            take--;
        if (take < minimumBody(side.rows.body, side.cursor))
          throw new Error(
            `Dialogue near line ${side.speech.cue.line} cannot be paginated safely. Shorten its parenthetical.`,
          );
        const more = take < remaining;
        const rows = [...cue, ...side.rows.body.slice(side.cursor, side.cursor + take)];
        if (more)
          rows.push(
            ...wrapped(
              "(MORE)",
              side.rows.cueX,
              side.rows.moreWidth,
              side.speech.cue.line,
              "parenthetical",
            ),
          );
        return { side, rows, take, more };
      });
      const used = Math.max(...chunks.map((chunk) => chunk.rows.length));
      for (const chunk of chunks) {
        chunk.rows.forEach((row, index) => put(row, rowIndex + index));
        chunk.side.cursor += chunk.take;
        chunk.side.done = !chunk.more;
      }
      rowIndex += used;
      if (sides.some((side) => !side.done)) {
        newPage();
        continuation = true;
      }
    }
  }

  for (const [index, block] of blocks.entries()) {
    if (block.kind === "speech") {
      placeSpeech(block.speeches);
      continue;
    }
    const element = block.element;
    if (element.kind === "blank") {
      pendingBlank++;
      continue;
    }
    if (element.kind === "page-break") {
      if (page && rowIndex) {
        page = undefined;
        rowIndex = 0;
      }
      pendingBlank = 0;
      continue;
    }
    const rows = elementRows(element);
    if (element.kind === "scene") {
      let following = index + 1;
      let gap = 0;
      while (
        blocks[following]?.kind === "element" &&
        (blocks[following] as { kind: "element"; element: FountainElement }).element.kind ===
          "blank"
      ) {
        gap++;
        following++;
      }
      const next = blocks[following];
      const nextMinimum =
        next && !(next.kind === "element" && next.element.kind === "page-break")
          ? minimumBlock(next)
          : 0;
      const required = rows.length + gap + nextMinimum;
      if (required > capacity)
        throw new Error(
          `Scene heading and opening on line ${element.line} do not fit on a page. Shorten the heading or remove excess blank lines after it.`,
        );
      spaceBefore(required);
    } else spaceBefore(Math.min(rows.length, 2));
    for (const [rowNumber, row] of rows.entries()) {
      if (rowIndex >= capacity) newPage();
      put(row);
      if (rowNumber === 0 && element.sceneNumber) {
        const number = element.sceneNumber;
        const numberRow = wrapped(number, 0, 72, element.line, "scene")[0] as Row;
        put({ ...numberRow, x: LEFT - 14.4 - chars(number) * 7.2 });
        put({ ...numberRow, x: right + 14.4 });
      }
      rowIndex++;
    }
  }
  if (!pages.length) newPage();
  return layout;
}
