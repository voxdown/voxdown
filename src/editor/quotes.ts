import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

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
    if (text === " ") return noteSpace(view, from, to);
    if (text !== '"' && text !== "'") return false;
    const before = view.state.sliceDoc(Math.max(0, from - 1), from);
    // 6" and 5' are measurements, not quotes.
    if (/\d/u.test(before)) return false;
    // A quote inside the other kind opens (“‘…’”); straight after its own opener, it closes it.
    const nested = (text === '"' && before === "‘") || (text === "'" && before === "“");
    // Straight after a name or its direction, a quote is the line it says: it opens.
    const line = view.state.doc.lineAt(from);
    const head = line.text.slice(0, from - line.from);
    const afterMark =
      text === '"' &&
      /(^|[^\p{L}\p{N}\\])@(?:\p{L}[\p{L}\p{M}\p{N}_'’-]*)?\s*(\([^()]*\))?\s*$/u.test(head);
    const opening = from === 0 || before === "" || OPENS_AFTER.test(before) || nested || afterMark;
    const insert = text === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.type",
    });
    return true;
  });
}

/** The second `%` of a note's opening `%%` closes the note too: `%% | %%`, cursor inside. */
function closeNote(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  // Typing the closing marks of a note that closed itself steps over them.
  if (
    after.startsWith("%") &&
    /%%/u.test(before) &&
    (before.match(/%%/gu) ?? []).length % 2 === 1
  ) {
    if (after.startsWith("%%") || before.endsWith("%")) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: "input.type" });
      return true;
    }
  }
  if (!before.endsWith("%")) return false;
  const opening = before.slice(0, -1);
  if (opening.endsWith("\\") || (opening.match(/%%/gu) ?? []).length % 2 === 1) return false;
  if (after.includes("%%")) return false;
  view.dispatch({
    changes: { from, insert: "%  %%" },
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  return true;
}

/** Inside a note that closed itself: a space before the closing ` %%` steps over it. */
function noteSpace(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  if (!/^ %%/u.test(after) || (before.match(/%%/gu) ?? []).length % 2 !== 1) return false;
  // Right after the opening `%% ` the space is there already; after the words it leads to the
  // closing marks, so the cursor steps over it.
  view.dispatch({
    selection: { anchor: /%% $/u.test(before) ? from : from + 1 },
    userEvent: "input.type",
  });
  return true;
}

/**
 * Enter at the end of a note's words leaves the note: the cursor goes past its closing `%%`
 * first, so the note stays on its line.
 */
export const noteEnter = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to) return false;
      const line = view.state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from);
      const after = line.text.slice(from - line.from);
      if (!/^\s*%%\s*$/u.test(after) || (before.match(/%%/gu) ?? []).length % 2 !== 1) return false;
      view.dispatch({
        changes: { from: line.to, insert: "\n" },
        selection: { anchor: line.to + 1 },
        userEvent: "input",
      });
      return true;
    },
  },
]);
