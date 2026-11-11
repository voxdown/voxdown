/** What the edit tests check: who says each character of a story's words, and that an edit keeps it. */
import {
  type Item,
  type Line,
  type Speech,
  type Story,
  type TextChange,
  applyChanges,
  bookText,
  parse,
} from "../src/index";

export function allLines(story: Story): Line[] {
  return story.blocks.flatMap((block) =>
    block.kind === "break" ? [] : block.kind === "heading" ? [block.line] : block.lines,
  );
}

export function allItems(story: Story): Item[] {
  return allLines(story).flatMap((line) => line.items);
}

/** The stretches someone says, with words in them (a letter or a digit, as the views count them). */
export function speeches(story: Story): Speech[] {
  return allItems(story).filter(
    (item): item is Speech => item.kind === "speech" && /[\p{L}\p{N}]/u.test(item.text),
  );
}

export type Spoken = {
  char: string;
  speaker: string;
  direction: string | null;
  target: boolean;
  /** Whether the edit may leave this character of its stretch as it was (see narrationBefore). */
  optional: boolean;
  /** Whether it is read aloud: its block isn't `{book only}` or `{hidden}` (§9.3). */
  audible: boolean;
  /** Whether its stretch carries on a quote from the line or paragraph before (§5.7). */
  carries: boolean;
  /**
   * Whether the edit must move this character itself, not just may: a quote's, or a character's
   * own words. (Narration may hold quotes, of which only the first goes.)
   */
  strict: boolean;
};

/** A name as §5.2 compares it: whatever its case and kind of apostrophe (`@o’brien` is O'Brien). */
const asName = (name: string) => name.normalize("NFC").toLowerCase().replace(/’/g, "'");

/** Names are the same name whatever their case and apostrophes (§5.2): `@gerald` is Gerald. */
export const sameName = (a: string, b: string) => asName(a) === asName(b);

/**
 * The stretches of one quote, and the sounds made inside it with no mark of their own: a quote runs
 * to its closing mark (§6.4), over sounds, page turns, notes and lines (§5.7), so an edit to one of
 * its stretches is an edit to all of them. A direction's run ends at a `@(…)` inside the quote.
 */
export function quoteOf(story: Story, target: Speech, acrossDirections = true): Item[] {
  // Narration nothing marks runs on past a sound, page turn or note on its line: a quote that
  // opens in it may go on past them, and goes where it goes.
  if (!target.quoted && !target.mark) {
    const line = allLines(story).find((other) => other.items.includes(target));
    const run: Item[] = [target];
    let sounds: Item[] = [];
    for (const item of line?.items.slice(line.items.indexOf(target) + 1) ?? []) {
      if (item.kind === "mark" || item.kind === "direction") break;
      // A sound for whoever is speaking, between two of the run's stretches.
      if (item.kind === "vocal" && !item.mark) sounds.push(item);
      if (item.kind !== "speech") continue;
      if (item.quoted || item.mark || item.directionMark || item.speaker !== target.speaker) break;
      run.push(...sounds, item);
      sounds = [];
    }
    return run;
  }
  const paragraphs = story.blocks.filter((block) => block.kind === "paragraph");
  if (!paragraphs.some((block) => block.lines.some((line) => line.items.includes(target)))) {
    return [target];
  }
  const items = paragraphs.flatMap((block) => block.lines.flatMap((line) => line.items));
  const blockOf = new Map<Item, unknown>();
  for (const block of paragraphs) {
    for (const line of block.lines) for (const item of line.items) blockOf.set(item, block);
  }
  const said = items.filter((item): item is Speech => item.kind === "speech");
  const joined = (a: Speech | undefined, b: Speech | undefined) => {
    if (!a || !b || !a.quoted || !b.quoted || a.closeQuote) return false;
    if (!acrossDirections && b.directionMark) return false;
    // The same quote, on one line or over lines of a paragraph (§5.7).
    if (!b.openQuote) return a.mark === b.mark && blockOf.get(a) === blockOf.get(b);
    // The next paragraph carries it on, opening with the quote's mark (§5.7).
    return b.continued && !b.mark && blockOf.get(a) !== blockOf.get(b);
  };
  let from = said.indexOf(target);
  let to = from;
  while (joined(said[from - 1], said[from])) from--;
  while (joined(said[to], said[to + 1])) to++;
  const stretches = said.slice(from, to + 1);
  const start = items.indexOf(stretches[0] as Speech);
  const end = items.indexOf(stretches[stretches.length - 1] as Speech);
  return items
    .slice(start, end + 1)
    .filter((item) =>
      item.kind === "speech" ? stretches.includes(item) : item.kind === "vocal" && !item.mark,
    );
}

const OPENS = /^\s*["'“‘„‚«‹»›]/u;

/** Each opening mark and the marks that close it (§5.5). */
const CLOSES: Record<string, string> = {
  "“": "”",
  "‘": "’",
  "„": "“”",
  "‚": "‘’",
  "«": "»",
  "»": "«»",
  "‹": "›",
  '"': '"',
  "'": "'",
};

/**
 * Whether a paragraph's text leaves a quote open: its marks paired as they come, each closing the
 * last one open if it can, else opening one (so `»` closes a French `«`, and opens a Danish quote).
 */
function leavesOpen(paragraph: string): boolean {
  // Apostrophes aside: rock ’n’ roll's, a word's own, and one that starts a word (’90s).
  const text = paragraph.replace(/[’']n[’']/gu, "n");
  const open: string[] = [];
  for (const m of text.matchAll(/["'“”‘’„‚«»‹›]/gu)) {
    const at = m.index ?? 0;
    const mark = m[0];
    const before = text[at - 1] ?? " ";
    const after = text[at + 1] ?? " ";
    if (/['’]/u.test(mark) && /\p{L}/u.test(before) && /\p{L}/u.test(after)) continue;
    if (mark === "’" && /\s/u.test(before)) continue;
    const top = open[open.length - 1];
    if (top && (CLOSES[top] ?? "").includes(mark)) open.pop();
    else if (/[“‘„‚«»‹]/u.test(mark) || (/["']/u.test(mark) && /\s/u.test(before))) open.push(mark);
  }
  return open.length > 0;
}

/**
 * The narration of the paragraphs before `target`'s that an unmarked speech may have started in:
 * a paragraph of narration that opens with a quotation mark carries on a quote the one before left
 * open (§5.7), so giving it away may give that whole speech, from where it started. The edit may
 * move these words, or not.
 */
export function narrationBefore(story: Story, target: Speech): Item[] {
  if (target.quoted || target.mark || !sameName(target.speaker, story.meta.narrator)) return [];
  const blocks = story.blocks.filter((block) => block.kind === "paragraph");
  const said = (at: number) =>
    (blocks[at]?.lines ?? [])
      .flatMap((line) => line.items)
      .filter((item): item is Speech => item.kind === "speech");
  let at = blocks.findIndex((_, index) => said(index)[0] === target);
  const chain: Item[] = [];
  while (at > 0 && OPENS.test(said(at)[0]?.text ?? "")) {
    const before = said(at - 1);
    const narration = before.every(
      (item) => !item.quoted && !item.mark && sameName(item.speaker, story.meta.narrator),
    );
    if (before.length === 0 || !narration || !leavesOpen(before.map((s) => s.text).join(" ")))
      break;
    chain.unshift(...before);
    at--;
  }
  return chain;
}

/**
 * Each character of what is heard, with who says it and how: the words of every stretch and the
 * sounds characters make (`@Gerald [snores]`); spaces and punctuation aside. `target` marks
 * the characters of the items an edit is made to.
 */
export function spokenChars(
  story: Story,
  target: readonly Item[] = [],
  strict = false,
  optional: readonly Item[] = [],
): Spoken[] {
  const firsts = new Set(
    story.blocks.flatMap((block) => {
      if (block.kind !== "paragraph") return [];
      const first = block.lines
        .flatMap((line) => line.items)
        .find((item) => item.kind === "speech");
      return first ? [first] : [];
    }),
  );
  const audible = new Set<Item>();
  for (const block of story.blocks) {
    if (block.kind === "break" || (block.visibility !== "both" && block.visibility !== "audio"))
      continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      for (const item of line.items) audible.add(item);
    }
  }
  return allItems(story).flatMap((item) => {
    if (item.kind !== "speech" && item.kind !== "vocal") return [];
    // A stretch with no letter or digit in it isn't read aloud (§12.1).
    if (item.kind === "speech" && !/[\p{L}\p{N}]/u.test(item.text)) return [];
    const words = item.kind === "speech" ? item.text : item.description;
    return [...words.replace(/[\s\p{P}]/gu, "")].map((char) => ({
      char,
      speaker: item.speaker,
      direction: item.direction,
      target: target.includes(item) || optional.includes(item),
      strict: strict && target.includes(item),
      optional: optional.includes(item),
      audible: audible.has(item),
      // A quote that runs over lines, or a paragraph that carries the speech before it on.
      carries:
        item.kind === "speech" &&
        item.quoted &&
        (!item.openQuote || (item.continued && !item.mark && firsts.has(item))),
    }));
  });
}

export type EditPromise = {
  /** Whether a character of the edited stretch is said as the edit promises. */
  inside: (before: Spoken, after: Spoken) => boolean;
  /** Whether the edited stretch's characters, taken together, show the edit was made. */
  some?: (after: Spoken[]) => boolean;
  /** Whether the edit's stretch runs on past a `@(…)` inside its quote. */
  acrossDirections: boolean;
  /** Whether a stretch is already as the edit would make it. */
  already?: (target: Speech) => boolean;
};

/**
 * Why an edit's changes break the promise every edit makes, or null if they keep it: the same
 * words in the same order, every word outside the edited stretch said as before, `inside` true of
 * the edited stretch's words, and `some` true of them taken together.
 */
export function brokenPromise(
  story: Story,
  target: Speech,
  changes: TextChange[],
  promise: EditPromise,
): string | null {
  const edited = parse(applyChanges(story.source, changes));
  if (bookText(edited) !== bookText(story)) return "the book changed";
  const added = newWarnings(story, edited);
  if (added.length > 0) return `a new ${added[0]} warning`;
  const narration = !target.quoted && sameName(target.speaker, story.meta.narrator);
  const before = spokenChars(
    story,
    quoteOf(story, target, promise.acrossDirections),
    !narration,
    narrationBefore(story, target),
  );
  const after = spokenChars(edited);
  if (after.map((c) => c.char).join("") !== before.map((c) => c.char).join(""))
    return "the words changed";
  const silenced = after.findIndex((now, index) => now.audible !== before[index]?.audible);
  if (silenced >= 0)
    return `"${after[silenced]?.char}" at ${silenced} is heard or not as it wasn't`;
  for (const [index, was] of before.entries()) {
    const now = after[index] as Spoken;
    if (
      was.target
        ? !promise.inside(was, now) &&
          !(was.optional && sameName(now.speaker, was.speaker) && now.direction === was.direction)
        : (!sameName(now.speaker, was.speaker) || now.direction !== was.direction) &&
          // A paragraph that now carries the edited speech on (§5.7) goes with it.
          !(now.carries && promise.inside(was, now))
    ) {
      return `"${was.char}" at ${index} went from ${was.speaker} (${was.direction}) to ${now.speaker} (${now.direction})`;
    }
  }
  // The stretch's words, and those of lines and paragraphs that now carry its quote on.
  const some = promise.some ?? (() => true);
  const moved = after.filter((now, index) => {
    const was = before[index] as Spoken;
    const changed = !sameName(now.speaker, was.speaker) || now.direction !== was.direction;
    return was.target || (now.carries && changed);
  });
  return some(moved) ? null : "the edited words didn't change";
}

/**
 * The warnings `after` has more of than `before`, by code: but that a new name isn't in the cast,
 * or someone in it no longer speaks.
 */
export function newWarnings(before: Story, after: Story): string[] {
  const counts = (of: Story) => {
    const found = new Map<string, number>();
    for (const { code } of of.warnings) {
      if (code !== "unknown-character" && code !== "silent-cast-member") {
        found.set(code, (found.get(code) ?? 0) + 1);
      }
    }
    return found;
  };
  const was = counts(before);
  return [...counts(after)].filter(([code, count]) => count > (was.get(code) ?? 0)).map(([c]) => c);
}

/** The two edits every stretch is tried with, and what each must do to the stretch's own words. */
export const EDITS: Record<"speaker" | "direction", EditPromise> = {
  speaker: {
    inside: (was, now) =>
      (was.strict
        ? now.speaker === "Zed"
        : now.speaker === "Zed" || sameName(now.speaker, was.speaker)) &&
      now.direction === was.direction,
    some: (now) => now.some((c) => c.speaker === "Zed"),
    acrossDirections: true,
  },
  direction: {
    inside: (was, now) => sameName(now.speaker, was.speaker) && now.direction === "softly",
    acrossDirections: false,
    already: (target) => target.direction === "softly",
  },
};

/**
 * A mark the changes wrote that nothing needs: taken out (with the space after it), every word is
 * heard and printed as before. Null if each one is needed. A direction written into a mark counts
 * on its own, and so does any two of them together (`@Gerald (soft) @() “One.` is no change).
 */
export function spareMark(story: Story, changes: readonly TextChange[]): string | null {
  const text = applyChanges(story.source, changes);
  const after = parse(text);
  let delta = 0;
  const written = [...changes]
    .sort((a, b) => a.from - b.from)
    .map((change) => {
      const from = change.from + delta;
      delta += change.insert.length - (change.to - change.from);
      return { from, to: from + change.insert.length };
    });
  const heard = (of: Story) =>
    spokenChars(of)
      .map((c) => `${c.char}${asName(c.speaker)}${c.direction}${c.audible}`)
      .join("|");
  const goal = heard(after);
  const book = bookText(after);
  const inWritten = (range: { from: number; to: number }) =>
    written.some((span) => span.from <= range.from && range.to <= span.to);
  // Each mark and `@(…)` the changes wrote, and each direction they wrote into a mark.
  const pieces: Array<{ from: number; to: number }> = [];
  for (const item of allItems(after)) {
    if (item.kind === "direction" && inWritten(item.range)) pieces.push(item.range);
    if (item.kind !== "mark") continue;
    if (inWritten(item.range)) pieces.push(item.range);
    else if (item.directionRange && inWritten(item.directionRange)) {
      // `@Gerald (soft)`: the direction and the space before it.
      const from =
        text[item.directionRange.from - 1] === " "
          ? item.directionRange.from - 1
          : item.directionRange.from;
      pieces.push({ from, to: item.directionRange.to });
    }
  }
  const without = (cut: Array<{ from: number; to: number }>) => {
    let out = text;
    for (const piece of [...cut].sort((a, b) => b.from - a.from)) {
      const end = out[piece.to] === " " && out[piece.from - 1] !== " " ? piece.to + 1 : piece.to;
      out = out.slice(0, piece.from) + out.slice(end);
    }
    return parse(out);
  };
  const spare = (cut: Array<{ from: number; to: number }>) => {
    const story = without(cut);
    return heard(story) === goal && bookText(story) === book;
  };
  for (const [index, piece] of pieces.entries()) {
    if (spare([piece]))
      return `${text.slice(piece.from, piece.to)} is spare in ${JSON.stringify(text)}`;
    for (const other of pieces.slice(index + 1)) {
      if (spare([piece, other])) {
        return `${text.slice(piece.from, piece.to)} and ${text.slice(other.from, other.to)} are spare in ${JSON.stringify(text)}`;
      }
    }
  }
  return null;
}

/** Each character heard, where it is in the source, and who says it and how (spokenChars, placed). */
export function heardAt(
  story: Story,
): Array<{ at: number; speaker: string; direction: string | null }> {
  const out: Array<{ at: number; speaker: string; direction: string | null }> = [];
  for (const line of allLines(story)) {
    const unheard = line.items.filter((item) => item.kind !== "speech" && item.kind !== "vocal");
    for (const item of line.items) {
      if (item.kind === "speech" && !/[\p{L}\p{N}]/u.test(item.text)) continue;
      if (item.kind !== "speech" && item.kind !== "vocal") continue;
      const from = item.kind === "speech" ? item.textRange.from : item.range.from;
      const to = item.kind === "speech" ? item.textRange.to : item.range.to;
      for (let at = from; at < to; at++) {
        const char = story.source[at] as string;
        if (/[\s\p{P}]/u.test(char)) continue;
        if (
          item.kind === "speech" &&
          unheard.some((other) => other.range.from <= at && at < other.range.to)
        )
          continue;
        // A character's sound is heard by its description: `@Gerald [snores]`.
        if (item.kind === "vocal" && at < story.source.indexOf("[", item.range.from)) continue;
        out.push({ at, speaker: item.speaker, direction: item.direction });
      }
    }
  }
  return out;
}

const CLOSERS: Record<string, string> = {
  "“": "”",
  "‘": "’",
  '"': '"',
  "'": "'",
  "„": "“”",
  "‚": "‘’",
  "«": "»",
  "»": "«»",
  "‹": "›",
  "「": "」",
  "『": "』",
};

/**
 * Where the quote that opens at `open` ends, found in the text alone, as §5.5 and §5.7 describe
 * it and without the parser's or the edits' code: at its first closing mark (but a `’` or `'`
 * before a letter or digit, and an escaped mark); over the lines of its paragraph; and on into a
 * paragraph that opens with the same mark, past paragraphs of only page turns, pauses and notes.
 * Unclosed, at its last paragraph's end.
 */
export function quoteEnd(source: string, open: number): number {
  const mark = source[open] as string;
  const closers = CLOSERS[mark] ?? "";
  let at = open + 1;
  while (at < source.length) {
    const char = source[at] as string;
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (
      closers.includes(char) &&
      !(/['’]/.test(char) && /[\p{L}\p{N}]/u.test(source[at + 1] ?? ""))
    ) {
      return at + 1;
    }
    // A paragraph's end: the speech goes on only into one that opens with the same mark.
    const blank = /^\r?\n(?:[ \t]*\r?\n)+/.exec(source.slice(at));
    if (blank) {
      const end = at;
      let next = at + blank[0].length;
      for (;;) {
        const paragraph = /^[^\n]*(?:\n(?![ \t]*\r?\n)[^\n]*)*/.exec(source.slice(next))?.[0] ?? "";
        const only =
          paragraph.replace(/\{[^}]*\}|%%[\s\S]*?%%/g, "").trim() === "" && paragraph.trim() !== "";
        if (!only) break;
        const after = /^(?:\r?\n[ \t]*)+/.exec(source.slice(next + paragraph.length));
        if (!after) break;
        next += paragraph.length + after[0].length;
      }
      if (source[next] !== mark) return end;
      at = next + 1;
      continue;
    }
    // A group's line ends what's inside it.
    if (char === "\n" && /^[ \t]*:{3,}/.test(source.slice(at + 1))) return at;
    at++;
  }
  return source.length;
}

/**
 * The changes, each split into just what it removes and inserts, character by character: the
 * writer's line-by-line changes can span words that didn't change between two that did, which a
 * check of what was written must not count as written.
 */
export function exactChanges(source: string, changes: readonly TextChange[]): TextChange[] {
  const out: TextChange[] = [];
  for (const change of changes) {
    const a = source.slice(change.from, change.to);
    const b = change.insert;
    // The longest common subsequence of the two, as a table of suffix lengths.
    const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        const row = table[i] as Uint16Array;
        row[j] =
          a[i] === b[j]
            ? ((table[i + 1] as Uint16Array)[j + 1] as number) + 1
            : Math.max((table[i + 1] as Uint16Array)[j] as number, row[j + 1] as number);
      }
    }
    let i = 0;
    let j = 0;
    let pending: TextChange | null = null;
    const flush = () => {
      if (pending) out.push(pending);
      pending = null;
    };
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        flush();
        i++;
        j++;
        continue;
      }
      pending ??= { from: change.from + i, to: change.from + i, insert: "" };
      const removing =
        j >= b.length ||
        (i < a.length &&
          ((table[i + 1] as Uint16Array)[j] as number) >=
            ((table[i] as Uint16Array)[j + 1] as number));
      if (removing) {
        pending.to = change.from + i + 1;
        i++;
      } else {
        pending.insert += b[j];
        j++;
      }
    }
    flush();
  }
  return out;
}
