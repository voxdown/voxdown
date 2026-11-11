// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { smartQuotes } from "../src/quotes";

/**
 * Types `typed` after `before` and ahead of `after`, a character at a time, through the editor's
 * input handlers.
 */
function type(before: string, typed: string, after = ""): string {
  const view = new EditorView({
    state: EditorState.create({ doc: before + after, extensions: smartQuotes() }),
    parent: document.body,
  });
  for (const char of typed) {
    const at = view.state.doc.length - after.length;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, at, at, char, () =>
          view.state.update({ changes: { from: at, insert: char } }),
        ),
      );
    if (!handled) view.dispatch({ changes: { from: at, insert: char } });
  }
  const text = view.state.doc.toString();
  view.destroy();
  return text;
}

describe("quotes typed", () => {
  it("open after a space, a name or a bracket, and close after a word or a dash", () => {
    expect(type("", `@Ann "Hi," she said. "Wait—" he said. (He said "no".)`)).toBe(
      "@Ann “Hi,” she said. “Wait—” he said. (He said “no”.)",
    );
    expect(type("", "It's 'fine', then.")).toBe("It’s ‘fine’, then.");
    // Straight after a bracket or a dash with no quote open, a quote opens.
    expect(type("", `He said ("no") and—"Stop!"`)).toBe("He said (“no”) and—“Stop!”");
  });

  it("are the story's language's", () => {
    expect(type("---\nlanguage: de\n---\n", `@Anna "Hallo", sagte sie.`)).toBe(
      "---\nlanguage: de\n---\n@Anna „Hallo“, sagte sie.",
    );
    expect(type("---\nlanguage: fr\n---\n", `@Anne "Bonjour."`)).toBe(
      "---\nlanguage: fr\n---\n@Anne «Bonjour.»",
    );
  });

  it("stay as typed where the formatter keeps them: front matter, addresses, instructions, notes", () => {
    const front = type("---\n", "title: 'Hello'", "\n---\n\nOnce.");
    expect(front).toBe("---\ntitle: 'Hello'\n---\n\nOnce.");
    expect(parse(front).meta.title).toBe("Hello");
    // Before the closing line is written, too.
    expect(type("---\n", `title: "It's mine"`)).toBe(`---\ntitle: "It's mine"`);
    expect(type("", "See [it](https://x.com/it's) now.")).toBe("See [it](https://x.com/it's) now.");
    expect(type("Take {recorder:", `"take" 3} then.`)).toBe(`Take {recorder:"take" 3} then.`);
    expect(type("A %% ", `a "note" %% then.`)).toBe(`A %% a "note" %% then.`);
    // A measurement too.
    expect(type("", `It is 6'2" tall.`)).toBe(`It is 6'2" tall.`);
  });
});
