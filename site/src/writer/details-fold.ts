/**
 * The story's details (its front matter: title, author, cast) folded into one line as a story
 * opens: "Story details: The Owl, 3 in the cast". The writer's words come first; the details are
 * a click, or the cursor, away. The cursor going into them (Ctrl+Home, the arrows, a click on the
 * line) unfolds them for as long as the story is open; nothing in the text changes.
 */
import { EditorState, type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** The details shown or folded. */
const unfold = StateEffect.define<null>();

/** Where the front matter runs, from its first `---` to the end of its last, as the parser finds it. */
export function detailsRange(doc: Text): { from: number; to: number } | null {
  if (doc.lines < 3 || doc.line(1).text.replace(/^﻿/, "").trimEnd() !== "---") return null;
  for (let number = 2; number <= Math.min(doc.lines, 400); number++) {
    const line = doc.line(number);
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line.text)) return { from: 0, to: line.to };
  }
  return null;
}

/** What the folded line says: the title and how many are in the cast. */
export function detailsSummary(yaml: string): string {
  const title = /^title:[ \t]*["']?(.*?)["']?[ \t]*$/m.exec(yaml)?.[1]?.trim();
  const cast = /^cast:[ \t]*\n((?:[ \t]+.*\n?|\n)*)/m.exec(yaml)?.[1] ?? "";
  const indent = /^([ \t]+)\S/m.exec(cast)?.[1]?.length ?? 2;
  const members = cast
    .split("\n")
    .filter((line) => new RegExp(`^[ \\t]{${indent}}[^\\s#-][^:]*:`).test(line)).length;
  return [title ? `“${title}”` : "", members ? `${members} in the cast` : ""]
    .filter(Boolean)
    .join(", ");
}

class DetailsLine extends WidgetType {
  constructor(readonly summary: string) {
    super();
  }
  eq(other: DetailsLine): boolean {
    return other.summary === this.summary;
  }
  toDOM(view: EditorView): HTMLElement {
    const line = document.createElement("div");
    line.className = "story-details";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-details-open";
    button.textContent = `Story details${this.summary ? `: ${this.summary}` : ""}`;
    button.title = "Show the story's details: its title, author and cast";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      // The cursor on the details' first line: shown, and there to write.
      const at = Math.min(
        view.state.doc.length,
        view.state.doc.line(Math.min(2, view.state.doc.lines)).to,
      );
      view.dispatch({ selection: { anchor: at }, effects: unfold.of(null) });
      view.focus();
    });
    line.append(button);
    return line;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** Whether the details are folded: as the story opens, until the cursor goes into them. */
const folded = StateField.define<boolean>({
  create: () => true,
  update: (value, tr) => (tr.effects.some((effect) => effect.is(unfold)) ? false : value),
});

function decorationsFor(state: EditorState): DecorationSet {
  if (!state.field(folded)) return Decoration.none;
  const range = detailsRange(state.doc);
  if (!range) return Decoration.none;
  const summary = detailsSummary(state.doc.sliceString(range.from, range.to));
  return Decoration.set(
    Decoration.replace({ widget: new DetailsLine(summary), block: true }).range(
      range.from,
      range.to,
    ),
  );
}

const foldedLine = StateField.define<DecorationSet>({
  create: decorationsFor,
  update: (value, tr) =>
    tr.docChanged || tr.effects.some((effect) => effect.is(unfold))
      ? decorationsFor(tr.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

/** The cursor going into the details unfolds them. */
const unfoldOnEntry = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection || !tr.startState.field(folded, false)) return null;
  const range = detailsRange(tr.newDoc);
  if (!range) return null;
  const inside = tr.selection.ranges.some((each) => each.from <= range.to);
  return inside ? { effects: unfold.of(null) } : null;
});

export function detailsFold(): Extension {
  return [folded, foldedLine, unfoldOnEntry];
}
