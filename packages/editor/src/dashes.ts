/**
 * Dashes as a writer types them: two hyphens an en dash (–), three an em dash (—), as
 * typographers write them. The hyphen that makes one is turned as it is typed (the second makes
 * `–`, a third makes it `—`), and Backspace straight after gives the hyphens back, as autocorrect
 * does. Never where hyphens are the format's own or a reader's: a line of hyphens alone (a scene
 * break, the edge of the front matter), the front matter, a sound's label, an instruction, a
 * link's address, a web address.
 *
 * With the curly quotes, one switch: `setSmartPunctuation`.
 */
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/** Whether typing makes quotes curly and hyphens dashes: on unless the writer turns it off. */
export const setSmartPunctuation = StateEffect.define<boolean>();
export const smartPunctuationField = StateField.define<boolean>({
  create: () => true,
  update: (on, tr) => {
    for (const effect of tr.effects) if (effect.is(setSmartPunctuation)) return effect.value;
    return on;
  },
});
/** Whether the state types punctuation smartly (true where the field isn't there). */
export const smartPunctuation = (state: EditorState) =>
  state.field(smartPunctuationField, false) !== false;

/** The dash just made, and the hyphens it was: Backspace straight after gives them back. */
const made = StateEffect.define<{ at: number; hyphens: string }>();
const lastDash = StateField.define<{ at: number; hyphens: string } | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(made)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/** Whether `at` is in the front matter, or in one still being written (nothing closes it yet). */
function inFrontMatter(state: EditorState, at: number): boolean {
  const head = state.sliceDoc(0, Math.min(state.doc.length, 65_536));
  if (!/^﻿?---[ \t]*\r?\n/.test(head)) return false;
  const close = /\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(head.slice(3));
  return !close || at <= 3 + close.index + close[0].length;
}

/** Whether the line so far is inside a sound's label: a `[` it hasn't closed. */
function inLabel(head: string): boolean {
  let inside = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === "\\") i++;
    else if (c === "[") inside = true;
    else if (c === "]") inside = false;
  }
  return inside;
}

/** The dash a hyphen typed at `at` makes, if it makes one. */
export function dashFor(
  state: EditorState,
  at: number,
): { from: number; insert: string; hyphens: string } | undefined {
  const line = state.doc.lineAt(at);
  const head = line.text.slice(0, at - line.from);
  const before = head.at(-1);
  if (before !== "-" && before !== "–") return undefined;
  // A line of hyphens alone, so far: a scene break, or the edge of the front matter.
  if (/^[\s\-–—]*$/u.test(head)) return undefined;
  // A hyphen escaped (`\-`) is the writer's own.
  if (head.at(-2) === "\\") return undefined;
  if (inFrontMatter(state, at)) return undefined;
  if (
    inLabel(head) ||
    /\{[^{}]*$/u.test(head) ||
    /\]\([^)]*$/u.test(head) ||
    /(?:^|\s)\S*(?::\/\/|www\.)\S*$/u.test(head)
  )
    return undefined;
  return before === "-"
    ? { from: at - 1, insert: "–", hyphens: "--" }
    : { from: at - 1, insert: "—", hyphens: "---" };
}

const dashInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "-" || from !== to || view.state.readOnly || !smartPunctuation(view.state))
    return false;
  const dash = dashFor(view.state, from);
  if (!dash) return false;
  view.dispatch({
    changes: { from: dash.from, to: from, insert: dash.insert },
    selection: { anchor: dash.from + 1 },
    effects: made.of({ at: dash.from + 1, hyphens: dash.hyphens }),
    userEvent: "input.type",
  });
  return true;
});

const dashBack = keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const last = view.state.field(lastDash, false);
      const { main } = view.state.selection;
      if (!last || !main.empty || main.head !== last.at) return false;
      view.dispatch({
        changes: { from: last.at - 1, to: last.at, insert: last.hyphens },
        selection: { anchor: last.at - 1 + last.hyphens.length },
        userEvent: "delete.backward",
      });
      return true;
    },
  },
]);

export function smartDashes(): Extension {
  return [lastDash, dashInput, dashBack];
}
