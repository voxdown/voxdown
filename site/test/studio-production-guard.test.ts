import { history, redo, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import * as fountain from "../src/studio/fountain";
import { productionGuard, productionNumberingAction } from "../src/studio/production-guard";
import {
  planCommitSceneNumber,
  planLock,
  readProduction,
} from "../src/studio/production-numbering";

function editor(doc: string, lock = true) {
  let blocked = 0;
  let state = EditorState.create({
    doc: lock ? planLock(doc, true).candidate : doc,
    extensions: [history(), productionGuard(() => blocked++)],
  });
  return {
    get text() {
      return state.doc.toString();
    },
    get blocked() {
      return blocked;
    },
    edit(from: number, to: number, insert: string, explicit = false) {
      state = state.update({
        changes: { from, to, insert },
        annotations: explicit ? productionNumberingAction.of(true) : [],
      }).state;
    },
    apply(plan: ReturnType<typeof planLock>) {
      state = state.update({
        changes: plan.changes,
        annotations: productionNumberingAction.of(true),
      }).state;
    },
    undo() {
      return undo({
        state,
        dispatch: (tr: Transaction) => {
          state = tr.state;
        },
      });
    },
    redo() {
      return redo({
        state,
        dispatch: (tr: Transaction) => {
          state = tr.state;
        },
      });
    },
  };
}
const source = "INT. HOUSE - DAY #15#\n\nRain falls.\n\nEXT. ROAD - NIGHT #16#\n\nWind blows.";
describe("production label editing guard", () => {
  it("does not parse ordinary typing or Enter away from scene headings", () => {
    const parse = vi.spyOn(fountain, "parseFountain");
    try {
      const e = editor(`${source}\n\n${"Ordinary prose.\n".repeat(19000)}`);
      parse.mockClear();
      const at = e.text.indexOf("Ordinary prose.") + 500;
      e.edit(at, at, "More");
      e.edit(at + 4, at + 4, "\n");
      expect(parse).not.toHaveBeenCalled();
      expect(e.blocked).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });
  it("cannot create an unreserved label by turning an action into a scene", () => {
    const e = editor(`${source}\n\nCAFE - DAY #17#`);
    const at = e.text.indexOf("CAFE");
    const before = e.text;
    e.edit(at, at, "INT. ");
    expect(e.text).toBe(before);
    expect(e.blocked).toBe(1);
  });

  it("allows prose, heading words and ordinary line breaks while retaining locked labels", () => {
    const e = editor(source);
    const start = e.text.indexOf("Rain");
    e.edit(start, start + 4, "Snow");
    e.edit(e.text.indexOf("falls.") + 6, e.text.indexOf("falls.") + 6, "\nAnother line.");
    const house = e.text.indexOf("HOUSE");
    e.edit(house, house + 5, "HOTEL");
    expect(e.text).toContain("INT. HOTEL - DAY #15#");
    expect(e.text).toContain("Snow falls.\nAnother line.");
    expect(e.blocked).toBe(0);
  });
  it("rejects replacing a digit, deleting a delimiter, or manually adding a new label", () => {
    const e = editor(`${source}\n\nINT. CAFE - DAY`);
    const original = e.text;
    e.edit(e.text.indexOf("15"), e.text.indexOf("15") + 1, "2");
    e.edit(e.text.indexOf("#15#"), e.text.indexOf("#15#") + 1, "");
    const cafe = e.text.indexOf("INT. CAFE - DAY") + "INT. CAFE - DAY".length;
    e.edit(cafe, cafe, " #17#");
    expect(e.text).toBe(original);
    expect(e.blocked).toBe(3);
  });
  it("protects metadata and its delimiters, allowing edits immediately outside it", () => {
    const e = editor(source);
    const original = e.text;
    const at = e.text.indexOf("/* VoxDown");
    e.edit(at, e.text.length, "");
    e.edit(e.text.indexOf("reserved"), e.text.indexOf("reserved") + 1, "X");
    e.edit(at + 1, at + 1, "X");
    expect(e.text).toBe(original);
    e.edit(e.text.length, e.text.length, "\n\nMore prose.");
    expect(e.text.endsWith("More prose.")).toBe(true);
    expect(e.blocked).toBe(3);
  });
  it("allows whole numbered heading deletion and preserves its reservation across undo/redo", () => {
    const e = editor(source);
    const original = e.text;
    e.edit(0, source.indexOf("\n") + 1, "");
    expect(e.text).not.toContain("#15#");
    expect(readProduction(e.text).reserved).toContain("15");
    expect(e.undo()).toBe(true);
    expect(e.text).toBe(original);
    expect(e.redo()).toBe(true);
    expect(e.text).not.toContain("#15#");
    expect(e.blocked).toBe(0);
  });
  it("reserves externally assigned imported labels atomically when deleting their headings", () => {
    const locked = planLock(source, true).candidate.replace(
      "/* VoxDown",
      "INT. ADDED ELSEWHERE #17#\n\n/* VoxDown",
    );
    const e = editor(locked, false);
    const at = e.text.indexOf("INT. ADDED");
    e.edit(at, at + "INT. ADDED ELSEWHERE #17#".length, "");
    expect(e.text).not.toContain("#17#");
    expect(readProduction(e.text).reserved).toContain("17");
    expect(e.blocked).toBe(0);
    e.undo();
    expect(e.text).toBe(locked);
    e.redo();
    expect(readProduction(e.text).reserved).toContain("17");
  });
  it("allows complete scene reordering but refuses replacement renumbering", () => {
    const e = editor(source);
    const split = source.indexOf("EXT.");
    const reordered = `${source.slice(split)}\n\n${source.slice(0, split).trimEnd()}`;
    const suffix = e.text.slice(source.length);
    e.edit(0, e.text.length, reordered + suffix);
    expect(e.text.startsWith("EXT.")).toBe(true);
    const previous = e.text;
    e.edit(0, reordered.length, reordered.replace("#16#", "#20#"));
    expect(e.text).toBe(previous);
    expect(e.blocked).toBe(1);
  });
  it("rejects comment edits that swallow numbered headings, but permits private prose notes", () => {
    const e = editor(source);
    const original = e.text;
    e.edit(0, 0, "/*\n");
    // An unclosed comment stays printable in Fountain, so close it around the heading.
    if (e.text !== original) e.edit(e.text.indexOf("\n\nRain"), e.text.indexOf("\n\nRain"), "\n*/");
    expect(e.text).toContain("#15#");
    expect(e.blocked).toBeGreaterThan(0);
    const p = editor(source);
    const rain = p.text.indexOf("Rain");
    p.edit(rain, rain, "[[");
    p.edit(p.text.indexOf("falls.") + 6, p.text.indexOf("falls.") + 6, "]]");
    expect(p.text).toContain("[[Rain falls.]]");
    expect(p.blocked).toBe(0);
  });
  it("accepts explicitly committed suggestions and guards their new labels", () => {
    const e = editor(`${source}\n\nINT. CAFE - DAY`);
    const line = e.text.slice(0, e.text.indexOf("INT. CAFE")).split("\n").length;
    e.apply(planCommitSceneNumber(e.text, line));
    expect(e.text).toContain("INT. CAFE - DAY #17#");
    expect(readProduction(e.text).reserved).toContain("17");
    const at = e.text.indexOf("#17#");
    e.edit(at + 1, at + 2, "2");
    expect(e.text).toContain("#17#");
    expect(e.blocked).toBe(1);
    e.apply(planLock(e.text, false));
    e.edit(at + 1, at + 2, "2");
    expect(e.text).toContain("#27#");
  });
  it("fails closed on malformed imported metadata without blocking ordinary writing", () => {
    const e = editor(`${source}\n\n/* VoxDown production v9\n{"reserved":42}\n*/`, false);
    const at = e.text.indexOf("#15#");
    e.edit(at + 1, at + 2, "2");
    expect(e.text).toContain("#15#");
    const rain = e.text.indexOf("Rain");
    e.edit(rain, rain + 4, "Snow");
    expect(e.text).toContain("Snow falls.");
    expect(e.blocked).toBe(1);
  });
});
