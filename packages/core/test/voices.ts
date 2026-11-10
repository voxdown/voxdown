/** What the edit tests check: who says each character of a story's words, and that an edit keeps it. */
import {
  type Item,
  type Line,
  type Speech,
  type Story,
  type TextChange,
  applyChanges,
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
 * The stretches of one quote (§5.7): a quote left open at the end of a line goes on at the start
 * of the next line of its paragraph, so an edit to one of its stretches is an edit to all of them.
 */
export function quoteOf(story: Story, target: Speech): Speech[] {
  const block = story.blocks.find(
    (block) =>
      block.kind === "paragraph" && block.lines.some((line) => line.items.includes(target)),
  );
  if (block?.kind !== "paragraph") return [target];
  const lines = block.lines.map((line) =>
    line.items.filter((item): item is Speech => item.kind === "speech"),
  );
  const lineOf = (speech: Speech) => lines.findIndex((stretches) => stretches.includes(speech));
  const joined = (a: Speech | undefined, b: Speech | undefined) =>
    a !== undefined &&
    b !== undefined &&
    a.quoted &&
    b.quoted &&
    !a.closeQuote &&
    !b.openQuote &&
    a.mark === b.mark &&
    lineOf(b) === lineOf(a) + 1 &&
    lines[lineOf(a)]?.at(-1) === a &&
    lines[lineOf(b)]?.[0] === b;
  const all = lines.flat();
  let from = all.indexOf(target);
  let to = from;
  while (joined(all[from - 1], all[from])) from--;
  while (joined(all[to], all[to + 1])) to++;
  return all.slice(from, to + 1);
}

/**
 * Each character of what is heard, with who says it and how: the words of every stretch and the
 * sounds characters make (`@Gerald [snores]`); spaces and quotation marks aside.
 */
export function spokenChars(story: Story, target?: Speech): Spoken[] {
  const quote = target ? quoteOf(story, target) : [];
  return allItems(story).flatMap((item) => {
    if (item.kind !== "speech" && item.kind !== "vocal") return [];
    const words = item.kind === "speech" ? item.text : item.description;
    return [...words.replace(/[\s"'“”‘’„‚«»‹›\\]/g, "")].map((char) => ({
      char,
      speaker: item.speaker,
      direction: item.direction,
      target: item.kind === "speech" && quote.includes(item),
    }));
  });
}

/**
 * Why an edit's changes break the promise every edit makes, or null if they keep it: the same
 * words in the same order, every word outside the edited stretch said as before, `inside` true of
 * the edited stretch's words, and `some` true of them taken together.
 */
export function brokenPromise(
  story: Story,
  target: Speech,
  changes: TextChange[],
  inside: (before: Spoken, after: Spoken) => boolean,
  some: (after: Spoken[]) => boolean = () => true,
): string | null {
  const before = spokenChars(story, target);
  const after = spokenChars(parse(applyChanges(story.source, changes)));
  if (after.map((c) => c.char).join("") !== before.map((c) => c.char).join(""))
    return "the words changed";
  for (const [index, was] of before.entries()) {
    const now = after[index] as Spoken;
    if (
      was.target
        ? !inside(was, now)
        : !sameName(now.speaker, was.speaker) || now.direction !== was.direction
    ) {
      return `"${was.char}" at ${index} went from ${was.speaker} (${was.direction}) to ${now.speaker} (${now.direction})`;
    }
  }
  return some(after.filter((_, index) => before[index]?.target))
    ? null
    : "the edited words didn't change";
}

/** The two edits every stretch is tried with, and what each must do to the stretch's own words. */
export const EDITS = {
  speaker: {
    inside: (was: Spoken, now: Spoken) =>
      (now.speaker === "Zed" || sameName(now.speaker, was.speaker)) &&
      now.direction === was.direction,
    some: (now: Spoken[]) => now.some((c) => c.speaker === "Zed"),
  },
  direction: {
    inside: (was: Spoken, now: Spoken) =>
      sameName(now.speaker, was.speaker) && now.direction === "softly",
    some: () => true,
  },
};
