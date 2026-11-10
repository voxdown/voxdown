/** The editor on real books (corpus/README.md), and typing in a long story made of them. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
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
      const names = source.match(/(?<![\p{L}\p{N}])@[A-Z]\w*/gu)?.length ?? 0;
      expect(marks.filter((mark) => mark.kind === "name").length).toBe(names);
    });
  }

  it("keeps up with typing in a long story", () => {
    const bodies = books.map(({ source }) => source.slice(source.indexOf("\n---\n", 4) + 5));
    const doc = Array.from({ length: 18 }, () => bodies.join("\n\n")).join("\n\n");
    const characters = () => [{ handle: "Alice", name: "Alice" }];
    let state = EditorState.create({ doc, extensions: [scriptEditor({ characters })] });
    const middle = Math.floor(doc.length / 2);
    // Ten keystrokes in the middle of about 100,000 words: each one works the marks out again.
    const start = performance.now();
    for (let key = 0; key < 10; key++) {
      state = state.update({ changes: { from: middle + key, insert: "a" } }).state;
      state.field(marksField);
    }
    const perKey = (performance.now() - start) / 10;
    // A generous limit for slow machines; the playground's laptop budget is far lower.
    expect(perKey).toBeLessThan(1500);
  }, 60_000);
});
