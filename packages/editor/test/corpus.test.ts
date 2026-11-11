/** The editor on real books (corpus/README.md), and typing in a long story made of them. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { inGoodTime } from "../../../test-support/timing";
import { editorMarks, marksField, scriptEditor } from "../src/index";

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), "../../../corpus");
const books = readdirSync(corpus)
  .filter((name) => name.endsWith(".vxd"))
  .map((name) => ({ name, source: readFileSync(join(corpus, name), "utf8") }));

describe("the editor, on real books", () => {
  for (const { name, source } of books) {
    it(`draws ${name} inside its text, a chip for every name`, () => {
      const marks = editorMarks(source);
      for (const mark of marks) {
        expect(0 <= mark.from && mark.from <= mark.to && mark.to <= source.length).toBe(true);
      }
      // A name's chip is its own, or part of the chip of the sound it makes or the group it opens.
      const names = source.match(/(?<![\p{L}\p{N}])@\p{Lu}/gu)?.length ?? 0;
      const chips = marks.filter(
        (mark) =>
          mark.kind === "name" ||
          (mark.kind === "vocal" && /^@\p{L}/u.test(source.slice(mark.from))) ||
          (mark.kind === "group" && !mark.close && mark.speaker !== undefined),
      );
      expect(chips.length).toBe(names);
    });
  }

  it("keeps up with typing in a long story", () => {
    const bodies = books
      .map(({ source }) => source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""))
      .join("\n\n");
    const times = Math.ceil(100_000 / bodies.split(/\s+/).length);
    const doc = Array.from({ length: times }, () => bodies).join("\n\n");
    const characters = () => [{ handle: "Alice", name: "Alice" }];
    let state = EditorState.create({ doc, extensions: [scriptEditor({ characters })] });
    const middle = Math.floor(doc.length / 2);
    // Ten keystrokes in the middle of about 100,000 words: each one works the marks out again.
    // A generous limit, 1.5 s a key; the playground's laptop budget is far lower.
    inGoodTime(
      15_000,
      () => {
        for (let key = 0; key < 10; key++) {
          state = state.update({ changes: { from: middle + key, insert: "a" } }).state;
          state.field(marksField);
        }
      },
      "ten keys",
    );
  }, 60_000);
});
