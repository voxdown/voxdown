import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Typographer's quotes as you type: `"` opens with “ after a space, a line's start or an opening
 * bracket, and closes with ” anywhere else; `'` is an apostrophe ’ after a letter, and opens with ‘
 * after a space. Undo straight after brings back the straight mark.
 */
const OPENS_AFTER = /[\s([{—–\-]$/u;

export function smartQuotes(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (view.state.readOnly) return false;
    if (text === "%") return closeNote(view, from, to);
    if (text !== '"' && text !== "'") return false;
    const before = view.state.sliceDoc(Math.max(0, from - 1), from);
    // 6" and 5' are measurements, not quotes.
    if (/\d/u.test(before)) return false;
    // A quote inside the other kind opens (“‘…’”); straight after its own opener, it closes it.
    const nested = (text === '"' && before === "‘") || (text === "'" && before === "“");
    const opening = from === 0 || before === "" || OPENS_AFTER.test(before) || nested;
    const insert = text === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.type",
    });
    return true;
  });
}

/** The second `%` of a note's opening `%%` closes the note too, with the cursor inside it. */
function closeNote(view: EditorView, from: number, to: number): boolean {
  if (from !== to || view.state.sliceDoc(from - 1, from) !== "%") return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - 1 - line.from);
  const after = line.text.slice(from - line.from);
  if (before.endsWith("\\") || (before.match(/%%/gu) ?? []).length % 2 === 1) return false;
  if (after.includes("%%")) return false;
  view.dispatch({
    changes: { from, insert: "%  %%" },
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  return true;
}
