import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { lines, parse, spokenScript } from "voxdown";
import { scriptEditor } from "../src";
import { smartQuotes } from "../src/quotes";

describe("pasted text", () => {
  it("curls straight quotes and apostrophes, as typing does", () => {
    const state = EditorState.create({ doc: "", extensions: smartQuotes() });
    const pasted = state.update({
      changes: { from: 0, insert: '@Rupert "It\'s mine." He said "go" -"now"' },
      userEvent: "input.paste",
    }).state;
    expect(pasted.doc.toString()).toBe("@Rupert “It’s mine.” He said “go” -“now”");
    const single = state.update({
      changes: { from: 0, insert: "He said 'no' and left." },
      userEvent: "input.paste",
    }).state;
    expect(single.doc.toString()).toBe("He said ‘no’ and left.");
    const elided = state.update({
      changes: { from: 0, insert: "'Twas rock 'n' roll, 'em all." },
      userEvent: "input.paste",
    }).state;
    expect(elided.doc.toString()).toBe("’Twas rock ’n’ roll, ’em all.");
    const decade = state.update({
      changes: { from: 0, insert: "Back in the '90s." },
      userEvent: "input.paste",
    }).state;
    expect(decade.doc.toString()).toBe("Back in the ’90s.");
    // A measurement keeps its marks as pasted, as the formatter keeps them.
    const height = state.update({
      changes: { from: 0, insert: `He is 6'2" tall, "really".` },
      userEvent: "input.paste",
    }).state;
    expect(height.doc.toString()).toBe(`He is 6'2" tall, “really”.`);
  });

  const paste = (text: string) =>
    EditorState.create({ doc: "", extensions: smartQuotes() })
      .update({ changes: { from: 0, insert: text }, userEvent: "input.paste" })
      .state.doc.toString();

  it("keeps the marks pasted when curling them would change who says what in the story", () => {
    // Pasted into a quote opened with a straight mark: a curly ” would close nothing.
    const state = EditorState.create({ doc: `@Ann "Hello`, extensions: smartQuotes() });
    const pasted = state.update({
      changes: { from: 11, insert: ` world," she said. "Bye."` },
      userEvent: "input.paste",
    }).state;
    expect(pasted.doc.toString()).toBe(`@Ann "Hello world," she said. "Bye."`);
    expect(spokenScript(parse(pasted.doc.toString()))).toBe(
      "Ann: Hello world,\nNarrator: she said.\nAnn: Bye.",
    );
  });

  it("curls quotes only where the parser hears the line the same, and never touches front matter, addresses or instructions", () => {
    // A `"` after a dash closes the quote the line has open.
    expect(paste(`@Ann "Wait—" she said. "Now."`)).toBe("@Ann “Wait—” she said. “Now.”");
    expect(paste(`---\ntitle: "It's mine"\n---\nHi.`)).toBe(`---\ntitle: "It's mine"\n---\nHi.`);
    expect(paste(`See [the map](https://example.com/it's "The 'map'") now.`)).toBe(
      `See [the map](https://example.com/it's "The 'map'") now.`,
    );
    expect(paste(`Take {recorder:take "3"} and go.`)).toBe(`Take {recorder:take "3"} and go.`);
  });

  it("keeps who says what in every book pasted, as written and with its quotes made straight", () => {
    const corpus = resolve(dirname(fileURLToPath(import.meta.url)), "../../../corpus");
    const voices = (text: string) =>
      lines(parse(text)).map((row) => [row.kind, row.speaker, row.direction]);
    for (const name of readdirSync(corpus).filter((file) => file.endsWith(".vxd"))) {
      const book = readFileSync(join(corpus, name), "utf8");
      const straight = book.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      for (const text of [book, straight]) {
        const pasted = paste(text);
        expect(voices(pasted), name).toEqual(voices(text));
        // Pasted into a document, line breaks are the document's own.
        const front = (of: string) => parse(of).frontMatter?.raw.replace(/\r\n/g, "\n");
        expect(front(pasted), name).toBe(front(text));
      }
    }
  }, 60_000);

  it("leaves one space where words were cut from between others", () => {
    const state = EditorState.create({
      doc: "One. Two. Three.",
      extensions: scriptEditor({ characters: () => [] }),
    });
    const cut = state.update({
      changes: { from: 5, to: 9 },
      userEvent: "delete.cut",
    }).state;
    expect(cut.doc.toString()).toBe("One. Three.");
  });

  it("leaves no space before a stop where a sentence's end was cut", () => {
    const state = EditorState.create({
      doc: "He flipped down the hallway. Then left.",
      extensions: scriptEditor({ characters: () => [] }),
    });
    const at = "He flipped".length;
    const cut = state.update({
      changes: { from: at, to: at + " down the hallway".length },
      userEvent: "delete.cut",
    }).state;
    expect(cut.doc.toString()).toBe("He flipped. Then left.");
    const inner = state.update({
      changes: { from: at + 1, to: at + 1 + "down the hallway".length },
      userEvent: "delete.cut",
    }).state;
    expect(inner.doc.toString()).toBe("He flipped. Then left.");
  });

  it("keeps a sound's label as written, pasted or typed", () => {
    const state = EditorState.create({ doc: "", extensions: smartQuotes() });
    const pasted = state.update({
      changes: { from: 0, insert: "He said \"go\" [Knight's armor clanks] and it's done." },
      userEvent: "input.paste",
    }).state;
    expect(pasted.doc.toString()).toBe("He said “go” [Knight's armor clanks] and it’s done.");
    const inside = EditorState.create({ doc: "Then [Knight armor]", extensions: smartQuotes() });
    const intoLabel = inside.update({
      changes: { from: "Then [Knight".length, insert: "'s" },
      userEvent: "input.paste",
    }).state;
    expect(intoLabel.doc.toString()).toBe("Then [Knight's armor]");
  });
});
