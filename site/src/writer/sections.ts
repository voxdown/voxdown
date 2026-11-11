/**
 * Scenes and chapters moved whole: a scene from its heading or scene break to the next one, a
 * chapter from its heading to the next chapter's. The one the cursor is in changes places with the
 * one before or after it, the blank lines between them kept as they were; the cursor goes with it.
 * What comes before the first (the front matter, a title) stays where it is.
 */
import { EditorSelection, type EditorState, Text, type TransactionSpec } from "@codemirror/state";

/**
 * The change that moves the section the cursor is in past the one before (-1) or after (1), or
 * null where there is none to move past. `starts` are where the sections start, in order.
 */
export function moveSection(
  state: EditorState,
  starts: readonly number[],
  by: 1 | -1,
): TransactionSpec | null {
  const doc = state.doc;
  const head = state.selection.main.head;
  let index = -1;
  for (const [i, start] of starts.entries()) if (start <= head) index = i;
  const other = index + by;
  if (index < 0 || other < 0 || other >= starts.length) return null;
  const first = Math.min(index, other);
  const from = starts[first] as number;
  const middle = starts[first + 1] as number;
  const to = starts[first + 2] ?? doc.length;
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
