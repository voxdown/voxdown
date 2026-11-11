// @vitest-environment happy-dom
/**
 * The editor on stories made at random, and typed at random: what it draws never fails, stays
 * inside the text, and gives each character's words to the speaker the parser does, after each
 * edit too. FUZZ_RUNS and FUZZ_SEED as in the core package's fuzz tests.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { editorMarks, marksField, scriptEditor } from "../src/index";
import { smartQuotes } from "../src/quotes";

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

/**
 * Whether the editor marks each character's words as the parser gives them, and the narrator's not
 * at all: the marks worked out afresh, or those the editor has after an edit.
 */
function marksSpeakers(
  source: string,
  drawn: ReturnType<typeof editorMarks> = editorMarks(source),
): void {
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
  const marks = drawn.filter(
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
            marksSpeakers(state.doc.toString(), marks);
          }
        },
      ),
      Math.max(20, Math.round(RUNS / 4)),
    );
  });
});

/** Who says what, and how, with every quotation mark as one: what curly quotes may never change. */
function heard(source: string): string[] {
  const out: string[] = [];
  for (const block of parse(source).blocks) {
    if (block.kind === "break") continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      for (const item of line.items) {
        if (item.kind === "speech" && /[\p{L}\p{N}]/u.test(item.text)) {
          const words = item.text.replace(/["'“”‘’„‚«»‹›「」『』]/gu, "'");
          out.push(`${item.speaker} (${item.direction ?? ""}) ${item.quoted} ${words}`);
        } else if (item.kind === "vocal") {
          out.push(`${item.speaker} (${item.direction ?? ""}) [${item.description}]`);
        }
      }
    }
  }
  return out;
}

/** Stories with straight quotes only, as typed on a keyboard without smart quotes. */
const STRAIGHT = PIECES.filter((p) => !/[“”‘’]/u.test(p)).concat([
  '@Ann "Hello world',
  "@Ann 'Hello world",
  '"Hi," she said.',
  "It's Ann's.",
]);
const straightStory = fc
  .array(fc.constantFrom(...STRAIGHT), { maxLength: 30 })
  .map((p) => p.join(""));

/**
 * What a writer types: words, and whole quotes that open after a space and close after a word.
 * Straight single quotes typed alone are left out: as straight marks they read as the parser pairs
 * them (`'Twas so 'no'` is one quote), so they are no guide to what was meant.
 */
const PHRASES = [
  ' "Hello," she said.',
  ' "Wait—" he said.',
  " don't",
  ' "Bye."',
  " and",
  "\n",
  "\n@Ann ",
  "\n@Bob (softly) ",
];

/** A line that leaves a quote open, straight, and what a writer types to close it. */
const OPEN = [
  ['@Ann "Hello world', '," she said.'],
  ["@Ann 'Hello world", ",' she said."],
  ['@Ann (softly) "Wait', '—" he said.'],
  ["@Ann \"It's mine", '." Then'],
] as const;

describe("smart quotes, in stories made at random", () => {
  it("never change who says what when pasted, straight quotes before the paste or not", async () => {
    await check(
      fc.property(
        fc.oneof(story, straightStory),
        fc.array(fc.constantFrom(...STRAIGHT, ...PHRASES, ...OPEN.flat()), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.nat(),
        (doc, pieces, at) => {
          const from = at % (doc.length + 1);
          const insert = pieces.join("");
          const pasted = EditorState.create({ doc, extensions: smartQuotes() }).update({
            changes: { from, insert },
            userEvent: "input.paste",
          }).state;
          const raw = doc.slice(0, from) + insert + doc.slice(from);
          expect(heard(pasted.doc.toString()), JSON.stringify([doc, from, insert])).toEqual(
            heard(raw),
          );
        },
      ),
    );
  });

  it("never change who says what in a story typed with straight quotes", async () => {
    await check(
      fc.property(
        straightStory,
        fc.option(fc.constantFrom(...OPEN), { nil: undefined }),
        fc.array(fc.constantFrom(...PHRASES), { minLength: 1, maxLength: 6 }),
        (story, open, phrases) => {
          // Typed a character at a time in a new paragraph after the story, or after a line
          // that leaves a quote open, its close first: what was meant is then what the
          // straight marks say.
          const doc = `${story}\n\n${open ? open[0] : ""}`;
          const at = doc.length;
          const typed = (open ? open[1] : "") + phrases.join("");
          const view = new EditorView({
            state: EditorState.create({ doc, extensions: smartQuotes() }),
            parent: document.body,
          });
          view.dispatch({ selection: { anchor: at } });
          let cursor = at;
          for (const char of typed) {
            const handled = view.state
              .facet(EditorView.inputHandler)
              .some((handler) =>
                handler(view, cursor, cursor, char, () =>
                  view.state.update({ changes: { from: cursor, insert: char } }),
                ),
              );
            if (!handled) {
              view.dispatch({
                changes: { from: cursor, insert: char },
                selection: { anchor: cursor + char.length },
              });
            }
            cursor = view.state.selection.main.head;
          }
          const result = view.state.doc.toString();
          view.destroy();
          const raw = doc.slice(0, at) + typed + doc.slice(at);
          expect(heard(result), JSON.stringify([doc, at, typed, result])).toEqual(heard(raw));
        },
      ),
      Math.max(20, Math.round(RUNS / 4)),
    );
  });
});
