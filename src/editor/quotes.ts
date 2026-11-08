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
  // `%` typed just before a note's own ` %%`: it closes the note, keeping the space.
  if (after.startsWith(" %%") && (before.match(/%%/gu) ?? []).length % 2 === 1) {
    view.dispatch({ selection: { anchor: from + 2 }, userEvent: "input.type" });
    return true;
  }
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

/**
 * Enter inside a quote splits it: the quote closes, and the next line opens it again for the same
 * speaker and direction (`@Rupert “No toast.” ⏎ @Rupert “No bread either.”`). What a mark does
 * ends with its line, so a quote never runs on into the next one.
 */
export const quoteEnter = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      const head = line.text.slice(0, from - line.from);
      const tail = line.text.slice(from - line.from);
      const open = head.lastIndexOf("“");
      if (open < 0 || head.indexOf("”", open) >= 0 || head[open - 1] === "\\") return false;
      if (!/[\p{L}\p{N}]/u.test(head.slice(open + 1))) return false;
      const marks = [
        ...head
          .slice(0, open)
          .matchAll(/(?:^|[^\p{L}\p{N}\\])@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)[ \t]*(\([^()]*\))?/gu),
      ];
      const mark = marks[marks.length - 1];
      if (!mark) return false;
      const rest = tail.replace(/^[ \t]+/u, "");
      // Right before the closing mark the quote is finished: the new line goes after the whole
      // line, whatever follows the quote (a sound, "he said").
      if (rest.startsWith("”")) {
        view.dispatch({
          changes: { from: line.to, insert: "\n" },
          selection: { anchor: line.to + 1 },
          userEvent: "input",
        });
        return true;
      }
      const insert = `”\n@${mark[1]} ${mark[2] ? `${mark[2]} ` : ""}“`;
      view.dispatch({
        changes: { from, to: from + (tail.length - rest.length), insert },
        selection: { anchor: from + insert.length },
        userEvent: "input",
      });
      return true;
    },
  },
]);

/**
 * Backspace straight after a split quote's new `@Name “` joins the two lines back into one quote,
 * in one step (Enter's split undone by the key that undoes typing).
 */
export const quoteBackspace = keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      if (line.number < 2) return false;
      const head = line.text.slice(0, from - line.from);
      const opened = /^@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)[ \t]*(\([^()]*\))?[ \t]*“$/u.exec(head);
      if (!opened) return false;
      const prev = view.state.doc.line(line.number - 1);
      if (!prev.text.endsWith("”") || !prev.text.includes(`@${opened[1]}`)) return false;
      const before = prev.text.slice(-2, -1);
      const after = line.text.slice(from - line.from, from - line.from + 1);
      const space = /\s/u.test(before) || !after || /\s/u.test(after) ? "" : " ";
      view.dispatch({
        changes: { from: prev.to - 1, to: from, insert: space },
        selection: { anchor: prev.to - 1 + space.length },
        userEvent: "delete.backward",
      });
      return true;
    },
  },
]);

/** The closing mark for each mark opened on a line: `[` sounds, `{` instructions, `(` directions. */
const CLOSER: Record<string, string> = { "[": "]", "{": "}", "(": ")" };

/**
 * Enter inside a mark that isn't finished (`[hiccup`, `{pause 3s`, `@Rupert (softly`) closes it as
 * typed rather than breaking the line inside it. A suggestion picked from the list comes first.
 */
export const markEnter = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      const head = line.text.slice(0, from - line.from);
      // The innermost mark opened before the cursor and not closed.
      const stack: { char: string; at: number }[] = [];
      for (let i = 0; i < head.length; i++) {
        const c = head[i] as string;
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === "[" || c === "{") stack.push({ char: c, at: i });
        else if (c === "(" && /@[\p{L}\p{M}\p{N}_'’-]*[ \t]*$/u.test(head.slice(0, i)))
          stack.push({ char: c, at: i });
        else if ((c === "]" || c === "}" || c === ")") && stack.length) {
          const top = stack[stack.length - 1];
          if (top && CLOSER[top.char] === c) stack.pop();
        }
      }
      const open = stack[stack.length - 1];
      if (!open) return false;
      const closer = CLOSER[open.char] as string;
      if (!/\S/u.test(head.slice(open.at + 1))) return false;
      const next = line.text.slice(from - line.from, from - line.from + 1);
      const closed = next === closer;
      const after = line.text.slice(from - line.from + (closed ? 1 : 0)).slice(0, 1);
      const space = after === " " ? "" : " ";
      view.dispatch({
        changes: closed ? { from: from + 1, insert: space } : { from, insert: `${closer}${space}` },
        selection: { anchor: from + 1 + space.length },
        userEvent: "input",
      });
      return true;
    },
  },
]);
