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

/** Each character of the story's words, with who says it and how; spaces and quotation marks aside. */
export function spokenChars(story: Story, target?: Speech): Spoken[] {
  return allItems(story).flatMap((item) =>
    item.kind === "speech"
      ? [...item.text.replace(/[\s"'“”‘’„‚«»‹›]/g, "")].map((char) => ({
          char,
          speaker: item.speaker,
          direction: item.direction,
          target: item === target,
        }))
      : [],
  );
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
        : now.speaker !== was.speaker || now.direction !== was.direction
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
    inside: (was: Spoken, now: Spoken) => now.speaker === "Zed" || now.speaker === was.speaker,
    some: (now: Spoken[]) => now.some((c) => c.speaker === "Zed"),
  },
  direction: {
    inside: (was: Spoken, now: Spoken) => now.speaker === was.speaker && now.direction === "softly",
    some: () => true,
  },
};
