// @vitest-environment happy-dom
import { insertNewline } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { parse, spokenScript } from "voxdown";
import {
  FRESH_BELOW,
  editorMarks,
  marksField,
  marksPending,
  scriptEditor,
  settleMarks,
} from "../src/index";
import { quoteBackspace, quoteEnter, smartQuotes } from "../src/quotes";

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

describe("quotes typed into a story", () => {
  it("close a quote opened straight with a straight mark, in any language", () => {
    expect(type(`@Ann "Hello world`, `," she said.`)).toBe(`@Ann "Hello world," she said.`);
    expect(type(`@Ann 'Hello world`, `,' she said.`)).toBe(`@Ann 'Hello world,' she said.`);
    expect(type(`---\nlanguage: de\n---\n@Anna "Guten Morgen`, `", sagte sie.`)).toBe(
      `---\nlanguage: de\n---\n@Anna "Guten Morgen", sagte sie.`,
    );
    expect(spokenScript(parse(type(`@Ann "Hello world`, `," she said.`)))).toBe(
      "Ann: Hello world,\nNarrator: she said.",
    );
  });

  it("carry on a speech opened straight in the paragraph before, as straight marks do (§5.7)", () => {
    const typed = type(`@Ann "It was a long winter.\n\n`, `"Then spring came," she said.`);
    expect(typed).toBe(`@Ann "It was a long winter.\n\n"Then spring came," she said.`);
    expect(spokenScript(parse(typed))).toBe(
      "Ann: It was a long winter.\n\nAnn: Then spring came,\nNarrator: she said.",
    );
  });

  it("close a quote opened with another language's marks with its own", () => {
    expect(type("---\nlanguage: de\n---\n@Anna “Hallo", `", sagte sie.`)).toBe(
      "---\nlanguage: de\n---\n@Anna “Hallo”, sagte sie.",
    );
  });
});

/** The editor's Enter or Backspace at `|`, as the keymaps run it, or the default Enter. */
function press(key: "Enter" | "Backspace", text: string): string {
  const at = text.indexOf("|");
  const view = new EditorView({
    state: EditorState.create({
      doc: text.slice(0, at) + text.slice(at + 1),
      selection: EditorSelection.cursor(at),
      extensions: [smartQuotes(), quoteEnter, quoteBackspace],
    }),
    parent: document.body,
  });
  const handled = runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
  if (!handled && key === "Enter") insertNewline(view);
  const head = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  view.destroy();
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

describe("Enter in a quote", () => {
  it("splits it for the same speaker and direction", () => {
    expect(press("Enter", "@Rupert (dry) “No toast.| No bread.”")).toBe(
      "@Rupert (dry) “No toast.”\n@Rupert (dry) “|No bread.”",
    );
    // A quote carrying on a speech on its line takes its speaker's mark.
    expect(press("Enter", "@Ann “Hi,” she said, “bye now.| See you.”")).toBe(
      "@Ann “Hi,” she said, “bye now.”\n@Ann “|See you.”",
    );
    // A quote in narration is narration: Enter is Enter there.
    expect(press("Enter", "He said “no.| Never.”")).toBe("He said “no.\n| Never.”");
  });

  it("closes a quote never closed when Enter comes after its last word, at the line's end", () => {
    expect(press("Enter", "@Ann “Hello there|")).toBe("@Ann “Hello there”\n|");
    expect(press("Enter", "@Ann “Hello there   |")).toBe("@Ann “Hello there”\n|");
    expect(press("Enter", "---\nlanguage: de\n---\n@Anna „Hallo|")).toBe(
      "---\nlanguage: de\n---\n@Anna „Hallo“\n|",
    );
    // Mid-line, or in narration, Enter is as before.
    expect(press("Enter", "He said “no|")).toBe("He said “no\n|");
  });

  it("closes the quote with its own mark, in every language and straight", () => {
    expect(press("Enter", "---\nlanguage: de\n---\n@Anna „Hallo.| Wie geht’s?“")).toBe(
      "---\nlanguage: de\n---\n@Anna „Hallo.“\n@Anna „|Wie geht’s?“",
    );
    expect(press("Enter", "---\nlanguage: fr\n---\n@Anne «Bonjour.| Ça va ?»")).toBe(
      "---\nlanguage: fr\n---\n@Anne «Bonjour.»\n@Anne «|Ça va ?»",
    );
    expect(press("Enter", `@Ann "Hello.| Bye."`)).toBe(`@Ann "Hello."\n@Ann "|Bye."`);
    expect(press("Enter", "@Nell ‘I know.| He’s late.’")).toBe(
      "@Nell ‘I know.’\n@Nell ‘|He’s late.’",
    );
  });

  it("is Enter outside a quote: after a German quote's close, and in narration", () => {
    const german = "---\nlanguage: de\n---\n@Anna „Hallo“, sagte sie.";
    expect(press("Enter", `${german}|`)).toBe(`${german}\n|`);
    expect(press("Enter", "---\nlanguage: de\n---\n@Anna „Hallo“, sagte| sie.")).toBe(
      "---\nlanguage: de\n---\n@Anna „Hallo“, sagte\n| sie.",
    );
    expect(press("Enter", "@Ann “Hello,” she said.|")).toBe("@Ann “Hello,” she said.\n|");
  });

  it("closes the quote after its last word, not after a space typed before Enter", () => {
    expect(press("Enter", "@Ann “One thing. |Two things.”")).toBe(
      "@Ann “One thing.”\n@Ann “|Two things.”",
    );
  });

  it("splits a quote in a long story as in a short one, reading only the paragraphs near it", () => {
    const filler = "Narration goes on and on. ".repeat(Math.ceil(FRESH_BELOW / 26) + 10);
    const front = "---\nlanguage: de\n---\n";
    const text = `${front}${filler}\n\n@Anna „Hallo.| Wie geht’s?“`;
    const split = press("Enter", text);
    expect(split.slice(split.indexOf("@Anna"))).toBe("@Anna „Hallo.“\n@Anna „|Wie geht’s?“");
    // And a quote typed there is the story's language's, opened and closed.
    const typed = type(`${front}${filler}\n\n@Anna `, `"Gut", sagte sie.`);
    expect(typed.endsWith("@Anna „Gut“, sagte sie.")).toBe(true);
  });

  it("before the closing mark goes after the line", () => {
    expect(press("Enter", "@Ann “Hello.|” [door]")).toBe("@Ann “Hello.” [door]\n|");
  });
});

describe("Backspace after a split", () => {
  it("joins the quote back, whatever its marks", () => {
    expect(press("Backspace", "@Rupert “No toast.”\n@Rupert “|No bread.”")).toBe(
      "@Rupert “No toast. |No bread.”",
    );
    expect(press("Backspace", "@Anna „Hallo.“\n@Anna „|Wie geht’s?“")).toBe(
      "@Anna „Hallo. |Wie geht’s?“",
    );
    expect(press("Backspace", `@Ann "Hello."\n@Ann "|Bye."`)).toBe(`@Ann "Hello. |Bye."`);
  });

  it("splits and joins back to what was written", () => {
    for (const text of [
      "@Rupert (dry) “No toast.| No bread.”",
      "---\nlanguage: de\n---\n@Anna „Hallo.| Wie geht’s?“",
      "---\nlanguage: fr\n---\n@Anne «Bonjour.| Ça va ?»",
      `@Ann "Hello.| Bye."`,
    ]) {
      const back = press("Backspace", press("Enter", text));
      expect(back.replace("|", "")).toBe(text.replace("|", ""));
    }
  });
});

describe("a long story's marks", () => {
  it("move with typing, and are worked out afresh once it pauses", async () => {
    const paragraph = "@Gerald “I’ve only just got to sleep,” said the dragon. [snores]\n\n";
    const long = paragraph.repeat(Math.ceil(FRESH_BELOW / paragraph.length) + 10);
    const view = new EditorView({
      state: EditorState.create({ doc: long, extensions: scriptEditor({ characters: () => [] }) }),
      parent: document.body,
    });
    const at = view.state.doc.length;
    view.dispatch({ changes: { from: at, insert: "@Wanda “Hello.”" } });
    // Moved along, not yet read: the old marks keep their places, the new words have none yet.
    expect(marksPending(view.state)).toBe(true);
    const moved = view.state.field(marksField);
    expect(moved.every((mark) => mark.to <= view.state.doc.length)).toBe(true);
    expect(moved.some((mark) => mark.kind === "name" && mark.from >= at)).toBe(false);
    // Once typing pauses, they are what the text gives.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(marksPending(view.state)).toBe(false);
    expect(view.state.field(marksField)).toEqual(editorMarks(view.state.doc.toString()));
    // A fix whose words were changed in the meantime is dropped until then, never misplaced.
    view.dispatch({ changes: { from: at, to: at + 1, insert: "@ " } });
    for (const mark of view.state.field(marksField)) {
      if (mark.kind === "warning" && mark.fix) {
        expect(mark.fix.from).toBeGreaterThanOrEqual(0);
        expect(mark.fix.to).toBeLessThanOrEqual(view.state.doc.length);
      }
    }
    settleMarks(view);
    expect(view.state.field(marksField)).toEqual(editorMarks(view.state.doc.toString()));
    view.destroy();
  });

  it("are worked out on every change in a short story", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "Hi.", extensions: scriptEditor({ characters: () => [] }) }),
      parent: document.body,
    });
    view.dispatch({ changes: { from: 3, insert: " @Wanda “Hello.”" } });
    expect(marksPending(view.state)).toBe(false);
    expect(view.state.field(marksField)).toEqual(editorMarks(view.state.doc.toString()));
    view.destroy();
  });
});

describe("Enter in a mark not finished", () => {
  it("closes it, and Enter again at the line's end ends the line without the space", async () => {
    const { markEnter } = await import("../src/quotes");
    const view = new EditorView({
      state: EditorState.create({
        doc: "The door [creak",
        selection: EditorSelection.cursor(15),
        extensions: [markEnter],
      }),
      parent: document.body,
    });
    const enter = () =>
      runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter" }), "editor");
    expect(enter()).toBe(true);
    expect(view.state.doc.toString()).toBe("The door [creak] ");
    expect(enter()).toBe(true);
    expect(view.state.doc.toString()).toBe("The door [creak]\n");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    view.destroy();
  });
});

describe("a long story's marks worked out elsewhere", () => {
  it("come from the host's worker once typing pauses, and only for the text as it still is", async () => {
    const { marksElsewhere, marksField, marksPending, livePreview } = await import(
      "../src/decorations"
    );
    const long = `${"Word. ".repeat(6000)}@Ann “Hi.”`;
    const asked: string[] = [];
    const view = new EditorView({
      state: EditorState.create({
        doc: long,
        extensions: [
          livePreview({ characters: () => [] }),
          marksElsewhere.of(async (text) => {
            asked.push(text);
            return [{ kind: "frontmatter", from: 0, to: 1 }];
          }),
        ],
      }),
      parent: document.body,
    });
    view.dispatch({ changes: { from: 0, insert: "New. " } });
    expect(marksPending(view.state)).toBe(true);
    await new Promise((done) => setTimeout(done, 450));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.startsWith("New. ")).toBe(true);
    expect(marksPending(view.state)).toBe(false);
    expect(view.state.field(marksField)).toEqual([{ kind: "frontmatter", from: 0, to: 1 }]);
    view.destroy();
  });
});
