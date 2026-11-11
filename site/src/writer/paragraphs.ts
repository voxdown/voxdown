/**
 * Alt+↑ and Alt+↓ move the paragraph the cursor is in, or the paragraphs the selection touches,
 * past the one before or after it: a paragraph being the lines between blank lines. The front
 * matter stays where it is, and nothing moves above it.
 */
import { EditorSelection, type EditorState, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type Block = { from: number; to: number; first: number; last: number };

const blank = (doc: Text, number: number) => doc.line(number).text.trim() === "";

/** The lines of the paragraph holding line `number`, or null on a blank line. */
function paragraphAt(doc: Text, number: number): Block | null {
  if (blank(doc, number)) return null;
  let first = number;
  let last = number;
  while (first > 1 && !blank(doc, first - 1)) first--;
  while (last < doc.lines && !blank(doc, last + 1)) last++;
  return { first, last, from: doc.line(first).from, to: doc.line(last).to };
}

/** The first line after the front matter, if the story has any. */
function bodyLine(state: EditorState, frontMatterEnd: number | null): number {
  if (frontMatterEnd === null) return 1;
  return state.doc.lineAt(Math.min(frontMatterEnd, state.doc.length)).number + 1;
}

/**
 * Moves the paragraphs under the selection up (-1) or down (1). `frontMatterEnd` is where the
 * front matter ends, or null. True when the key is used, moved or not.
 */
export function moveParagraph(
  view: EditorView,
  direction: -1 | 1,
  frontMatterEnd: number | null,
): boolean {
  const { state } = view;
  const doc = state.doc;
  const { from, to, head, anchor } = state.selection.main;
  const top = paragraphAt(doc, doc.lineAt(from).number);
  const bottom = paragraphAt(doc, doc.lineAt(to).number);
  const start = top ?? bottom;
  const end = bottom ?? top;
  if (!start || !end) return true;
  const moving: Block = { first: start.first, last: end.last, from: start.from, to: end.to };
  const body = bodyLine(state, frontMatterEnd);
  if (moving.first < body) return true;
  // The paragraph to pass: the next one up or down, across the blank lines between.
  let other: Block | null = null;
  if (direction < 0) {
    let line = moving.first - 1;
    while (line >= body && blank(doc, line)) line--;
    if (line >= body) other = paragraphAt(doc, line);
  } else {
    let line = moving.last + 1;
    while (line <= doc.lines && blank(doc, line)) line++;
    if (line <= doc.lines) other = paragraphAt(doc, line);
  }
  if (!other || other.first < body) return true;
  const upper = direction < 0 ? other : moving;
  const lower = direction < 0 ? moving : other;
  const gap = doc.sliceString(upper.to, lower.from);
  const swapped =
    doc.sliceString(lower.from, lower.to) + gap + doc.sliceString(upper.from, upper.to);
  // The cursor and selection stay in the paragraph that moved: first in the new text going up,
  // after the other paragraph and the gap going down.
  const lead = direction < 0 ? 0 : lower.to - lower.from + gap.length;
  const moved = (at: number) => upper.from + lead + (at - moving.from);
  view.dispatch({
    changes: { from: upper.from, to: lower.to, insert: swapped },
    selection: EditorSelection.range(moved(anchor), moved(head)),
    scrollIntoView: true,
    userEvent: "move.line",
  });
  return true;
}
