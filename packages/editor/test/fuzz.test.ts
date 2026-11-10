/**
 * The editor on stories made at random, and typed at random: what it draws never fails and stays
 * inside the text. FUZZ_RUNS and FUZZ_SEED as in the core package's fuzz tests.
 */
import { EditorState } from "@codemirror/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { editorMarks, marksField, scriptEditor } from "../src/index";

const RUNS = Number(process.env.FUZZ_RUNS ?? 1000);
const SEED =
  process.env.FUZZ_SEED === "random" ? undefined : Number(process.env.FUZZ_SEED ?? 20261110);
const settings = { numRuns: RUNS, ...(SEED === undefined ? {} : { seed: SEED }) };

const PIECES = [
  "@Gerald",
  "@Wanda",
  "@",
  "@(",
  "@(yawning)",
  "(yawning)",
  "@()",
  "(",
  ")",
  "“",
  "”",
  "‘",
  "’",
  '"',
  "'",
  "“Hello,”",
  "[snores]",
  "@Gerald [snores]",
  "[",
  "]",
  "{page}",
  "{pause 2s}",
  "{book only}",
  "{hidden}",
  "{",
  "}",
  "%% note %%",
  "%%",
  ":::",
  "::: whispering",
  "::: @Gerald (whispering)",
  "# ",
  "## Title",
  "---",
  "Hello",
  " ",
  "\n",
  "\n\n",
  "\\",
  "—",
  "😀",
  "﻿",
  "---\ncast:\n  Gerald:\n---\n",
];
const piece = fc.constantFrom(...PIECES);
const story = fc.array(piece, { maxLength: 40 }).map((p) => p.join(""));

const inside = (length: number) => (mark: { from: number; to: number }) =>
  0 <= mark.from && mark.from <= mark.to && mark.to <= length;

describe("the editor, on stories made at random", () => {
  it("works out what to draw without failing, inside the text", () => {
    fc.assert(
      fc.property(story, (source) => {
        expect(editorMarks(source).every(inside(source.length))).toBe(true);
      }),
      settings,
    );
  });

  it("keeps up with typing anywhere, a piece at a time", () => {
    const characters = () => [{ handle: "Gerald", name: "Gerald the Dragon" }];
    fc.assert(
      fc.property(
        story,
        fc.array(fc.tuple(fc.nat(), piece, fc.nat(3)), { maxLength: 12 }),
        (doc, edits) => {
          let state = EditorState.create({ doc, extensions: [scriptEditor({ characters })] });
          for (const [at, text, remove] of edits) {
            const from = at % (state.doc.length + 1);
            const to = Math.min(state.doc.length, from + remove);
            state = state.update({ changes: { from, to, insert: text } }).state;
            const marks = state.field(marksField);
            expect(marks.every(inside(state.doc.length))).toBe(true);
          }
        },
      ),
      { ...settings, numRuns: Math.max(20, Math.round(RUNS / 4)) },
    );
  });
});
