import { EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { completions } from "./complete";
import { type PreviewOptions, livePreview, setShowMarks, showMarksField } from "./decorations";
import { lineJoin, markEnter, noteEnter, quoteBackspace, quoteEnter, smartQuotes } from "./quotes";
import { scriptTheme } from "./theme";

/**
 * The script editor: CodeMirror 6 extensions that show an Audiobook Markup story as it reads, with
 * the raw marks only where you type, and suggest names, directions, sounds and instructions.
 * Hosts add their own keymaps, gutters and save buttons around it.
 */
export type ScriptEditorOptions = PreviewOptions;

/**
 * Typing over a selection (1082, review r4): the browser would replace it itself, and across lines
 * it reads the chips' labels inside back as words. The editor replaces the selection instead,
 * through the same typing aids as any keystroke (curly quotes and the rest).
 */
/** Words cut from between others leave one space, not two (review r11). */
const tidyCut = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("delete.cut")) return tr;
  const extra: Array<{ from: number; to: number }> = [];
  tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    if (inserted.length) return;
    const around = tr.newDoc.sliceString(fromB - 1, fromB + 1);
    if (around === "  ") extra.push({ from: fromB, to: fromB + 1 });
    // A cut ending a sentence leaves no space before its stop (review r12): "flipped ."
    else if (
      /^ [.,;:!?…]$/u.test(around) &&
      /\S/u.test(tr.newDoc.sliceString(fromB - 2, fromB - 1))
    )
      extra.push({ from: fromB - 1, to: fromB });
  });
  return extra.length ? [tr, { changes: extra, sequential: true }] : tr;
});

const typeOverSelection = EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (view.state.readOnly || event.inputType !== "insertText" || !event.data) return false;
    const { ranges, main } = view.state.selection;
    if (main.empty || ranges.length > 1) return false;
    event.preventDefault();
    const text = event.data;
    const insert = () =>
      view.state.update(view.state.replaceSelection(text), {
        userEvent: "input.type",
        scrollIntoView: true,
      });
    for (const handler of view.state.facet(EditorView.inputHandler))
      if (handler(view, main.from, main.to, text, insert)) return true;
    view.dispatch(insert());
    return true;
  },
});

export function scriptEditor(options: ScriptEditorOptions): Extension {
  return [
    scriptTheme,
    EditorView.lineWrapping,
    typeOverSelection,
    tidyCut,
    livePreview(options),
    completions(options.characters),
    ...(options.smartQuotes === false
      ? []
      : [
          smartQuotes(),
          Prec.high(noteEnter),
          Prec.high(markEnter),
          Prec.high(quoteEnter),
          Prec.high(quoteBackspace),
          Prec.high(lineJoin),
        ]),
    Prec.low(
      keymap.of([
        {
          key: "Mod-Shift-m",
          run: (view) => {
            view.dispatch({ effects: setShowMarks.of(!view.state.field(showMarksField)) });
            return true;
          },
        },
      ]),
    ),
  ];
}

export { scriptTheme } from "./theme";
export {
  type Character,
  type PreviewOptions,
  type ViewSwitches,
  holdOpen,
  livePreview,
  marksField,
  openField,
  sceneNumbers,
  setShowMarks,
  setView,
  showMarksField,
  viewField,
} from "./decorations";
export { completions } from "./complete";
export type { PageTurnTools, ReadAloud } from "./widgets";
export { readSceneName, sceneNameChange, spokenName } from "./scene-names";
export { smartQuotes } from "./quotes";
export { type EditorMark, editDistance, editorMarks } from "./marks";
export { startCompletion } from "@codemirror/autocomplete";
