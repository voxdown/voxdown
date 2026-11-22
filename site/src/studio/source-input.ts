import type { Transaction } from "@codemirror/state";
import { MAX_LINES, MAX_SOURCE } from "./source";

/** Validate an editor change before it can become an unreopenable recovery copy. */
export function sourceEditProblem(transaction: Transaction): string | undefined {
  if (!transaction.docChanged) return;
  if (transaction.newDoc.length > MAX_SOURCE || transaction.newDoc.lines > MAX_LINES)
    return "This draft has reached the 500,000-character or 20,000-line limit. Download it and continue in a new file.";
  let containsNul = false;
  // Inspect only new text, so ordinary typing does not rescan a large screenplay.
  transaction.changes.iterChanges((_from, _to, _newFrom, _newTo, inserted) => {
    for (const part of inserted.iter()) {
      if (part.includes("\0")) {
        containsNul = true;
        break;
      }
    }
  });
  if (containsNul)
    return "This edit contains a NUL character, which Studio cannot reopen. Nothing was changed. Remove that character from the text you are inserting and try again.";
}
