/**
 * A change with no selection of its own maps the old one, and a range inside a span the change
 * rewrote maps to one with its ends crossed (CodeMirror maps its start forward and its end
 * back): the status said "-134 characters selected" and the next key replaced all between them.
 * Such a range becomes a caret at the earlier end (round 8), whatever command made the change.
 */
import { EditorSelection, EditorState } from "@codemirror/state";

export const noCrossedRanges = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || transaction.selection) return transaction;
  const mapped = transaction.newSelection;
  if (mapped.ranges.every((range) => range.from <= range.to)) return transaction;
  return [
    transaction,
    {
      selection: EditorSelection.create(
        mapped.ranges.map((range) =>
          range.from <= range.to
            ? range
            : EditorSelection.cursor(Math.min(range.from, range.to, transaction.newDoc.length)),
        ),
        mapped.mainIndex,
      ),
      sequential: true,
    },
  ];
});
