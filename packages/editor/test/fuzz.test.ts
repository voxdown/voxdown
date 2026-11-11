/**
 * The editor on stories made at random, and typed at random: what it draws never fails, stays
 * inside the text, and gives each character's words to the speaker the parser does, after each
 * edit too. FUZZ_RUNS and FUZZ_SEED as in the core package's fuzz tests.
 */
import { EditorState } from "@codemirror/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { editorMarks, marksField, scriptEditor } from "../src/index";

const RUNS = Number(process.env.FUZZ_RUNS ?? 1000);
const SEED =
  process.env.FUZZ_SEED === "random" ? undefined : Number(process.env.FUZZ_SEED ?? 20261110);
/**
 * Checks a property in chunks of stories, giving the event loop a turn between them, so a deep
 * run (FUZZ_RUNS=20000) never blocks the test worker long enough for vitest to give up on it.
 */
async function check<T>(property: fc.IProperty<T>, runs = RUNS): Promise<void> {
  const chunk = 250;
  for (let done = 0, part = 0; done < runs; done += chunk, part++) {
    fc.assert(property, {
      numRuns: Math.min(chunk, runs - done),
      ...(SEED === undefined ? {} : { seed: SEED + part }),
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
}

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
  "&amp;",
  "&quot;",
  "&constructor;",
  "&toString;",
  "—",
  "😀",
  "﻿",
  "---\ncast:\n  Gerald:\n---\n",
];
const piece = fc.constantFrom(...PIECES);
const story = fc.array(piece, { maxLength: 40 }).map((p) => p.join(""));

const inside = (length: number) => (mark: { from: number; to: number }) =>
  0 <= mark.from && mark.from <= mark.to && mark.to <= length;

/** Whether the editor marks each character's words as the parser gives them, and the narrator's not at all. */
function marksSpeakers(source: string): void {
  const parsed = parse(source);
  const said = (of: Array<{ from: number; to: number; speaker: string }>) =>
    of.map((m) => `${m.from}:${m.to}:${m.speaker}`).sort();
  const expected: Array<{ from: number; to: number; speaker: string }> = [];
  // A heading is drawn as one, so only paragraphs' words are marked by who says them.
  for (const block of parsed.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines) {
      for (const item of line.items) {
        if (item.kind !== "speech") continue;
        if (item.speaker.toLowerCase() === parsed.meta.narrator.toLowerCase()) continue;
        // A stretch with no text at all has nothing to draw.
        if (item.textRange.from === item.textRange.to) continue;
        expected.push({ ...item.textRange, speaker: item.speaker });
      }
    }
  }
  const marks = editorMarks(source).filter(
    (m): m is Extract<typeof m, { kind: "speech" }> => m.kind === "speech",
  );
  expect(said(marks), JSON.stringify(source)).toEqual(said(expected));
}

describe("the editor, on stories made at random", () => {
  it("works out what to draw without failing, inside the text", async () => {
    await check(
      fc.property(story, (source) => {
        expect(editorMarks(source).every(inside(source.length))).toBe(true);
      }),
    );
  });

  it("marks each character's words as the parser says them, and the narrator's not at all", async () => {
    await check(fc.property(story, (source) => marksSpeakers(source)));
  });

  it("keeps up with typing anywhere, a piece at a time", async () => {
    const characters = () => [{ handle: "Gerald", name: "Gerald the Dragon" }];
    await check(
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
            // And what it draws means what it should: each character's words, the parser's.
            marksSpeakers(state.doc.toString());
          }
        },
      ),
      Math.max(20, Math.round(RUNS / 4)),
    );
  });
});
