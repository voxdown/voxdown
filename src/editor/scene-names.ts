import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * A scene's name read aloud (owner, 9 Nov): the speaker on a scene break or heading writes it as
 * an ordinary line of its own after the mark, `Scene 2.`, and takes it out again. Read aloud, it
 * is printed too, so no `{audio only}`.
 */

/** Words compared as said: escapes, closing punctuation and case aside. */
const asSaid = (text: string) =>
  text
    .replace(/\\(.)/gu, "$1")
    .replace(/[\s.!?…"”’)。！？」』]+$/u, "")
    .trim()
    .toLowerCase();

/** A scene's number as said, whatever the language: "scene #", "toneel #", "第#场". */
const shapeOf = (text: string) => asSaid(text).replace(/\d+/gu, "#");
/** Two names that are the same words around a different number: "Scene 2" and "Scene 3". */
const renumbering = (a: string, b: string) =>
  /\d/u.test(a) && /\d/u.test(b) && shapeOf(a) === shapeOf(b);

/**
 * Marks on a line that aren't its words (review r18): instructions, a speaker's name and its
 * `(how)`, a direction, a sound, a note. A name read aloud may carry any of them.
 */
const MARKS =
  /\{[^}\n]*\}|@\p{L}[\p{L}\p{M}\p{N}_'’-]*(?:[ \t]*\([^()\n]*\))?|@\([^()\n]*\)|\[[^\]\n]*\]|%%.*?%%/gu;
/** The marks at a line's start, kept when its words change. */
const LEADING = new RegExp(`^(?:[ \\t]*(?:${MARKS.source}))*[ \\t]*[“"]?`, "u");

/** A line's words, without its marks or quote marks. */
const wordsOf = (text: string) =>
  text.replace(MARKS, " ").replace(/[“”"]/gu, "").replace(/\s+/gu, " ").trim();

/**
 * The line reading a scene's name aloud, after the mark ending at `markEnd` (owner, 9 Nov): the
 * next paragraph, one line of its own, whose words are the name's (directed, given to someone,
 * or `{audio only}` typed by hand: its words are what count, review r18). `stale` when it says
 * another scene's number (the scene's changed since), the name the scene had (`was`, a heading
 * renamed), or an `{audio only}` line says something else.
 */
export function spokenName(
  state: EditorState,
  markEnd: number,
  name: string,
  was?: string,
): { from: number; to: number; said: string; stale: boolean } | null {
  const doc = state.doc;
  let n = doc.lineAt(markEnd).number + 1;
  while (n <= doc.lines && !doc.line(n).text.trim()) n++;
  if (n > doc.lines) return null;
  // A paragraph that goes on is the story's, not the name's.
  if (n < doc.lines && doc.line(n + 1).text.trim()) return null;
  const line = doc.line(n);
  const heard = /\{audio only\}/u.test(line.text);
  const said = wordsOf(line.text);
  if (!said) return null;
  const same = asSaid(said) === asSaid(name);
  const renamed = Boolean(was) && asSaid(said) === asSaid(was ?? "");
  if (!heard && !same && !renamed && !renumbering(said, name)) return null;
  return { from: line.from, to: line.to, said, stale: !same };
}

/**
 * A name as a line says it: its marks escaped, ending in a full stop unless it has its own (a
 * Chinese or Japanese one after those scripts, review r18).
 */
const sayName = (name: string) => {
  const words = name.trim().replace(/([\\[\]{}])/gu, "\\$1");
  if (/[.!?…。！？]["”’)」』]*$/u.test(words)) return words;
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(words)
    ? `${words}。`
    : `${words}.`;
};

/**
 * The speaker's edit (owner, 9 Nov): reading the scene's name aloud after the mark at `at`, or
 * no longer; a line saying an old name (`stale`) says the scene's name now instead, its marks
 * (a direction, a speaker) kept (review r18).
 */
export function sceneNameChange(state: EditorState, at: number, name: string, was?: string) {
  const line = state.doc.lineAt(at);
  const said = spokenName(state, line.to, name, was);
  const words = sayName(name);
  if (said?.stale) {
    const text = state.sliceDoc(said.from, said.to);
    const lead = LEADING.exec(text)?.[0].length ?? 0;
    // An old number: just the number changes.
    const number = /\d+/u.exec(name)?.[0];
    const old = /\d+/u.exec(text.slice(lead));
    if (number && old && renumbering(said.said, name)) {
      const from = said.from + lead + old.index;
      return { from, to: from + old[0].length, insert: number };
    }
    const quoted = /[“"]$/u.test(text.slice(0, lead));
    return {
      from: said.from + lead,
      to: said.to,
      insert: quoted ? `${words.replace(/[.!?…]$/u, "")}.”` : words,
    };
  }
  if (said) return { from: line.to, to: said.to, insert: "" };
  // Its own paragraph, whatever follows the mark: a blank line after it too (review r18).
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  return {
    from: line.to,
    to: line.to,
    insert: next?.text.trim() ? `\n\n${words}\n` : `\n\n${words}`,
  };
}

/** Reads the scene's name aloud, or no longer (the speaker on its mark). */
export function readSceneName(view: EditorView, at: number, name: string, was?: string) {
  const change = sceneNameChange(view.state, at, name, was);
  view.dispatch({ changes: change, userEvent: change.insert ? "input" : "delete" });
}
