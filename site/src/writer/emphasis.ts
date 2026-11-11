/**
 * Emphasis as it is written (§11): `*words*` and `_words_` in italics, `**words**` and `__words__`
 * in bold, their signs faint; and Ctrl+I and Ctrl+B to put the signs in or take them out. Read one
 * line at a time, only where the page shows, so a long book costs no more than a short one.
 */
import { EditorSelection, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** A stretch of emphasis in a line: where it starts and ends, signs included, and how wide they are. */
export type Emphasis = { from: number; to: number; sign: number; strong: boolean };

// Bold first, so that `**words**` isn't read as italics twice. A sign after a backslash is text;
// `_` within a word (a name such as `@Big_Bad_Wolf`, an address) is no emphasis.
const STRONG =
  /(?<!\\)(?:\*\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*\*|(?<![\w_])__(?=[^\s_])(.+?)(?<=[^\s\\_])__(?![\w_]))/gu;
const EM =
  /(?<![\\*])\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*(?!\*)|(?<![\\\w_])_(?=[^\s_])(.+?)(?<=[^\s\\_])_(?![\w_])/gu;

export function emphasisIn(line: string): Emphasis[] {
  const found: Emphasis[] = [];
  let rest = line;
  for (const match of line.matchAll(STRONG)) {
    found.push({ from: match.index, to: match.index + match[0].length, sign: 2, strong: true });
    // The bold signs are read no further: blanked out, the italics in between are still found.
    const end = match.index + match[0].length;
    rest = `${rest.slice(0, match.index)}\0\0${rest.slice(match.index + 2, end - 2)}\0\0${rest.slice(end)}`;
  }
  for (const match of rest.matchAll(EM))
    found.push({ from: match.index, to: match.index + match[0].length, sign: 1, strong: false });
  return found.sort((a, b) => a.from - b.from);
}

const em = Decoration.mark({ class: "vxd-em" });
const strong = Decoration.mark({ class: "vxd-strong" });
const sign = Decoration.mark({ class: "vxd-em-sign" });

/**
 * Where the front matter ends, read from the text itself: drawing happens while the page updates,
 * when nothing else may be asked of it. A front matter never closed is read as none.
 */
export function frontMatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return 0;
  for (let number = 2; number <= Math.min(doc.lines, 2000); number++) {
    const text = doc.line(number).text.trimEnd();
    if (text === "---" || text === "...") return doc.line(number).to;
  }
  return 0;
}

function draw(view: EditorView): DecorationSet {
  const { state } = view;
  const start = frontMatterEnd(state);
  const marks = [];
  for (const { from, to } of view.visibleRanges) {
    let at = Math.max(from, start);
    while (at <= to) {
      const line = state.doc.lineAt(at);
      if (/[*_]/.test(line.text)) {
        for (const found of emphasisIn(line.text)) {
          const a = line.from + found.from;
          const b = line.from + found.to;
          marks.push(
            sign.range(a, a + found.sign),
            (found.strong ? strong : em).range(a + found.sign, b - found.sign),
            sign.range(b - found.sign, b),
          );
        }
      }
      at = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

/** Emphasis drawn, after the front matter. */
export function emphasis(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = draw(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = draw(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Italics (`*`) or bold (`**`) put around the selection, or the word at the cursor, or taken away
 * where they are already; with no word at the cursor, the signs go in with the cursor between.
 */
export function toggleEmphasis(
  strongly: boolean,
  /** Why the signs can't go around `from`–`to` (inside a mark), if they can't. */
  refuse?: (state: EditorState, from: number, to: number) => string | undefined,
  /** Says why nothing was done. */
  tell?: (message: string) => void,
) {
  return (view: EditorView): boolean => {
    const { state } = view;
    if (state.readOnly) return true;
    // Each range as it would be wrapped: a cursor stands for its word.
    for (const range of state.selection.ranges) {
      const word = range.empty ? state.wordAt(range.from) : null;
      const why = refuse?.(state, word?.from ?? range.from, word?.to ?? range.to);
      if (why) {
        tell?.(why);
        return true;
      }
    }
    const width = strongly ? 2 : 1;
    const signs = strongly ? ["**", "__"] : ["*", "_"];
    // How many of a sign's characters run right before `at` (back) or right after it.
    const run = (at: number, back: boolean, char: string) => {
      let count = 0;
      while (count < 3) {
        const from = back ? at - count - 1 : at + count;
        if (from < 0 || state.sliceDoc(from, from + 1) !== char) break;
        count++;
      }
      return count;
    };
    // Bold has two signs or more on each side, italics one or three.
    const has = (count: number) => (strongly ? count >= 2 : count % 2 === 1);
    view.dispatch(
      state.changeByRange((range) => {
        let { from, to } = range;
        if (from === to) {
          const word = state.wordAt(from);
          if (word) ({ from, to } = word);
        }
        for (const written of signs) {
          const char = written[0] as string;
          // The signs just outside the words: taken away.
          if (has(run(from, true, char)) && has(run(to, false, char)))
            return {
              changes: [
                { from: from - width, to: from },
                { from: to, to: to + width },
              ],
              range: EditorSelection.range(range.anchor - width, range.head - width),
            };
          // The signs selected with the words: taken away too.
          if (
            to - from > 2 * width &&
            state.sliceDoc(from, from + width) === written &&
            state.sliceDoc(to - width, to) === written
          )
            return {
              changes: [
                { from, to: from + width },
                { from: to - width, to },
              ],
              range: EditorSelection.range(from, to - 2 * width),
            };
        }
        const written = signs[0] as string;
        return {
          changes: [
            { from, insert: written },
            { from: to, insert: written },
          ],
          range:
            range.empty && from === to
              ? EditorSelection.cursor(from + width)
              : EditorSelection.range(range.anchor + width, range.head + width),
        };
      }),
      { userEvent: "input.format" },
    );
    return true;
  };
}

/** Text without its emphasis signs: `*very*` is `very`, for a spreadsheet or a speech engine. */
export function plainText(text: string): string {
  const signs = new Set<number>();
  for (const found of emphasisIn(text))
    for (let i = 0; i < found.sign; i++) {
      signs.add(found.from + i);
      signs.add(found.to - 1 - i);
    }
  // Places count UTF-16 units, as the text's own indices do.
  return text
    .split("")
    .filter((_, index) => !signs.has(index))
    .join("");
}
