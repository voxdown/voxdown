import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Typographer's quotes as you type: `"` opens with “ after a space, a line's start or an opening
 * bracket, and closes with ” anywhere else; `'` is an apostrophe ’ after a letter, and opens with ‘
 * after a space. Undo straight after brings back the straight mark.
 */
const OPENS_AFTER = /[\s([{—–\-]$/u;

/**
 * Pasted words get the apostrophes typing would give them (it's → it’s). Only an apostrophe
 * between two letters: quotes and measurements (6'2") are left as pasted.
 */
const pastedApostrophes = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.paste")) return tr;
  let found = false;
  const specs: Array<{ from: number; to: number; insert: string }> = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    // A sound's label keeps its marks as written: `[Knight's armor]` is the
    // same sound, its audio kept.
    const line = tr.startState.doc.lineAt(fromA);
    const startsInside = inLabel(line.text.slice(0, fromA - line.from));
    const curly = outsideLabels(text, startsInside, curlQuotes);
    if (curly !== text) found = true;
    specs.push({ from: fromA, to: toA, insert: curly });
  });
  if (!found) return tr;
  // Same length, so the selection and everything after stay where they were.
  return {
    changes: specs,
    selection: tr.selection,
    scrollIntoView: tr.scrollIntoView,
    userEvent: "input.paste",
  };
});

/** Straight quotes and apostrophes in pasted words, as typing would give them. */
function curlQuotes(text: string): string {
  // Straight double quotes too: one opening where a quote opens (a line's start,
  // after a space, a bracket or a dash), else closing; pairs on the same line only.
  return (
    text
      .replace(/(?<=\p{L})'(?=\p{L})/gu, "’")
      .replace(/(^|[\s([{—–-])"/gmu, "$1“")
      .replace(/"/gu, "”")
      // A word cut short at its start ('Twas, 'n', 'em) keeps an apostrophe.
      .replace(
        /(^|[\s([{—–-])'(?=(?:twas|tis|em|n|cause|til|round|bout|ere)(?![\p{L}])|\d)/gimu,
        "$1’",
      )
      .replace(/(^|[\s([{—–-])'/gmu, "$1‘")
      .replace(/'/gu, "’")
  );
}

/** Whether a line's text up to here leaves a sound's `[` open. */
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

/** `change` applied to the text outside sounds' labels (`[…]`, on one line) only. */
function outsideLabels(text: string, startsInside: boolean, change: (part: string) => string) {
  let out = "";
  let part = "";
  let inside = startsInside;
  const flush = () => {
    out += inside ? part : change(part);
    part = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\\") {
      part += c + (text[i + 1] ?? "");
      i++;
    } else if (!inside && c === "[") {
      flush();
      inside = true;
      part = c;
    } else if (inside && (c === "]" || c === "\n")) {
      part += c;
      out += part;
      part = "";
      inside = false;
    } else part += c;
  }
  flush();
  return out;
}

export function smartQuotes(): Extension {
  return [pastedApostrophes, smartQuoteInput];
}

/** A word cut short at its start ('Twas, 'n', 'em, '90s): its mark is an apostrophe. */
const ELIDED = /(^|[\s([{—–-])‘((?:twas|tis|em|n|cause|til|round|bout|ere)|\d+s?)$/iu;

const smartQuoteInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.readOnly) return false;
  // Typed, the ‘ came before the word was known: once the word ends it becomes ’.
  if (/^[\s,.;:!?'’]$/u.test(text) && from === to) {
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const elided = ELIDED.exec(before);
    if (elided) {
      const mark = from - (elided[2] ?? "").length - 1;
      view.dispatch({
        changes: [
          { from: mark, to: mark + 1, insert: "’" },
          { from, to, insert: text === "'" ? "’" : text },
        ],
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      return true;
    }
  }
  if (text === "%") return closeNote(view, from, to);
  if (/^\d$/u.test(text) && pauseLength(view, from, to, text)) return true;
  if (text === " " && leavePause(view, from, to)) return true;
  if (text === " ") return noteSpace(view, from, to);
  if (text !== '"' && text !== "'") return false;
  // In a sound's label a mark stays as typed: the label names the same sound.
  {
    const line = view.state.doc.lineAt(from);
    if (inLabel(line.text.slice(0, from - line.from))) return false;
  }
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

/**
 * A length typed straight after a finished `{pause}` is its length: `{pause} 1` becomes
 * `{pause 1}`, the cursor inside, so `{pau` ⏎ `1s` gives `{pause 1s}`.
 */
function pauseLength(view: EditorView, from: number, to: number, digit: string): boolean {
  if (from !== to) return false;
  const before = view.state.sliceDoc(Math.max(0, from - 12), from);
  const m = /\{pause\}([ \t]*)$/iu.exec(before);
  if (!m) return false;
  const close = from - 1 - (m[1] ?? "").length;
  view.dispatch({
    changes: { from: close, to: from, insert: ` ${digit}}` },
    selection: { anchor: close + 1 + digit.length },
    userEvent: "input.type",
  });
  return true;
}

/** A space after a pause's length leaves the pause: `{pause 1s|}` ␣ gives `{pause 1s} |`. */
function leavePause(view: EditorView, from: number, to: number): boolean {
  if (from !== to || view.state.sliceDoc(from, from + 1) !== "}") return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  if (!/\{pause \d+(?:\.\d*)?\s*(?:ms|s)?$/iu.test(before)) return false;
  const spaced = view.state.sliceDoc(from + 1, from + 2) === " ";
  view.dispatch({
    ...(spaced ? {} : { changes: { from: from + 1, insert: " " } }),
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  return true;
}

/** The second `%` of a note's opening `%%` closes the note too: `%% | %%`, cursor inside. */
function closeNote(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  // `%` typed just before a note's own ` %%`: it closes the note, keeping the space.
  if (after.startsWith(" %%") && (before.match(/%%/gu) ?? []).length % 2 === 1) {
    // A space typed after the last word already sits before the closing ` %%`: drop it.
    if (before.endsWith(" ") && !/%% $/u.test(before)) {
      view.dispatch({
        changes: { from: from - 1, to: from },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      return true;
    }
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

/**
 * Inside a note that closed itself: right after the opening `%% ` the space is there already, so
 * a space typed there isn't doubled. Anywhere else a space is a space between the note's words
 * (`%`, or Enter at the end, leaves the note).
 */
function noteSpace(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  if (!/^ %%/u.test(after) || (before.match(/%%/gu) ?? []).length % 2 !== 1) return false;
  return /%% $/u.test(before);
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
      // Enter on a split's empty new line (`@Rupert “` and nothing yet) ends the speech there,
      // as Enter on an empty list item ends a list: a new paragraph follows, so two
      // Enters after a quote make one, as they do anywhere else.
      if (!tail.trim() && /^@\p{L}[\p{L}\p{M}\p{N}_'’-]*[ \t]*(\([^()]*\))?[ \t]*“$/u.test(head)) {
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: "\n" },
          selection: { anchor: line.from + 1 },
          userEvent: "delete",
        });
        return true;
      }
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
/** Prose on both sides: words, not a group's `:::`, a heading, a break or a note's line. */
const PROSE = /^(?!\s*(?::{3}|#{1,6}\s|-{3,}|\*{3,}|%%)).*[\p{L}\p{N}]/u;

/**
 * Two lines of words joined with Backspace at the start of the second (or Delete at the end of
 * the first) keep a space between them: "throne," + "sat" is "throne, sat".
 */
export const lineJoin = keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      if (from !== line.from || line.number === 1) return false;
      const above = view.state.doc.line(line.number - 1);
      if (!PROSE.test(above.text) || !PROSE.test(line.text) || /\s$/u.test(above.text))
        return false;
      view.dispatch({
        changes: { from: above.to, to: line.from, insert: " " },
        selection: { anchor: above.to + 1 },
        userEvent: "delete.backward",
      });
      return true;
    },
  },
  {
    key: "Delete",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      if (from !== line.to || line.number === view.state.doc.lines) return false;
      const below = view.state.doc.line(line.number + 1);
      if (!PROSE.test(line.text) || !PROSE.test(below.text) || /\s$/u.test(line.text)) return false;
      view.dispatch({
        changes: { from: line.to, to: below.from, insert: " " },
        selection: { anchor: line.to },
        userEvent: "delete.forward",
      });
      return true;
    },
  },
]);

/** The instructions a `{` can hold, by name. */
const INSTRUCTION_NAMES = ["page", "pause", "book only", "audio only", "hidden"];

export const markEnter = keymap.of([{ key: "Enter", run: (view) => markEnterRun(view) }]);

function markEnterRun(view: EditorView): boolean {
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
  // An instruction is one of a few words: the start of only one of them is that one, even
  // before the suggestions appear (`{pau` ⏎ is `{pause}`).
  if (open.char === "{") {
    const typed = head.slice(open.at + 1);
    const word = typed.trim().toLowerCase();
    const only = INSTRUCTION_NAMES.filter((n) => n.startsWith(word));
    if (word && /^[\p{L} ]+$/u.test(word) && only.length === 1 && only[0] !== word) {
      const full = only[0] as string;
      const start = line.from + open.at + 1;
      view.dispatch({
        changes: { from: start, to: from, insert: full },
        selection: { anchor: start + full.length },
        userEvent: "input.complete",
      });
      return markEnterRun(view);
    }
  }
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
}
