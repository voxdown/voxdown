/**
 * Changes to a text, worked with: two sets made one after the other as one, and where a place
 * moves to once they are made.
 */
import { ChangeSet } from "@codemirror/state";
import type { TextChange } from "voxdown";

/**
 * Two sets of changes made one after the other, as one set on the text before both: the second's
 * places are in the text the first makes.
 */
export function composed(
  source: string,
  first: readonly TextChange[],
  second: readonly TextChange[],
): TextChange[] {
  const a = ChangeSet.of(
    first.map(({ from, to, insert }) => ({ from, to, insert })),
    source.length,
  );
  const b = ChangeSet.of(
    second.map(({ from, to, insert }) => ({ from, to, insert })),
    a.newLength,
  );
  const out: TextChange[] = [];
  a.compose(b).iterChanges((from, to, _fromB, _toB, inserted) => {
    out.push({ from, to, insert: inserted.toString() });
  });
  return out;
}

/** Where `at` is once the changes are made: moved by those before it. */
export function mapped(changes: readonly TextChange[], at: number): number {
  let shift = 0;
  for (const change of [...changes].sort((a, b) => a.from - b.from)) {
    if (change.to <= at) shift += change.insert.length - (change.to - change.from);
    else if (change.from < at) return change.from + shift + change.insert.length;
  }
  return at + shift;
}
