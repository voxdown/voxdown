import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { completions } from "./complete";
import { type PreviewOptions, livePreview, setShowMarks, showMarksField } from "./decorations";
import { noteEnter, quoteEnter, smartQuotes } from "./quotes";
import { scriptTheme } from "./theme";

/**
 * The script editor: CodeMirror 6 extensions that show an Audiobook Markup story as it reads, with
 * the raw marks only where you type, and suggest names, directions, sounds and instructions.
 * Hosts add their own keymaps, gutters and save buttons around it.
 */
export type ScriptEditorOptions = PreviewOptions;

export function scriptEditor(options: ScriptEditorOptions): Extension {
  return [
    scriptTheme,
    EditorView.lineWrapping,
    livePreview(options),
    completions(options.characters),
    ...(options.smartQuotes === false
      ? []
      : [smartQuotes(), Prec.high(noteEnter), Prec.high(quoteEnter)]),
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
  livePreview,
  marksField,
  setShowMarks,
  showMarksField,
} from "./decorations";
export { completions } from "./complete";
export { smartQuotes } from "./quotes";
export { type EditorMark, editDistance, editorMarks } from "./marks";
