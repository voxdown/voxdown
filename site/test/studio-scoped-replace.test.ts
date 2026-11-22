import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { type ReplaceOptions, planScopedReplace } from "../src/studio/scoped-replace";

const defaults: ReplaceOptions = {
  query: "light",
  replacement: "lamp",
  scope: "screenplay",
  caseSensitive: true,
  wholeWord: false,
  position: 0,
  selection: { from: 0, to: 0 },
};
const plan = (source: string, options: Partial<ReplaceOptions> = {}) =>
  planScopedReplace(source, { ...defaults, ...options });
const source =
  "Title: light\n\n# light\n= light\n\nINT. ROOM - DAY\n\n!A light [[private light]] and light.\n\n@MARA\nA light.\n(near the light)\n~light\n\n/*light*/\nEXT. ROAD - DAY\n\n!Another light.";
describe("scoped literal replacement", () => {
  it("searches only printable source while leaving private/title/outline exact and out of preview", () => {
    const result = plan(source);
    expect(result.changes).toHaveLength(6);
    expect(result.candidate).toContain("Title: light\n\n# light\n= light");
    expect(result.candidate).toContain("[[private light]]");
    expect(result.candidate).toContain("/*light*/");
    expect(JSON.stringify(result.preview)).not.toContain("private light");
    expect(result.candidate).toContain("(near the lamp)");
  });
  it("limits dialogue to spoken lines and action to action elements", () => {
    const dialogue = plan(source, { scope: "dialogue" });
    expect(dialogue.changes).toHaveLength(1);
    expect(dialogue.candidate).toContain("(near the light)\n~light");
    const action = plan(source, { scope: "action" });
    expect(action.changes).toHaveLength(3);
    expect(action.candidate).toContain("@MARA\nA light.");
  });
  it("limits current scene and resets scene ownership at section boundaries", () => {
    expect(
      plan(source, { scope: "scene", position: source.indexOf("@MARA") }).changes,
    ).toHaveLength(5);
    expect(plan(source, { scope: "scene", position: source.indexOf("EXT.") }).changes).toHaveLength(
      1,
    );
    expect(() => plan(source, { scope: "scene", position: 0 })).toThrow(/caret inside a scene/);
    const split = "INT. ROOM\n\n!light\n\n# Act two\n= light\n\nEXT. ROAD\n!light";
    expect(() => plan(split, { scope: "scene", position: split.indexOf("= light") })).toThrow(
      /caret inside a scene/,
    );
  });
  it("respects exact selected spans and still excludes private text", () => {
    const from = source.indexOf("A light");
    const to = source.indexOf("@MARA");
    expect(plan(source, { scope: "selection", selection: { from, to } }).changes).toHaveLength(2);
    const fragment = "!dragon dragon";
    expect(
      plan(fragment, {
        query: "dragon",
        scope: "selection",
        selection: { from: 2, to: fragment.length },
      }).changes,
    ).toHaveLength(1);
  });
  it("does not match across lines or omitted source", () => {
    expect(plan("!dra[[secret]]gon", { query: "dragon" }).matches).toBe(0);
    expect(plan("!dra\ngon", { query: "dragon" }).matches).toBe(0);
    expect(() => plan("!dragon", { query: "dra\ngon" })).toThrow(/single-line/);
  });
  it("treats regex syntax literally and replacement dollar signs as ordinary text", () => {
    expect(plan("!a.b aXb [x]", { query: "a.b", replacement: "$&" }).candidate).toBe("!$& aXb [x]");
    expect(plan("!a+b aab", { query: "a+b", replacement: "sum" }).candidate).toBe("!sum aab");
    expect(plan("!a\\b", { query: "a\\b", replacement: "path" }).candidate).toBe("!path");
  });
  it("finds nonoverlapping matches only and recognizes no-op replacements", () => {
    expect(plan("!aaaa", { query: "aa", replacement: "b" }).candidate).toBe("!bb");
    const unchanged = plan("!light light", { replacement: "light" });
    expect(unchanged.matches).toBe(2);
    expect(unchanged.changes).toEqual([]);
    expect(unchanged.preview).toEqual([]);
  });
  it("supports Unicode case-insensitive offsets without lowercase expansion corruption", () => {
    const text = "!İstanbul LIGHT light Kelvin kelvin 𐐀 𐐨";
    const result = plan(text, { caseSensitive: false });
    expect(result.candidate).toBe("!İstanbul lamp lamp Kelvin kelvin 𐐀 𐐨");
    expect(
      plan(text, { query: "kelvin", replacement: "temperature", caseSensitive: false }).changes,
    ).toHaveLength(2);
    expect(
      plan(text, { query: "𐐀", replacement: "letter", caseSensitive: false }).candidate.endsWith(
        "letter letter",
      ),
    ).toBe(true);
  });
  it("checks Unicode whole-word boundaries, including adjacent text across private omissions", () => {
    expect(
      plan("!light lighting delight light_ xlight lighté light𐐀 light.", { wholeWord: true })
        .changes,
    ).toHaveLength(2);
    expect(
      plan("!dra[[secret]]gon dra [[secret]] gon", { query: "dra", wholeWord: true }).changes,
    ).toHaveLength(1);
    expect(
      plan("!dra[[secret]]gon dra [[secret]] gon", { query: "gon", wholeWord: true }).changes,
    ).toHaveLength(1);
    expect(plan("!élight light", { wholeWord: true }).changes).toHaveLength(1);
  });
  it("treats physical newlines inside private comments as word boundaries", () => {
    const text = "!dra[[secret\ncontinued]]gon";
    expect(plan(text, { query: "dra", wholeWord: true }).matches).toBe(1);
    expect(plan(text, { query: "gon", wholeWord: true }).matches).toBe(1);
  });
  it("never treats a selection boundary as a whole-word boundary", () => {
    expect(
      plan("!delight", { scope: "selection", selection: { from: 3, to: 8 }, wholeWord: true })
        .matches,
    ).toBe(0);
  });
  it("preserves BOM and mixed newline bytes outside literal replacement spans", () => {
    expect(plan("\uFEFF!light\r\n\r\n@MARA\rA light.").candidate).toBe(
      "\uFEFF!lamp\r\n\r\n@MARA\rA lamp.",
    );
  });
  it.each(["[[hidden]]", "/*hidden*/", "[[unfinished", "/*unfinished"])(
    "refuses new private syntax: %s",
    (replacement) => {
      expect(() => plan("!light", { replacement })).toThrow(/private/);
    },
  );
  it("refuses structural reinterpretation, dual marker changes and scene-number changes", () => {
    expect(() => plan("MARA\nHello.", { query: "MARA", replacement: "Mara" })).toThrow(/structure/);
    expect(() => plan("@MARA\nHello.", { query: "MARA", replacement: "MARA ^" })).toThrow(
      /structure/,
    );
    expect(() => plan("INT. ROOM #1#\n\n!Hello.", { query: "#1#", replacement: "#2#" })).toThrow(
      /structure/,
    );
    expect(() => plan("!light", { query: "!light", replacement: ".ROOM" })).toThrow(/structure/);
  });
  it("does not alter escaped comment syntax into completed omissions", () => {
    expect(() => plan("!\\[[secret]]", { query: "\\", replacement: "" })).toThrow(/private/);
  });
  it("refuses malformed original source before searching", () => {
    expect(() => plan("!light [[unfinished")).toThrow(/Close unfinished/);
  });
  it.each(["", "x".repeat(1001), "a\nb", "a\rb", "a\u2028b", "a\0b", "\uD800", "\uDC00"])(
    "rejects invalid search %j",
    (query) => {
      expect(() => plan(source, { query })).toThrow(/single-line search/);
    },
  );
  it.each(["x".repeat(2001), "a\nb", "a\rb", "a\u2029b", "a\0b", "\uD800", "\uDC00"])(
    "rejects invalid replacement %j",
    (replacement) => {
      expect(() => plan(source, { replacement })).toThrow(/single-line search/);
    },
  );
  it.each([
    { from: 0, to: 0 },
    { from: -1, to: 2 },
    { from: 2, to: 1 },
    { from: 0, to: 5000 },
    { from: 0.5, to: 2 },
  ])("rejects invalid selection %j", (selection) => {
    expect(() => plan(source, { scope: "selection", selection })).toThrow(/nonempty text range/);
  });
  it("caps match count without silently preparing a partial replacement and caps preview at 50", () => {
    const result = plan(`!${"light ".repeat(1000)}`);
    expect(result.changes).toHaveLength(1000);
    expect(result.preview).toHaveLength(50);
    expect(() => plan(`!${"light ".repeat(10001)}`)).toThrow(/More than 10,000/);
    expect(() => plan(`!${"light ".repeat(10001)}`, { replacement: "light" })).toThrow(
      /More than 10,000/,
    );
  });
  it("checks candidate size before allocating a large expanded document", () => {
    expect(() => plan(`!${"light ".repeat(10000)}`, { replacement: "x".repeat(2000) })).toThrow(
      /500,000-character/,
    );
  });
  it("applies all changes atomically with one-step undo", () => {
    const result = plan(source);
    const target = {
      state: EditorState.create({ doc: source, extensions: [history()] }),
      dispatch(transaction: Transaction) {
        target.state = transaction.state;
      },
    };
    target.dispatch(target.state.update({ changes: result.changes, userEvent: "input.replace" }));
    expect(target.state.doc.toString()).toBe(result.candidate);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(source);
  });
});
