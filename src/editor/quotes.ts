import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Typographer's quotes as you type: `"` opens with “ after a space, a line's start or an opening
 * bracket, and closes with ” anywhere else; `'` is an apostrophe ’ after a letter, and opens with ‘
 * after a space. Undo straight after brings back the straight mark.
 */
const OPENS_AFTER = /[\s([{—–\-“‘]$/u;

export function smartQuotes(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '"' && text !== "'") return false;
    if (view.state.readOnly) return false;
    const before = view.state.sliceDoc(Math.max(0, from - 1), from);
    const opening = from === 0 || before === "" || OPENS_AFTER.test(before);
    const insert = text === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.type",
    });
    return true;
  });
}
