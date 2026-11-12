import { cursorLineDown, cursorLineUp, selectLineDown, selectLineUp } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { type Command, EditorView, keymap } from "@codemirror/view";

/**
 * The up and down arrows move from the caret, wherever the page was scrolled to. CodeMirror finds
 * the line above or below by where the caret is drawn; with the caret scrolled far off the page,
 * it found it on the page shown instead (the wheel scrolled away, ↓ went to what was in view, and
 * typing to where the caret was). Off the page, the caret is brought back into view first and
 * moved from there, as other editors do.
 */
export const caretFirst = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: fromCaret(cursorLineDown), shift: fromCaret(selectLineDown) },
    { key: "ArrowUp", run: fromCaret(cursorLineUp), shift: fromCaret(selectLineUp) },
  ]),
);

/** The move, from the caret: at once where it is on the page, else once it is back in view. */
function fromCaret(move: Command): Command {
  return (view) => {
    if (onPage(view)) return false;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
    });
    // Once the editor has drawn the caret's line where it is now shown.
    requestAnimationFrame(() => requestAnimationFrame(() => move(view)));
    return true;
  };
}

/** Whether the caret is on the part of the page that shows. */
function onPage(view: EditorView): boolean {
  const at = view.coordsAtPos(view.state.selection.main.head);
  if (!at) return false;
  const box = view.scrollDOM.getBoundingClientRect();
  return at.bottom > box.top && at.top < box.bottom;
}
