import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
  closeBrackets,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Character } from "./decorations";
import { marksField } from "./decorations";

/**
 * Suggestions while typing marks: `@` offers the cast, `(` after a name offers the directions this
 * story already uses, `[` offers its sounds, and `{` offers page turns, pauses and what's printed.
 */
function dot(color?: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "vxd-option-dot";
  el.style.background = color ?? "currentColor";
  if (!color) el.style.opacity = "0.35";
  return el;
}

const INSTRUCTIONS: Array<{ label: string; detail: string }> = [
  { label: "page", detail: "a page turn" },
  { label: "pause", detail: "a beat" },
  { label: "pause 1s", detail: "a pause of one second" },
  { label: "book only", detail: "printed, not read aloud" },
  { label: "audio only", detail: "read aloud, not printed" },
  { label: "hidden", detail: "a label for tools" },
];

/**
 * Picking a direction, sound or instruction finishes the mark: its closing bracket (unless one
 * is there already, as `( [ {` close themselves before a space) and a space before the words that
 * follow, so `{book only}` typed in front of a line reads `{book only} Bread was fine.`
 */
function closing(label: string, closer: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const next = view.state.sliceDoc(to, to + 1);
    const closed = next === closer;
    const after = view.state.sliceDoc(to + (closed ? 1 : 0), to + (closed ? 2 : 1));
    // Words or a quote follow a mark, so it gets its space even at a line's end; only a real
    // space already there counts.
    const space = after === " " || after === "\t" ? "" : " ";
    const insert = closed ? label : `${label}${closer}${space}`;
    const changes =
      closed && space
        ? [
            { from, to, insert },
            { from: to + 1, insert: space },
          ]
        : [{ from, to, insert }];
    view.dispatch({
      changes,
      selection: { anchor: from + label.length + 1 + space.length },
      userEvent: "input.complete",
    });
  };
}

/**
 * The suggestions that really match what's typed: a word of the label starting with it, or (from
 * three letters) the label containing it. Never a loose fuzzy match, so Enter can't swap in an
 * unrelated sound or direction.
 */
function matching(typed: string, labels: readonly string[]): string[] {
  const t = typed.trim().toLowerCase();
  if (!t) return [...labels];
  return labels.filter((label) => {
    const l = label.toLowerCase();
    return l.split(/[\s;,]+/u).some((w) => w.startsWith(t)) || (t.length >= 3 && l.includes(t));
  });
}

/**
 * What was typed, offered first whenever it isn't a label already, so Enter finishes the mark as
 * typed and a longer existing label is a deliberate pick (↓, then Enter).
 */
function asTyped(typed: string, labels: readonly string[], closer: string): Completion[] {
  const t = typed.trim();
  if (!t || labels.some((l) => l.toLowerCase() === t.toLowerCase())) return [];
  return [{ label: t, detail: "as typed", type: "text", apply: closing(t, closer), boost: 99 }];
}

/** Where a picked name left the cursor after its space, in each editor: a space typed there is had. */
const spacedAt = new WeakMap<EditorView, number>();

/** A name picked from the list is followed by a space, ready for `(how)` or the quote. */
function spaced(handle: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    // Only a real space counts as one: at a line's end the space is added, never the line break.
    const after = view.state.sliceDoc(to, to + 1);
    const insert = after === " " || after === "\t" ? handle : `${handle} `;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + handle.length + 1 },
      userEvent: "input.complete",
    });
    spacedAt.set(view, from + handle.length + 1);
  };
}

/** The space a writer types out of habit straight after a picked name, which already has one. */
const habitSpace = EditorView.inputHandler.of((view, from, to, text) => {
  const at = spacedAt.get(view);
  spacedAt.delete(view);
  return text === " " && from === to && from === at && view.state.sliceDoc(from - 1, from) === " ";
});

/** A group's direction ends its `:::` line: words already after it go to the next line. */
function groupDirection(label: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const line = view.state.doc.lineAt(to);
    const rest = view.state.sliceDoc(to, line.to);
    if (!rest.trim()) {
      view.dispatch({
        changes: { from, to, insert: label },
        selection: { anchor: from + label.length },
        userEvent: "input.complete",
      });
      return;
    }
    const lead = rest.length - rest.trimStart().length;
    view.dispatch({
      changes: { from, to: to + lead, insert: `${label}\n` },
      selection: { anchor: from + label.length + 1 },
      userEvent: "input.complete",
    });
  };
}

export function completions(characters: () => readonly Character[]): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const before = context.state.sliceDoc(Math.max(0, context.pos - 200), context.pos);

    const name = /(^|[^\p{L}\p{N}\\])@([\p{L}][\p{L}\p{M}\p{N}_'’-]*)?$/u.exec(before);
    if (name) {
      const typed = name[2] ?? "";
      const from = context.pos - typed.length;
      return {
        from,
        // The cast, then names the story uses that aren't in it yet (but not the name being
        // typed, which is one of those until it's finished).
        options: characters()
          .filter((c) => !c.provisional || c.handle.toLowerCase() !== typed.toLowerCase())
          .map(
            (c): Completion => ({
              label: c.handle,
              ...(c.provisional
                ? { detail: "not in the cast", boost: -1 }
                : c.name !== c.handle
                  ? { detail: c.name }
                  : {}),
              type: "variable",
              apply: spaced(c.handle),
            }),
          ),
        validFor: /^[\p{L}\p{M}\p{N}_'’-]*$/u,
      };
    }

    const direction = /@(?:[\p{L}][\p{L}\p{M}\p{N}_'’-]*\s*)?\(([^()]*)$/u.exec(before);
    if (direction) {
      const typed = direction[1] ?? "";
      const used = new Map<string, number>();
      // The direction being typed is not a suggestion for itself.
      for (const mark of context.state.field(marksField, false) ?? [])
        if (
          mark.kind === "direction" &&
          mark.text &&
          !(mark.from <= context.pos && context.pos <= mark.to)
        )
          used.set(mark.text, (used.get(mark.text) ?? 0) + 1);
      if (!used.size) return null;
      const fits = new Set(matching(typed, [...used.keys()]));
      if (!fits.size) return null;
      return {
        from: context.pos - typed.length,
        filter: false,
        options: [
          ...asTyped(typed, [...fits], ")"),
          ...[...used.entries()]
            .filter(([label]) => fits.has(label))
            .sort((a, b) => b[1] - a[1])
            .map(
              ([label, n]): Completion => ({
                label,
                ...(n > 1 ? { detail: `used ${n}×` } : {}),
                type: "text",
                apply: closing(label, ")"),
              }),
            ),
        ],
      };
    }

    // A group's direction: `::: whispering`, `::: @Rupert grandly`.
    const line = context.state.doc.lineAt(context.pos);
    const groupHead = /^:::[ \t]*(?:@\p{L}[\p{L}\p{M}\p{N}_'’-]*[ \t]+)?([^:]*)$/u.exec(
      line.text.slice(0, context.pos - line.from),
    );
    if (groupHead) {
      const typed = groupHead[1] ?? "";
      const used = new Map<string, number>();
      for (const mark of context.state.field(marksField, false) ?? [])
        if (mark.kind === "direction" && mark.text)
          used.set(mark.text, (used.get(mark.text) ?? 0) + 1);
      const fits = matching(typed, [...used.keys()]);
      if (
        !fits.length ||
        (!typed &&
          !context.explicit &&
          !/[ \t]$/u.test(line.text.slice(0, context.pos - line.from)))
      )
        return null;
      return {
        from: context.pos - typed.length,
        filter: false,
        options: fits.map((label) => ({ label, type: "text", apply: groupDirection(label) })),
      };
    }

    const sound = /(^|[^\\!])\[([^\]]*)$/u.exec(before);
    if (sound) {
      const typed = sound[2] ?? "";
      const used = new Set<string>();
      for (const mark of context.state.field(marksField, false) ?? [])
        if (
          (mark.kind === "sound" || mark.kind === "vocal") &&
          !(mark.from <= context.pos && context.pos <= mark.to)
        )
          used.add(mark.text);
      if (!used.size || (!typed && !context.explicit)) return null;
      const fits = matching(typed, [...used]);
      if (!fits.length) return null;
      return {
        from: context.pos - typed.length,
        options: [
          ...asTyped(typed, fits, "]"),
          ...fits.map((label) => ({
            label,
            type: "constant",
            apply: closing(label, "]"),
          })),
        ],
        filter: false,
      };
    }

    const instruction = /(^|[^\\])\{([^}]*)$/u.exec(before);
    if (instruction) {
      const typed = instruction[2] ?? "";
      return {
        from: context.pos - typed.length,
        options: INSTRUCTIONS.map((i) => ({
          label: i.label,
          detail: i.detail,
          type: "keyword",
          apply: closing(i.label, "}"),
        })),
        validFor: /^[^}]*$/u,
      };
    }
    return null;
  };

  return [
    habitSpace,
    // ( [ { close themselves; quotes are left to smart quotes.
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{"] } }]),
    closeBrackets(),
    autocompletion({
      override: [source],
      icons: false,
      addToOptions: [
        {
          render: (completion) => {
            const person = characters().find((c) => c.handle === completion.label);
            return person ? dot(person.color) : null;
          },
          position: 20,
        },
      ],
    }),
  ];
}
