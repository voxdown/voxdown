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

export type Spoken = { char: string; speaker: string; direction: string | null; target: boolean };

/** Names are the same name whatever their case (§5.2): `@gerald` is Gerald. */
export const sameName = (a: string, b: string) =>
  a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

/**
 * The stretches of one quote, and the sounds made inside it with no mark of their own: a quote runs
 * to its closing mark (§6.4), over sounds, page turns, notes and lines (§5.7), so an edit to one of
 * its stretches is an edit to all of them. A direction's run ends at a `@(…)` inside the quote.
 */
export function quoteOf(story: Story, target: Speech, acrossDirections = true): Item[] {
  const block = story.blocks.find(
    (block) =>
      block.kind === "paragraph" && block.lines.some((line) => line.items.includes(target)),
  );
  if (block?.kind !== "paragraph") return [target];
  const items = block.lines.flatMap((line) => line.items);
  const said = items.filter((item): item is Speech => item.kind === "speech");
  const joined = (a: Speech | undefined, b: Speech | undefined) =>
    a !== undefined &&
    b !== undefined &&
    a.quoted &&
    b.quoted &&
    !a.closeQuote &&
    !b.openQuote &&
    a.mark === b.mark &&
    (acrossDirections || !b.directionMark);
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
 * sounds characters make (`@Gerald [snores]`); spaces and quotation marks aside. `target` marks
 * the characters of the items an edit is made to.
 */
export function spokenChars(story: Story, target: readonly Item[] = []): Spoken[] {
  return allItems(story).flatMap((item) => {
    if (item.kind !== "speech" && item.kind !== "vocal") return [];
    const words = item.kind === "speech" ? item.text : item.description;
    return [...words.replace(/[\s"'“”‘’„‚«»‹›\\]/g, "")].map((char) => ({
      char,
      speaker: item.speaker,
      direction: item.direction,
      target: target.includes(item),
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
  const before = spokenChars(story, quoteOf(story, target, promise.acrossDirections));
  const after = spokenChars(edited);
  if (after.map((c) => c.char).join("") !== before.map((c) => c.char).join(""))
    return "the words changed";
  for (const [index, was] of before.entries()) {
    const now = after[index] as Spoken;
    if (
      was.target
        ? !promise.inside(was, now)
        : !sameName(now.speaker, was.speaker) || now.direction !== was.direction
    ) {
      return `"${was.char}" at ${index} went from ${was.speaker} (${was.direction}) to ${now.speaker} (${now.direction})`;
    }
  }
  const some = promise.some ?? (() => true);
  return some(after.filter((_, index) => before[index]?.target))
    ? null
    : "the edited words didn't change";
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
  },
};
