/** Opt-in keyboard assistance. All layout remains presentation; edits are plain Fountain. */
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { type EditorState, type Extension, Prec, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { parsedSource } from "./syntax";
import { insertScreenplayParagraph } from "./writing";

function caretLine(state: EditorState) {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty)
    return null;
  return state.doc.lineAt(state.selection.main.head);
}

function safeContext(state: EditorState, from: number, to: number) {
  // The worker may be behind the current text. Its immutable-document cache can be
  // reused, but stale results must never determine whether a passage is private.
  const parsed = parsedSource(state.doc);
  if (parsed.warnings.length || parsed.omissions.some((span) => span.from <= to && span.to > from))
    return null;
  return parsed;
}

/** A newly typed natural cue has no following dialogue yet, so Fountain still
 * calls it action. Recognize only a short, unforced uppercase boundary line for
 * keyboard assistance; never rewrite it or change the parser's interpretation.
 */
function pendingCue(state: EditorState, number: number): boolean {
  if (number < 1) return false;
  const line = state.doc.line(number);
  const text = line.text.trim();
  if (number > 1 && state.doc.line(number - 1).text.trim()) return false;
  if (text.length > 120 || !/\p{Lu}/u.test(text)) return false;
  return /^[\p{Lu}\p{M}\p{N} .’'_-]+(?:\s*\([^()\n]*\))?\s*\^?$/u.test(text);
}

function insertLineBreak(target: Parameters<StateCommand>[0], position: number): boolean {
  const { state, dispatch } = target;
  dispatch(
    state.update({
      changes: { from: position, insert: "\n" },
      selection: { anchor: position + 1 },
      scrollIntoView: true,
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    }),
  );
  return true;
}

/** Scenes, action, dialogue and transitions end paragraphs. Character cues and
 * parentheticals continue dialogue. A pending uppercase cue stays plain Fountain.
 * Paired parentheticals accept Enter immediately before their closing bracket.
 * Structural/private elements and mid-line edits retain normal editor behavior.
 */
export const screenplayEnter: StateCommand = (target) => {
  const { state, dispatch } = target;
  const line = caretLine(state);
  if (!line || !line.text.trim()) return false;
  const head = state.selection.main.head;
  const beforeClose = head === line.to - 1 && line.text.endsWith(")");
  if (head !== line.to && !beforeClose) return false;
  // Explicit source-only elements should never acquire screenplay keyboard behavior.
  if (/^\s*(?:\\|#|=|~|\[\[|\/\*)/.test(line.text)) return false;
  const parsed = safeContext(state, line.from, line.to);
  const element = parsed?.elements[line.number - 1];
  if (!element) return false;
  if (beforeClose && element.kind !== "parenthetical") return false;
  if (element.kind === "parenthetical" && element.text === "()") {
    // Enter on an unused parenthetical returns to the dialogue line rather than
    // splitting the pair into two broken Fountain elements.
    const from = line.from + line.text.indexOf("(");
    dispatch(
      state.update({
        changes: { from, to: from + 2 },
        selection: { anchor: from },
        scrollIntoView: true,
        userEvent: "input",
        annotations: isolateHistory.of("full"),
      }),
    );
    return true;
  }
  if (element.kind === "character" || element.kind === "parenthetical") {
    if (!element.text.trim()) return false;
    return insertLineBreak(target, line.to);
  }
  if (element.kind === "action" && pendingCue(state, line.number)) {
    return insertLineBreak(target, line.to);
  }
  if (["scene", "action", "dialogue", "transition", "centered"].includes(element.kind)) {
    return insertScreenplayParagraph(target);
  }
  return false;
};

/** Shift-Enter deliberately keeps a line in the same block, including dialogue.
 * It also leaves a paired parenthetical intact when the caret precedes its `)`.
 */
export const screenplayLineBreak: StateCommand = (target) => {
  const { state } = target;
  const line = caretLine(state);
  if (!line || !line.text.trim()) return false;
  const parsed = safeContext(state, line.from, line.to);
  const element = parsed?.elements[line.number - 1];
  if (!element || !["action", "dialogue", "character", "parenthetical"].includes(element.kind))
    return false;
  const head = state.selection.main.head;
  if (head === line.to) return insertLineBreak(target, head);
  if (element.kind === "parenthetical" && head === line.to - 1 && line.text.endsWith(")"))
    return insertLineBreak(target, line.to);
  return false;
};

/** Cycle only empty templates. Text with any user content is never reformatted.
 * Blank → @ → INT. → ! → > → blank. Within dialogue, () comes first.
 * Parentheticals require a preceding cue/dialogue. Non-boundary scenes use .INT.
 * Shift-Tab follows the reverse order. No whitespace indentation is inserted.
 */
function cycleElement(direction: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const line = caretLine(state);
    if (!line) return false;
    // Whitespace-only lines can carry deliberate Fountain dialogue continuation;
    // leave those alone. Only exact templates created here are eligible.
    const candidates = ["", "@", "()", "INT. ", ".INT. ", "!", ">"];
    if (!candidates.includes(line.text)) return false;
    const head = state.selection.main.head;
    if (head !== line.to && !(line.text === "()" && head === line.from + 1)) return false;
    const parsed = safeContext(state, line.from, line.to);
    if (!parsed) return false;
    const previous = parsed.elements[line.number - 2];
    // A blank line after title metadata is the separator, not a screenplay element.
    if (previous?.kind === "title") return false;
    const inDialogue =
      previous?.kind === "character" ||
      previous?.kind === "dialogue" ||
      previous?.kind === "parenthetical" ||
      (previous?.kind === "action" && pendingCue(state, line.number - 1));
    const boundary = line.number === 1 || !state.doc.line(line.number - 1).text.trim();
    const scene = boundary ? "INT. " : ".INT. ";
    const templates = inDialogue ? ["", "()", "!", "@", scene, ">"] : ["", "@", scene, "!", ">"];
    const current = /^\.?INT\. $/.test(line.text) ? scene : line.text;
    const index = templates.indexOf(current);
    if (index < 0) return false;
    const insert = templates[(index + direction + templates.length) % templates.length] ?? "";
    const changes = state.changes({ from: line.from, to: line.to, insert });
    const after = parsedSource(changes.apply(state.doc));
    if (
      after.warnings.length ||
      after.omissions.length !== parsed.omissions.length ||
      parsed.omissions.some((span, position) => {
        const next = after.omissions[position];
        return (
          next?.kind !== span.kind ||
          next.from !== changes.mapPos(span.from, 1) ||
          next.to !== changes.mapPos(span.to, -1)
        );
      })
    )
      return false;
    dispatch(
      state.update({
        changes,
        selection: { anchor: line.from + (insert === "()" ? 1 : insert.length) },
        scrollIntoView: true,
        userEvent: "input.format",
        annotations: isolateHistory.of("full"),
      }),
    );
    return true;
  };
}

export const screenplayNextElement = cycleElement(1);
export const screenplayPreviousElement = cycleElement(-1);

/** Add/remove through a Compartment controlled by an opt-in preference.
 * High precedence runs before default Enter. Completion menus and IME keep their
 * own keys; unsupported contexts fall through to normal editor/browser behavior.
 * Paste, input events and ordinary typing are never intercepted.
 */
export function screenplayKeymap(): Extension {
  return Prec.high(
    keymap.of(
      [
        { key: "Enter", command: screenplayEnter },
        { key: "Shift-Enter", command: screenplayLineBreak },
        { key: "Tab", command: screenplayNextElement },
        { key: "Shift-Tab", command: screenplayPreviousElement },
      ].map(({ key, command }) => ({
        key,
        run: (view) => {
          if (view.composing) return false;
          if (completionStatus(view.state) === "active") {
            if (key !== "Tab") return false;
            // Keep focus in the manuscript even during CodeMirror's brief
            // completion-opening guard. Tab must not escape an active suggestion.
            acceptCompletion(view);
            return true;
          }
          // A pending completion request may resolve to no suggestions. It must
          // not make fast typing fall back to different paragraph behavior.
          return command(view);
        },
      })),
    ),
  );
}
