import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { MAX_SPEECH_LENGTH, planSpeechEdit, selectSpeech } from "../src/studio/speech-edit";

const cue = "  @MARA (V.O.) ^  ";
const body = "(quietly)\nHello [[private]].\n  \nAgain.\n~A lyric\n/*older\nversion*/";
const prefix = `Title: Film\n\nINT. ROOM - DAY\n\n${cue}\n`;
const suffix = "\n\n@JONAH\nOther speech. [[outside]]\n\nEXT. ROAD - DAY\n\n!Action.";
const source = prefix + body + suffix;

describe("focused speech edits", () => {
  it("selects exact speech source including parentheticals, lyrics and completed private passages", () => {
    const selected = selectSpeech(source, 5);
    expect(selected).toEqual({
      cueLine: 5,
      cue,
      source: body,
      from: prefix.length,
      to: prefix.length + body.length,
    });
  });
  it("edits only the chosen body and leaves cue/extensions, other dialogue and scenes exact", () => {
    const replacement = "(louder)\nNew words.\n[[New private note]]\nMore words.";
    const plan = planSpeechEdit(source, 5, replacement);
    expect(plan.candidate).toBe(prefix + replacement + suffix);
    expect(plan.changes).toEqual([
      { from: prefix.length, to: prefix.length + body.length, insert: replacement },
    ]);
    expect(parseFountain(plan.candidate).elements[4]?.dual).toBe(true);
  });
  it("allows intentional internal private edits without changing outside omission bytes", () => {
    const replacement = "Revised [[new secret]].\n/*new omitted\npassage*/\nLast line.";
    const plan = planSpeechEdit(source, 5, replacement);
    expect(plan.candidate.endsWith(suffix)).toBe(true);
    expect(
      parseFountain(plan.candidate).omissions.map((span) =>
        plan.candidate.slice(span.from, span.to),
      ),
    ).toEqual(["[[new secret]]", "/*new omitted\npassage*/", "[[outside]]"]);
  });
  it("preserves exact BOM and mixed line endings outside the edited range", () => {
    const original = "\uFEFF@Mara (V.O.)\r\nFirst.\rAgain.\n\n@Bob\r\nOther.";
    const plan = planSpeechEdit(original, 1, "Changed.\r\nAgain.");
    expect(plan.candidate).toBe("\uFEFF@Mara (V.O.)\r\nChanged.\r\nAgain.\n\n@Bob\r\nOther.");
  });
  it("edits an EOF speech with no invented trailing newline", () => {
    expect(planSpeechEdit("MARA\nHello.", 1, "Goodbye.").candidate).toBe("MARA\nGoodbye.");
  });
  it("allows a two-space blank dialogue line and ordinary uppercase dialogue", () => {
    expect(planSpeechEdit("MARA\nHello.", 1, "YES.\n  \nSTILL HERE.").candidate).toBe(
      "MARA\nYES.\n  \nSTILL HERE.",
    );
  });
  it.each(["Hello.\n\nAgain.", "\nHello.", "Hello.\n", "Hello.\n \nAgain."])(
    "refuses ordinary blank lines with actionable separation guidance: %j",
    (replacement) => {
      expect(() => planSpeechEdit(source, 5, replacement)).toThrow(/empty line ends a speech/);
    },
  );
  it.each([
    "@OTHER\nNew speech.",
    "!Action.",
    ".NEW SCENE",
    "# Act two",
    "= Synopsis",
    "===",
    "> CUT TO:",
  ])("refuses structural directives within a speech: %s", (replacement) => {
    expect(() => planSpeechEdit(source, 5, replacement)).toThrow(
      /Keep dialogue|cue or surrounding/,
    );
  });
  it("refuses a leading natural uppercase line that reinterprets the original cue", () => {
    // Natural cue validity depends on the following visible line; an omitted-only body cannot keep it.
    expect(() => planSpeechEdit("MARA\nHello.\n\n!Action.", 1, "[[Only notes]]")).toThrow();
  });
  it.each(["[[unfinished", "/*unfinished"])(
    "refuses unfinished omissions in the proposed body: %s",
    (replacement) => {
      expect(() => planSpeechEdit(source, 5, replacement)).toThrow(/Close every private/);
    },
  );
  it("refuses existing malformed comments even outside the selected speech", () => {
    expect(() => selectSpeech(`${source}\n[[unfinished`, 5)).toThrow(/Close unfinished/);
  });
  it("refuses an original private passage crossing from cue into speech", () => {
    expect(() => selectSpeech("@MARA [[private\nend]]Hello.", 1)).toThrow(/crosses this speech/);
  });
  it("refuses an original private passage crossing into a later cue", () => {
    expect(() => selectSpeech("@MARA\nHello.\n/*private\n*/@BOB\nOther.", 1)).toThrow(
      /crosses this speech/,
    );
  });
  it("does not allow an inserted note to consume a later external closing marker", () => {
    expect(() => planSpeechEdit("@MARA\nHello.\n\n!Action. ]]", 1, "[[steal")).toThrow();
  });
  it("does not allow inserted boneyards to hide subsequent scenes", () => {
    expect(() => planSpeechEdit("@MARA\nHello.\n\nEXT. ROAD\n!Action. */", 1, "/*steal")).toThrow();
  });
  it("returns no-op plans without reconstructing the source", () => {
    expect(planSpeechEdit(source, 5, body)).toEqual({ changes: [], candidate: source, cueLine: 5 });
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 500])(
    "refuses invalid cue line %s",
    (line) => {
      expect(() => selectSpeech(source, line)).toThrow(/Choose a character cue/);
    },
  );
  it("refuses missing or private-only speech bodies", () => {
    for (const value of ["@MARA", "@MARA\n\n!Action.", "@MARA\n[[Only notes]]"])
      expect(() => selectSpeech(value, 1)).toThrow(/Write dialogue beneath/);
  });
  it("bounds focused source, proposed text, document size and binary text", () => {
    expect(() => selectSpeech(`@MARA\n${"a".repeat(MAX_SPEECH_LENGTH + 1)}`, 1)).toThrow(
      /focused editing limit/,
    );
    for (const replacement of ["", "a".repeat(MAX_SPEECH_LENGTH + 1), "a\0b"])
      expect(() => planSpeechEdit(source, 5, replacement)).toThrow();
    const large = `@MARA\nHi.\n\n!${"x".repeat(499_982)}`;
    expect(() => planSpeechEdit(large, 1, "y".repeat(100))).toThrow(/500,000/);
  });
  it("supports one atomic change and exact one-step undo", () => {
    const plan = planSpeechEdit(source, 5, "Rewritten.");
    const target = {
      state: EditorState.create({ doc: source, extensions: [history()] }),
      dispatch(transaction: Transaction) {
        target.state = transaction.state;
      },
    };
    target.dispatch(target.state.update({ changes: plan.changes, userEvent: "input.speech" }));
    expect(target.state.doc.toString()).toBe(plan.candidate);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(source);
  });
});
