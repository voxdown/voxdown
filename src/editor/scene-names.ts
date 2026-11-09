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
    .replace(/[\s.!?…"”’)]+$/u, "")
    .trim()
    .toLowerCase();

/** A scene's number as a line says it: "Scene 2". */
const NUMBERED = /^scene \d+$/u;

/**
 * The line reading a scene's name aloud, after the mark ending at `markEnd` (owner, 9 Nov): the
 * next paragraph, one line of its own, saying the name's words (`{audio only}` before them, typed
 * by hand, too). `stale` when it says another scene's number (the scene's changed since), or an
 * `{audio only}` line says something else.
 */
export function spokenName(
  state: EditorState,
  markEnd: number,
  name: string,
): { from: number; to: number; said: string; stale: boolean } | null {
  const doc = state.doc;
  let n = doc.lineAt(markEnd).number + 1;
  while (n <= doc.lines && !doc.line(n).text.trim()) n++;
  if (n > doc.lines) return null;
  // A paragraph that goes on is the story's, not the name's.
  if (n < doc.lines && doc.line(n + 1).text.trim()) return null;
  const line = doc.line(n);
  const heard = /^\s*\{audio only\}\s*(\S.*?)\s*$/u.exec(line.text);
  const said = heard ? (heard[1] ?? "") : line.text.trim();
  const same = asSaid(said) === asSaid(name);
  const renumbered = NUMBERED.test(asSaid(said)) && NUMBERED.test(asSaid(name));
  if (!heard && !same && !renumbered) return null;
  return { from: line.from, to: line.to, said, stale: !same };
}

/** A name as a line says it: its marks escaped, ending in a full stop unless it has its own. */
const sayName = (name: string) => {
  const words = name.trim().replace(/([\\[\]{}])/gu, "\\$1");
  return /[.!?…]["”’)]*$/u.test(words) ? words : `${words}.`;
};

/**
 * The speaker's edit (owner, 9 Nov): reading the scene's name aloud after the mark at `at`, or
 * no longer; a line saying an old name (`stale`) says the scene's name now instead.
 */
export function sceneNameChange(state: EditorState, at: number, name: string) {
  const line = state.doc.lineAt(at);
  const said = spokenName(state, line.to, name);
  const words = sayName(name);
  if (said?.stale) return { from: said.from, to: said.to, insert: words };
  if (said) return { from: line.to, to: said.to, insert: "" };
  return { from: line.to, to: line.to, insert: `\n\n${words}` };
}

/** Reads the scene's name aloud, or no longer (the speaker on its mark). */
export function readSceneName(view: EditorView, at: number, name: string) {
  const change = sceneNameChange(view.state, at, name);
  view.dispatch({ changes: change, userEvent: change.insert ? "input" : "delete" });
}
