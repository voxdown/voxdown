/**
 * Scenes and chapters moved whole: a scene from its heading or scene break to the next one, or to
 * the next chapter's heading; a chapter from its heading to the next chapter's. The one the cursor
 * is in changes places with the one before or after it, the blank lines between them kept as they
 * were, and the cursor goes with it. A scene stays in its chapter: the chapter's heading, and what
 * comes before the first (the front matter, a title, a chapter's opening words), stay where they are.
 */
import { EditorSelection, type EditorState, Text, type TransactionSpec } from "@codemirror/state";

/** Why nothing moved: the cursor isn't in one, or there is none on that side to move past. */
export type Unmoved = "outside" | "edge";

/**
 * The change that moves the section the cursor is in past the one before (-1) or after (1).
 * `starts` are where the sections start, in order; `walls` where they can't go past (a scene,
 * the chapters' headings), each also ending the section before it.
 */
export function moveSection(
  state: EditorState,
  starts: readonly number[],
  by: 1 | -1,
  walls: readonly number[] = [],
): TransactionSpec | Unmoved {
  const doc = state.doc;
  const head = state.selection.main.head;
  // Where each section ends: the next one's start, or the wall before it, or the story's end.
  const ends = starts.map((start, i) =>
    Math.min(starts[i + 1] ?? doc.length, walls.find((wall) => wall > start) ?? doc.length),
  );
  let index = -1;
  for (const [i, start] of starts.entries()) if (start <= head) index = i;
  if (index < 0 || head > (ends[index] as number) || (head === ends[index] && head !== doc.length))
    return "outside";
  const other = index + by;
  const first = Math.min(index, other);
  // The other side must touch it: no wall (a chapter's heading) between the two.
  if (other < 0 || other >= starts.length || ends[first] !== starts[first + 1]) return "edge";
  const from = starts[first] as number;
  const middle = starts[first + 1] as number;
  const to = ends[first + 1] as number;
  const a = doc.sliceString(from, middle);
  const b = doc.sliceString(middle, to);
  // Each without the blank lines after it: A's gap stays between the two, B's after both.
  const aCore = a.replace(/\s+$/, "");
  const bCore = b.replace(/\s+$/, "");
  const gapA = a.slice(aCore.length) || "\n\n";
  const gapB = b.slice(bCore.length);
  const moved = `${bCore}${gapA}${aCore}${gapB}`;
  // The cursor stays at its place in its own section.
  const cursor =
    index === first ? from + bCore.length + gapA.length + (head - from) : from + (head - middle);
  return {
    changes: { from, to, insert: Text.of(moved.split("\n")) },
    selection: EditorSelection.cursor(Math.min(cursor, from + moved.length)),
  };
}
