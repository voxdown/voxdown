/**
 * An edit to one passage of a long book, worked out on its paragraph alone: the paragraph and the
 * story's front matter (for the cast) read as a story of their own, the core's edit made there,
 * and its changes moved back to where they belong. Reading a 120,000-word book again for each
 * speaker given took half a second; a paragraph takes a moment.
 *
 * Only a paragraph that stands alone is read so: not in a group (`:::`), not in a note left open,
 * no quote running into it or out of it. Otherwise the whole story is read, as for a short one.
 */
import { type Story, type TextChange, parse } from "voxdown";

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

/**
 * Whether a stretch of text may leave a quote open, or close one opened before it: its quotation
 * marks don't pair up. (Single quotes, which are apostrophes too, aren't counted.)
 */
function leavesOpen(text: string): boolean {
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0;
  const curly = /„/.test(text) ? count(/„/g) !== count(/[“”]/g) : count(/“/g) !== count(/”/g);
  return (
    curly || count(/«/g) !== count(/»/g) || count(/「/g) !== count(/」/g) || count(/"/g) % 2 === 1
  );
}

/** The paragraph at `place` with the front matter, as a scope of its own; undefined if it doesn't stand alone. */
export function paragraphScope(source: string, place: number): Scope | undefined {
  const front = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(source)?.[0] ?? "";
  if (place < front.length) return undefined;
  const before = source.lastIndexOf("\n\n", place - 1);
  const from = before < front.length ? front.length : before + 2;
  const after = source.indexOf("\n\n", place);
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
  // A quote running over from the paragraph before, or on into the next (§5.7).
  const kept = earlier.replace(/\n+$/, "");
  const previous = kept.slice(kept.lastIndexOf("\n\n") + 1);
  if (leavesOpen(paragraph) || leavesOpen(previous)) return undefined;
  const head = front && !front.endsWith("\n") ? `${front}\n` : front;
  const start = head ? head.length + 1 : 0;
  const text = `${head}${head ? "\n" : ""}${paragraph}\n`;
  const offset = from - start;
  return {
    story: parse(text),
    at: (at) => at - offset,
    toDoc: (at) => (at < start ? at : at + offset),
    back: (changes) =>
      changes.map((change) =>
        change.from < start
          ? { ...change }
          : { from: change.from + offset, to: change.to + offset, insert: change.insert },
      ),
  };
}
