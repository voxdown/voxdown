import {
  type EditorState,
  MapMode,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * A scene's name read aloud (owner, 9 Nov): the speaker on a scene break or heading writes it as
 * an ordinary line of its own after the mark, `Scene 2.`, and takes it out again. Read aloud, it
 * is printed too, so no `{audio only}`.
 */

/** The speaker wrote (a name) or took out (null) a scene's name, after the mark at `at`. */
const nameRead = StateEffect.define<{ at: number; name: string | null }>();

/**
 * The names each scene's speaker wrote, by where its mark starts (review r19): a heading renamed
 * before Apply is still known by the name its line says.
 */
export const readNamesField = StateField.define<ReadonlyArray<{ at: number; name: string }>>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged)
      next = value.flatMap((r) => {
        const at = tr.changes.mapPos(r.at, 1, MapMode.TrackDel);
        return at === null ? [] : [{ at, name: r.name }];
      });
    for (const e of tr.effects)
      if (e.is(nameRead)) {
        next = next.filter((r) => r.at !== e.value.at);
        if (e.value.name) next = [...next, { at: e.value.at, name: e.value.name }];
      }
    return next;
  },
});

/** The name the speaker last wrote for the scene whose mark starts at `from`, if it did. */
export function nameReadAt(state: EditorState, from: number): string | undefined {
  return state.field(readNamesField, false)?.find((r) => r.at === from)?.name;
}

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
export function sceneNameChange(
  state: EditorState,
  at: number,
  name: string,
  was?: string,
): { from: number; to: number; insert: string } | null {
  const line = state.doc.lineAt(at);
  const said = spokenName(state, line.to, name, was);
  const words = sayName(name);
  if (said?.stale) {
    const text = state.sliceDoc(said.from, said.to);
    const lead = LEADING.exec(text)?.[0].length ?? 0;
    // The spoken words alone, up to the first mark after them: a sound, a note or a pause on
    // the line stays (review r19), as its speaker and direction do.
    const rest = text.slice(lead);
    let end = new RegExp(MARKS.source, "u").exec(rest)?.index ?? rest.length;
    while (end > 0 && /\s/u.test(rest[end - 1] ?? "")) end--;
    if (/[“"]$/u.test(text.slice(0, lead)) && /[”"]$/u.test(rest.slice(0, end))) end--;
    const spoken = rest.slice(0, end);
    // An old number: just the number changes.
    const number = /\d+/u.exec(name)?.[0];
    const old = /\d+/u.exec(spoken);
    const change =
      number && old && renumbering(said.said, name)
        ? {
            from: said.from + lead + old.index,
            to: said.from + lead + old.index + old[0].length,
            insert: number,
          }
        : { from: said.from + lead, to: said.from + lead + end, insert: words };
    // Read back: the line says the name now, or nothing is changed.
    const after = state.update({ changes: change }).state;
    const back = spokenName(after, line.to, name, was);
    return back && !back.stale ? change : null;
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
  const spec = readSceneNameSpec(view.state, at, name, was);
  if (spec) view.dispatch(spec);
}

/** The speaker's press as a transaction, remembering the name it wrote; null when it can't. */
export function readSceneNameSpec(
  state: EditorState,
  at: number,
  name: string,
  was?: string,
): TransactionSpec | null {
  const change = sceneNameChange(state, at, name, was);
  if (!change) return null;
  return {
    changes: change,
    effects: nameRead.of({ at: state.doc.lineAt(at).from, name: change.insert ? name : null }),
    userEvent: change.insert ? "input" : "delete",
  };
}
