/**
 * What the page shows of a story, read from it once: its scenes for the rail, its cast for the
 * side, and its passages for the bar over them. Plain data, worked out where the story is read: on
 * the page for a short story, in a worker for a long one, so that the page never reads a long book
 * again while it is written.
 */
import { type Story, castMemberNamed, lines, quotesOf, taggedName } from "voxdown";

/** A chapter, heading or scene break: where it starts, its name, whether it opens a chapter. */
export type SceneData = { from: number; name: string; chapter: boolean; break: boolean };

export function scenesOf(story: Story): SceneData[] {
  const scenes: SceneData[] = [];
  for (const block of story.blocks) {
    if (block.kind === "heading") {
      const said = block.line.items
        .flatMap((item) => (item.kind === "speech" ? [item.text] : []))
        .join(" ")
        .trim();
      const written = story.source.slice(block.line.range.from, block.line.range.to).trim();
      scenes.push({
        from: block.range.from,
        name: said || written || `Heading ${scenes.length + 1}`,
        chapter: block.level === 1,
        break: false,
      });
    } else if (block.kind === "break") {
      scenes.push({ from: block.range.from, name: "Scene", chapter: false, break: true });
    }
  }
  return scenes;
}

/** The cast as the side shows it: who is in it, the narrator, each speaker's lines and words. */
export type CastView = {
  cast: Array<{ handle: string; name: string; about?: string }>;
  narrator: string;
  said: Array<[string, number]>;
  words: Array<[string, number]>;
};

export function castOf(story: Story): CastView {
  const said = new Map<string, number>();
  const words = new Map<string, number>();
  for (const line of lines(story)) {
    if ((line.kind === "speech" || line.kind === "vocal") && line.speaker) {
      said.set(line.speaker, (said.get(line.speaker) ?? 0) + 1);
      const count = line.text.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0;
      words.set(line.speaker, (words.get(line.speaker) ?? 0) + count);
    }
  }
  return {
    cast: story.cast.map((member) => ({
      handle: member.handle,
      name: member.name,
      ...(member.about !== undefined ? { about: member.about } : {}),
    })),
    narrator: story.meta.narrator,
    said: [...said],
    words: [...words],
  };
}

/** A passage, as the bar over it needs it: its stretch, who says it and how, and its mark. */
export type Passage = {
  from: number;
  to: number;
  speaker: string;
  ownDirection: string | null;
  /** Where its character mark starts, if it has one. */
  markFrom?: number;
};

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** Every passage with words, in paragraphs, in order. */
export function passagesOf(story: Story): Passage[] {
  const out: Passage[] = [];
  for (const block of story.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines)
      for (const item of line.items)
        if (item.kind === "speech" && hasWords(item.text))
          out.push({
            from: item.range.from,
            to: item.range.to,
            speaker: item.speaker,
            ownDirection: item.ownDirection,
            ...(item.mark ? { markFrom: item.mark.range.from } : {}),
          });
  }
  return out;
}

/** The passage at `at`: the one starting there, else the one holding it. */
export function passageIn(passages: readonly Passage[], at: number): Passage | undefined {
  let low = 0;
  let high = passages.length - 1;
  let found = -1;
  // The last passage starting at or before `at`.
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((passages[middle] as Passage).from <= at) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const passage = passages[found];
  return passage && at <= passage.to ? passage : undefined;
}

/** A quote that wants a speaker: where it is, its words, and, if it carries on someone, who and whom its tag names. */
export type Wanting = {
  from: number;
  to: number;
  text: string;
  carried?: { speaker: string; tag: string };
};

/**
 * Every quote that wants a speaker, in order: one no one is marked to say, which the narrator
 * reads with the words around it; or one that carries on the speech before it on its line (§5.6)
 * while its own dialogue tag names someone else (`@Ann “Hi,” said Ann. “Bye,” said Bob.`).
 */
export function wantingQuotes(story: Story): Wanting[] {
  const found: Wanting[] = [];
  for (const quote of quotesOf(story)) {
    if (quote.narrated) {
      found.push({ from: quote.from, to: quote.to, text: quote.text });
      continue;
    }
    if (!quote.continued) continue;
    const tag = taggedName(story, quote);
    const named = tag ? (castMemberNamed(story, tag) ?? tag) : undefined;
    if (tag && named && named.toLowerCase() !== quote.speaker.toLowerCase())
      found.push({
        from: quote.from,
        to: quote.to,
        text: quote.text,
        carried: { speaker: quote.speaker, tag: named },
      });
  }
  return found;
}

/** The next of them after `after`, round to the first. */
export function nextWanting(wanting: readonly Wanting[], after: number): Wanting | undefined {
  return wanting.find((quote) => quote.from > after) ?? wanting[0];
}
