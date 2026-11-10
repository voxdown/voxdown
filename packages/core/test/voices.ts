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
  /** Whether its stretch carries on a quote from the line or paragraph before (§5.7). */
  carries: boolean;
};

/** Names are the same name whatever their case (§5.2): `@gerald` is Gerald. */
export const sameName = (a: string, b: string) =>
  a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

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

/**
 * Each character of what is heard, with who says it and how: the words of every stretch and the
 * sounds characters make (`@Gerald [snores]`); spaces and punctuation aside. `target` marks
 * the characters of the items an edit is made to.
 */
export function spokenChars(story: Story, target: readonly Item[] = []): Spoken[] {
  const firsts = new Set(
    story.blocks.flatMap((block) => {
      if (block.kind !== "paragraph") return [];
      const first = block.lines
        .flatMap((line) => line.items)
        .find((item) => item.kind === "speech");
      return first ? [first] : [];
    }),
  );
  return allItems(story).flatMap((item) => {
    if (item.kind !== "speech" && item.kind !== "vocal") return [];
    // A stretch with no letter or digit in it isn't read aloud (§12.1).
    if (item.kind === "speech" && !/[\p{L}\p{N}]/u.test(item.text)) return [];
    const words = item.kind === "speech" ? item.text : item.description;
    return [...words.replace(/[\s\p{P}]/gu, "")].map((char) => ({
      char,
      speaker: item.speaker,
      direction: item.direction,
      target: target.includes(item),
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
  // No new warnings, but that a new name isn't in the cast, or someone in it no longer speaks.
  const counts = (of: Story) => {
    const found = new Map<string, number>();
    for (const { code } of of.warnings) {
      if (code !== "unknown-character" && code !== "silent-cast-member") {
        found.set(code, (found.get(code) ?? 0) + 1);
      }
    }
    return found;
  };
  const was = counts(story);
  for (const [code, count] of counts(edited)) {
    if (count > (was.get(code) ?? 0)) return `a new ${code} warning`;
  }
  const before = spokenChars(story, quoteOf(story, target, promise.acrossDirections));
  const after = spokenChars(edited);
  if (after.map((c) => c.char).join("") !== before.map((c) => c.char).join(""))
    return "the words changed";
  for (const [index, was] of before.entries()) {
    const now = after[index] as Spoken;
    if (
      was.target
        ? !promise.inside(was, now)
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

/** The two edits every stretch is tried with, and what each must do to the stretch's own words. */
export const EDITS: Record<"speaker" | "direction", EditPromise> = {
  speaker: {
    inside: (was, now) =>
      (now.speaker === "Zed" || sameName(now.speaker, was.speaker)) &&
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
