// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { scriptEditor, setSmartPunctuation } from "../src";

// Every editor made, closed after its test: nothing of one left to run once the page is gone.
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

/** An editor with `doc`, the cursor at its end (or at `|`), and the keys typed one by one. */
function typed(doc: string, keys: string, smart = true) {
  const at = doc.includes("|") ? doc.indexOf("|") : doc.length;
  const view = new EditorView({
    state: EditorState.create({
      doc: doc.replace("|", ""),
      selection: EditorSelection.cursor(at),
      extensions: scriptEditor({ characters: () => [] }),
    }),
    parent: document.body,
  });
  views.push(view);
  if (!smart) view.dispatch({ effects: setSmartPunctuation.of(false) });
  for (const key of keys) {
    const { from, to } = view.state.selection.main;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, from, to, key, () =>
          view.state.update({ changes: { from, to, insert: key } }),
        ),
      );
    if (!handled)
      view.dispatch({ changes: { from, to, insert: key }, selection: { anchor: from + 1 } });
  }
  return view;
}

const backspace = (view: EditorView) => {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
};

describe("dashes typed", () => {
  it("make two hyphens an en dash and three an em dash, as they are typed", () => {
    expect(typed("It was 1990", "--1995").state.doc.toString()).toBe("It was 1990–1995");
    expect(typed("I mean", "---no.").state.doc.toString()).toBe("I mean—no.");
  });

  it("give the hyphens back with Backspace straight after", () => {
    const view = typed("I mean", "---");
    expect(view.state.doc.toString()).toBe("I mean—");
    backspace(view);
    expect(view.state.doc.toString()).toBe("I mean---");
  });

  it("leave the format's hyphens as they are: a scene break, the front matter, a label", () => {
    expect(typed("One.\n\n", "---").state.doc.toString()).toBe("One.\n\n---");
    expect(typed("---\ntitle: A|\n---\n", "--B").state.doc.toString()).toBe(
      "---\ntitle: A--B\n---\n",
    );
    expect(typed("A [door", "--slam").state.doc.toString()).toBe("A [door--slam");
    expect(typed("See https://a.example/x", "--y").state.doc.toString()).toBe(
      "See https://a.example/x--y",
    );
  });

  it("are typed as hyphens with smart punctuation off", () => {
    expect(typed("I mean", "---no", false).state.doc.toString()).toBe("I mean---no");
  });
});
