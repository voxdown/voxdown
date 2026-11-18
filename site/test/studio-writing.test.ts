import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { type FountainDocument, parseFountain } from "../src/studio/fountain";
import {
  MAX_COMPLETION_CANDIDATES,
  MAX_COMPLETION_ELEMENTS,
  MAX_COMPLETION_RESULTS,
  insertScreenplayParagraph,
  screenplayCompletions,
  setActionLine,
  setCharacterLine,
  setParentheticalLine,
  setSceneLine,
  setTransitionLine,
} from "../src/studio/writing";

function editor(doc: string, anchor = doc.length, head = anchor) {
  const target = {
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: [history()] }),
    dispatch(transaction: Transaction) {
      target.state = transaction.state;
    },
  };
  return target;
}

function complete(source: CompletionSource, text: string, explicit = false) {
  const state = EditorState.create({ doc: text, selection: { anchor: text.length } });
  return source(new CompletionContext(state, text.length, explicit)) as CompletionResult | null;
}

describe("Studio screenplay source commands", () => {
  it("changes one line and preserves selected words, direction, and undo", () => {
    const target = editor("Earlier.\n\nMcClane\nLater.", 17, 10);
    expect(setCharacterLine(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("Earlier.\n\n@McClane\nLater.");
    expect(
      target.state.sliceDoc(target.state.selection.main.from, target.state.selection.main.to),
    ).toBe("McClane");
    expect(target.state.selection.main.anchor).toBeGreaterThan(target.state.selection.main.head);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("Earlier.\n\nMcClane\nLater.");
  });

  it("preserves lowercase and Unicode names instead of uppercasing them", () => {
    for (const name of ["McClane", "李明", "ÉLODIE", "İpek"]) {
      const target = editor(name);
      setCharacterLine(target);
      expect(target.state.doc.toString()).toBe(`@${name}`);
      expect(parseFountain(target.state.doc.toString()).elements[0]?.kind).toBe("character");
    }
  });

  it.each([
    [setCharacterLine, "!RIVER", "@RIVER"],
    [setActionLine, "@McClane", "!McClane"],
    [setSceneLine, "@ROOM", ".ROOM"],
    [setSceneLine, "> CUT TO:", ".CUT TO:"],
    [setTransitionLine, ".FADE OUT", ">FADE OUT"],
    [setParentheticalLine, "!softly", "(softly)"],
    [setActionLine, "(softly)", "!softly"],
    [setCharacterLine, ">THE END<", "@THE END"],
  ] as [StateCommand, string, string][])(
    "replaces existing structural markers",
    (command, input, expected) => {
      const target = editor(input);
      command(target);
      expect(target.state.doc.toString()).toBe(expected);
    },
  );

  it("leaves natural scene headings natural at boundaries, forces them within dialogue", () => {
    const natural = editor("\nINT. ROOM - DAY");
    setSceneLine(natural);
    expect(natural.state.doc.toString()).toBe("\nINT. ROOM - DAY");
    const speech = editor("@ADA\nINT. ROOM - DAY");
    setSceneLine(speech);
    expect(speech.state.doc.toString()).toBe("@ADA\n.INT. ROOM - DAY");
    expect(parseFountain(speech.state.doc.toString()).elements[1]?.kind).toBe("scene");
  });

  it("does not mistake ellipses for a removable scene marker", () => {
    const target = editor("...time passes.");
    setActionLine(target);
    expect(target.state.doc.toString()).toBe("!...time passes.");
    const scene = editor("...time passes.");
    expect(setSceneLine(scene)).toBe(false);
    expect(scene.state.doc.toString()).toBe("...time passes.");
  });

  it("preserves indentation and trailing spaces; empty parentheses place caret inside", () => {
    const target = editor("  @Maya  ", 5);
    setActionLine(target);
    expect(target.state.doc.toString()).toBe("  !Maya  ");
    expect(target.state.selection.main.head).toBe(5);
    const empty = editor("");
    setParentheticalLine(empty);
    expect(empty.state.doc.toString()).toBe("()");
    expect(empty.state.selection.main.head).toBe(1);
    setParentheticalLine(empty);
    expect(empty.state.doc.toString()).toBe("()");
  });

  it("creates usable empty scene/cue/transition lines", () => {
    for (const [command, expected] of [
      [setSceneLine, "INT. "],
      [setCharacterLine, "@"],
      [setTransitionLine, ">"],
    ] as [StateCommand, string][]) {
      const target = editor("");
      command(target);
      expect(target.state.doc.toString()).toBe(expected);
      expect(target.state.selection.main.head).toBe(expected.length);
    }
  });

  it("refuses multiline pasted selections, multiple cursors, readonly states, and private markers", () => {
    const pasted = editor("ADA\nA whole speech.", 0, 19);
    expect(setCharacterLine(pasted)).toBe(false);
    const target = editor("One\nTwo");
    target.state = EditorState.create({
      doc: "One\nTwo",
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(5)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(setActionLine(target)).toBe(false);
    target.state = EditorState.create({
      doc: "Private",
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(setActionLine(target)).toBe(false);
    for (const value of ["[[private note]]", "/* deleted */", "# Act one", "===", "\\@literal"]) {
      const privateLine = editor(value);
      expect(setActionLine(privateLine)).toBe(false);
      expect(privateLine.state.doc.toString()).toBe(value);
    }
  });

  it("inserts a paragraph without deleting selection or splitting words", () => {
    const target = editor("A whole sentence.\nNext scene.", 2, 7);
    insertScreenplayParagraph(target);
    expect(target.state.doc.toString()).toBe("A whole sentence.\n\n\n\nNext scene.");
    expect(target.state.selection.main.head).toBe(19);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("A whole sentence.\nNext scene.");
  });

  it("reuses blank lines when starting a paragraph", () => {
    const target = editor("One.\n\n\n\nTwo.", 2);
    insertScreenplayParagraph(target);
    expect(target.state.doc.toString()).toBe("One.\n\n\n\nTwo.");
    expect(target.state.selection.main.head).toBe(6);
    const oneBlank = editor("One.\n\nTwo.", 2);
    insertScreenplayParagraph(oneBlank);
    expect(oneBlank.state.doc.toString()).toBe("One.\n\n\n\nTwo.");
    expect(oneBlank.state.selection.main.head).toBe(6);
    oneBlank.dispatch(oneBlank.state.update({ changes: { from: 6, insert: "New paragraph." } }));
    expect(oneBlank.state.doc.toString()).toBe("One.\n\nNew paragraph.\n\nTwo.");
  });

  it("does not insert blank lines into private notes or removed material", () => {
    for (const doc of [
      "[[private\ncontinued]]",
      "/*removed\ncontinued*/",
      "[[private /* nested\ncontinued]]",
    ]) {
      const target = editor(doc, 3);
      expect(insertScreenplayParagraph(target)).toBe(false);
      expect(target.state.doc.toString()).toBe(doc);
    }
    for (const doc of ["\\[[literal", "[[finished]]\n\nVisible", "/* finished */\n\nVisible"]) {
      const target = editor(doc);
      expect(insertScreenplayParagraph(target)).toBe(true);
    }
  });

  it("rejects every line command on opening, interior, closing, or inline omitted spans", () => {
    const commands = [
      setSceneLine,
      setActionLine,
      setCharacterLine,
      setParentheticalLine,
      setTransitionLine,
      insertScreenplayParagraph,
    ];
    for (const doc of [
      "[[private\ncontinued\nending]]",
      "/*private\ncontinued\nending*/",
      "Visible [[private]] after",
      "Visible /*private*/ after",
      "[[private\n  \nending]]",
      "[[private \\]]\nending]]",
    ]) {
      const parsed = parseFountain(doc);
      expect(parsed.omissions).toHaveLength(1);
      for (let line = 1; line <= editor(doc).state.doc.lines; line++) {
        for (const command of commands) {
          const target = editor(doc);
          target.dispatch(
            target.state.update({ selection: { anchor: target.state.doc.line(line).to } }),
          );
          expect(command(target), `${doc}: line ${line}`).toBe(false);
          expect(target.state.doc.toString()).toBe(doc);
        }
      }
    }
  });

  it("rejects malformed-comment documents conservatively, even outside the edited line", () => {
    for (const doc of ["Visible\n\n[[unfinished", "Visible\n\n/* unfinished"]) {
      for (const command of [setActionLine, setParentheticalLine, insertScreenplayParagraph]) {
        const target = editor(doc, 3);
        expect(command(target)).toBe(false);
        expect(target.state.doc.toString()).toBe(doc);
      }
    }
  });

  it("preserves omission kind, contents, and mapped positions outside edited lines", () => {
    for (const command of [
      setActionLine,
      setCharacterLine,
      setParentheticalLine,
      insertScreenplayParagraph,
    ]) {
      const doc = "Visible\n\n[[private]]\n\n/* removed */";
      const target = editor(doc, 3);
      expect(command(target)).toBe(true);
      const result = target.state.doc.toString();
      const before = parseFountain(doc).omissions;
      const after = parseFountain(result).omissions;
      expect(after.map((span) => [span.kind, result.slice(span.from, span.to)])).toEqual(
        before.map((span) => [span.kind, doc.slice(span.from, span.to)]),
      );
      expect(parseFountain(result).warnings).toEqual([]);
    }
  });
});

describe("Studio screenplay completions", () => {
  const document = parseFountain(
    "INT. ROOM - DAY\n\n@McClane\nHello.\n\n@ÉLODIE (V.O.)\nHi.\n\n@李明\n你好\n\nEXT. LAKE - NIGHT\n\n@ÉLODIE\nAgain.",
  );
  const source = screenplayCompletions(() => document);

  it("offers explicit character cues including Unicode and strips extensions", () => {
    const result = complete(source, "@");
    expect(result?.from).toBe(1);
    expect(result?.options.map((option) => option.label)).toEqual(["McClane", "ÉLODIE", "李明"]);
    expect(complete(source, "@李")?.options[0]?.apply).toBe("李明");
  });

  it("adds a forced marker for mixed case and nonuppercase names from an empty boundary", () => {
    const result = complete(source, "\n\n", true);
    expect(result?.options.map((option) => option.apply)).toEqual(["@McClane", "ÉLODIE", "@李明"]);
    expect(complete(source, "", false)).toBeNull();
    expect(complete(source, "M", false)).toBeNull();
    expect(complete(source, "MC", false)?.options[0]?.apply).toBe("@McClane");
  });

  it("only offers scenes on scene headings and preserves a forced dot", () => {
    expect(complete(source, "INT. R")?.options[0]?.label).toBe("INT. ROOM - DAY");
    const forced = complete(source, ".EXT. L");
    expect(forced?.from).toBe(1);
    expect(forced?.options[0]?.apply).toBe("EXT. LAKE - NIGHT");
    expect(complete(source, "@ADA\nINT. R")).toBeNull();
  });

  it("never completes ordinary prose or dialogue even on Ctrl-Space", () => {
    for (const text of ["She sees a lake", "@ADA\nMC", "(quietly)", "[[MC", "Title: MC"]) {
      expect(complete(source, text, true)).toBeNull();
    }
    const state = EditorState.create({ doc: "@McClane", selection: { anchor: 3 } });
    expect(source(new CompletionContext(state, 3, true))).toBeNull();
  });

  it("indexes each worker document once, refreshes new results, and bounds scanning/results", () => {
    let reads = 0;
    const elements = Array.from({ length: MAX_COMPLETION_ELEMENTS + 1 }, (_, i) => ({
      kind: "character" as const,
      text: `PERSON ${i}`,
      from: i,
      to: i + 1,
      line: i + 1,
    }));
    const tracked = new Proxy(elements, {
      get(target, key, receiver) {
        if (/^\d+$/.test(String(key))) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    let latest: FountainDocument = { ...parseFountain(""), elements: tracked };
    const bounded = screenplayCompletions(() => latest);
    expect(complete(bounded, "@")?.options).toHaveLength(MAX_COMPLETION_RESULTS);
    expect(reads).toBe(MAX_COMPLETION_ELEMENTS);
    complete(bounded, "@PERSON 1");
    expect(reads).toBe(MAX_COMPLETION_ELEMENTS);
    expect(complete(bounded, `@PERSON ${MAX_COMPLETION_CANDIDATES}`)).toBeNull();
    latest = parseFountain("@NEWCOMER\nHi.");
    expect(complete(bounded, "@N")?.options[0]?.label).toBe("NEWCOMER");
  });
});
