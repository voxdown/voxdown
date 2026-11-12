/**
 * An edit to one passage of a long book, worked out on its paragraph alone: the paragraph and the
 * story's front matter (for the cast) read as a story of their own, the core's edit made there,
 * and its changes moved back to where they belong. Reading a 120,000-word book again for each
 * speaker given took half a second; a paragraph takes a moment.
 *
 * Only a paragraph that stands alone is read so: not in a group (`:::`), not in a note left open,
 * no quote running into it or out of it. Otherwise the whole story is read, as for a short one.
 */
import { type Story, type TextChange, parse, quotesOf } from "voxdown";

/** The story an edit is worked out on, and how its places map to the editor's. */
export type Scope = {
  story: Story;
  /** A place in the editor's text, in the scope's. */
  at(place: number): number;
  /** A place in the scope's text, in the editor's. */
  toDoc(place: number): number;
  /** The scope's changes, as changes to the editor's text. */
  back(changes: readonly TextChange[]): TextChange[];
};

/** The whole story as the scope. */
export function wholeScope(story: Story): Scope {
  return {
    story,
    at: (place) => place,
    toDoc: (place) => place,
    back: (changes) => [...changes],
  };
}

/** Whether a paragraph has words a quote could run over to: not only page turns, pauses or notes (§5.7). */
const hasWords = (paragraph: string) =>
  /[\p{L}\p{N}]/u.test(paragraph.replace(/\{[^}]*\}|%%[\s\S]*?%%/g, ""));

/**
 * The last paragraph between `start` and `end` with words in it, found walking back: a long book's
 * paragraphs aren't all split out for one.
 */
function previousWithWords(source: string, start: number, end: number): string | undefined {
  let to = end;
  while (to > start) {
    while (to > start && source[to - 1] === "\n") to--;
    if (to <= start) return undefined;
    const gap = source.lastIndexOf("\n\n", to - 1);
    const from = gap < start ? start : gap + 2;
    const paragraph = source.slice(from, to);
    if (hasWords(paragraph)) return paragraph;
    to = from;
  }
  return undefined;
}

/** Whether the text, read as a story with the front matter, leaves a quote open at its end (§5.7). */
function leavesOpen(head: string, text: string): boolean {
  const story = parse(`${head}${head ? "\n" : ""}${text}\n`);
  return quotesOf(story).some((quote) => !quote.closed);
}

/** The paragraph at `place` with the front matter, as a scope of its own; undefined if it doesn't stand alone. */
export function paragraphScope(source: string, place: number, until = place): Scope | undefined {
  const front = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(source)?.[0] ?? "";
  if (place < front.length) return undefined;
  const before = source.lastIndexOf("\n\n", place - 1);
  const from = before < front.length ? front.length : before + 2;
  // To the paragraph `until` is in: a selection over several, read as one stretch.
  const after = source.indexOf("\n\n", Math.max(place, until));
  const to = after < 0 ? source.length : after;
  const paragraph = source.slice(from, to);
  const earlier = source.slice(front.length, from);
  // In a group, or a note, that is still open here: the whole story says what holds.
  if ((earlier.match(/^:::/gm)?.length ?? 0) % 2 === 1 || /^:::/m.test(paragraph)) return undefined;
  if (
    (earlier.match(/%%/g)?.length ?? 0) % 2 === 1 ||
    (paragraph.match(/%%/g)?.length ?? 0) % 2 === 1
  )
    return undefined;
  const head = front && !front.endsWith("\n") ? `${front}\n` : front;
  // A quote running on into the next paragraph, or over from the last one with words in it
  // (page turns, pauses and notes between are passed over, §5.7), as the format reads quotes:
  // single ones too.
  if (leavesOpen(head, paragraph)) return undefined;
  const previous = previousWithWords(source, front.length, from);
  if (previous !== undefined && leavesOpen(head, previous)) return undefined;
  const start = head ? head.length + 1 : 0;
  const text = `${head}${head ? "\n" : ""}${paragraph}\n`;
  const offset = from - start;
  return {
    story: parse(text),
    // Before the paragraph: outside the scope (mapped on, a place a little before it fell in the
    // front matter, and a selection over the paragraph before was read as this one alone).
    at: (at) => (at < from ? -1 : at - offset),
    toDoc: (at) => (at < start ? at : at + offset),
    back: (changes) =>
      changes.map((change) => {
        // From the front matter into the paragraph: what lies between them in the story isn't
        // here to be put back. Never written wrong: the edit is refused.
        if (change.from < start && change.to > start)
          throw new Error("That can’t be changed here at once: change the words in two steps.");
        return change.from < start
          ? { ...change }
          : { from: change.from + offset, to: change.to + offset, insert: change.insert };
      }),
  };
}
