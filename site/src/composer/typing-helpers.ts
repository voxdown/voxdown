/**
 * The typing helpers (Edit › Typing helpers, off by default): a bar line on Space when the bar is
 * full, and the nearest octave for a typed note. Each writes what was typed first, then its change
 * as a separate undo step, so undo goes back to exactly what was typed. Loaded when one is on.
 */
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { fileIndexField } from "./editor";
import { barIsFull, nearestOctave } from "./helpers";

export type HelperContext = {
  prefs: { barOnSpace: boolean; autoOctave: boolean };
  notice: (message: string) => void;
  shortcutLabel: (shortcut: string) => string;
};

let lastOctave: { at: number; typed: string; written: string } | null = null;
function helperOnce(context: HelperContext, key: string, message: string) {
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* Without storage it may be said again next visit. */
  }
  context.notice(message);
}

/** What was typed, helped: true when a helper wrote it. */
export function helpTyping(
  context: HelperContext,
  target: EditorView,
  from: number,
  to: number,
  typed: string,
): boolean {
  if (target.composing || target.compositionStarted) return false;
  const state = target.state;
  if (state.selection.ranges.length !== 1 || from !== to || !state.selection.main.empty)
    return false;
  const doc = state.doc.toString();
  const file = state.field(fileIndexField);
  // A field name typed at the start of a line ("C:") keeps the letter as it was typed.
  if (typed === ":" && lastOctave && lastOctave.at + lastOctave.written.length === from) {
    const line = state.doc.lineAt(lastOctave.at);
    if (line.from === lastOctave.at) {
      target.dispatch({
        changes: { from: lastOctave.at, to: from, insert: `${lastOctave.typed}:` },
        selection: { anchor: lastOctave.at + 2 },
        userEvent: "input.type",
      });
      lastOctave = null;
      return true;
    }
  }
  lastOctave = null;
  if (typed === " " && context.prefs.barOnSpace && barIsFull(doc, from, file)) {
    target.dispatch({
      changes: { from, insert: " " },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
    });
    target.dispatch({
      changes: { from: from + 1, insert: "| " },
      selection: { anchor: from + 3 },
      userEvent: "input.helper",
      annotations: isolateHistory.of("full"),
    });
    helperOnce(
      context,
      "vxd-composer-helper-bar",
      `The bar was full, so Space wrote a bar line. Undo (${context.shortcutLabel("Mod Z")}) takes it back; Edit › Typing helpers turns this off.`,
    );
    return true;
  }
  if (context.prefs.autoOctave && /^[A-Ga-g]$/.test(typed)) {
    const written = nearestOctave(doc, from, typed, file);
    if (!written || written === typed) return false;
    target.dispatch({
      changes: { from, insert: typed },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
    });
    target.dispatch({
      changes: { from, to: from + 1, insert: written },
      selection: { anchor: from + written.length },
      userEvent: "input.helper",
      annotations: isolateHistory.of("full"),
    });
    lastOctave = { at: from, typed, written };
    helperOnce(
      context,
      "vxd-composer-helper-octave",
      `${typed} became ${written}, the octave nearest the note before, whatever the case you type. Type ' or , after a note to move it an octave. Undo keeps what you typed; Edit › Typing helpers turns this off.`,
    );
    return true;
  }
  return false;
}
