import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
  closeBrackets,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Character } from "./decorations";
import { marksField } from "./decorations";

/**
 * Suggestions while typing marks: `@` offers the cast, `(` after a name offers the directions this
 * story already uses, `[` offers its sounds, and `{` offers page turns, pauses and what's printed.
 */
function dot(color?: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "am-option-dot";
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
    // A direction is always followed by words or a quote, so it gets its space even at a line's end.
    const space = (after === "" && closer !== ")") || /\s/u.test(after) ? "" : " ";
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

/** A name picked from the list is followed by a space, ready for `(how)` or the quote. */
function spaced(handle: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const after = view.state.sliceDoc(to, to + 1);
    const insert = /\s/u.test(after) ? handle : `${handle} `;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + handle.length + 1 },
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
        options: characters().map(
          (c): Completion => ({
            label: c.handle,
            ...(c.name !== c.handle ? { detail: c.name } : {}),
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
      for (const mark of context.state.field(marksField, false) ?? [])
        if (mark.kind === "direction" && mark.text)
          used.set(mark.text, (used.get(mark.text) ?? 0) + 1);
      if (!used.size) return null;
      return {
        from: context.pos - typed.length,
        options: [...used.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(
            ([label, n]): Completion => ({
              label,
              ...(n > 1 ? { detail: `used ${n}×` } : {}),
              type: "text",
              apply: closing(label, ")"),
            }),
          ),
        validFor: /^[^()]*$/u,
      };
    }

    const sound = /(^|[^\\!])\[([^\]]*)$/u.exec(before);
    if (sound) {
      const typed = sound[2] ?? "";
      const used = new Set<string>();
      for (const mark of context.state.field(marksField, false) ?? [])
        if (mark.kind === "sound" || mark.kind === "vocal") used.add(mark.text);
      if (!used.size || (!typed && !context.explicit)) return null;
      return {
        from: context.pos - typed.length,
        options: [...used].map((label) => ({
          label,
          type: "constant",
          apply: closing(label, "]"),
        })),
        validFor: /^[^\]]*$/u,
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
