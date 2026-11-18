import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { planSceneNumbering, sceneNumberingSummary } from "../src/studio/scene-numbering";
const scenes = (...headings: string[]) => headings.map((h) => `${h}\n\n!Action.`).join("\n\n");
describe("explicit safe scene numbering", () => {
  it("defaults after the highest existing integer label and preserves all existing labels", () => {
    const source = scenes("INT. A #005#", "EXT. B", ".C #12A#", ".D #2#", ".E");
    const summary = sceneNumberingSummary(source);
    expect(summary).toMatchObject({ scenes: 5, numbered: 3, eligible: 5, suggestedStart: 6 });
    const plan = planSceneNumbering(source, { mode: "unnumbered" });
    expect(plan.preserved).toBe(3);
    expect(plan.preview.map((p) => p.number)).toEqual(["6", "7"]);
    expect(plan.candidate).toBe(
      source.replace("EXT. B\n", "EXT. B #6#\n").replace(".E\n", ".E #7#\n"),
    );
  });
  it("avoids numeric-equivalent collisions including preserved zero-padded labels", () => {
    const source = scenes("INT. A #001#", ".B #3#", ".C #A2#", ".D", ".E");
    expect(
      planSceneNumbering(source, { mode: "unnumbered", start: 1 }).preview.map((p) => p.number),
    ).toEqual(["2", "4"]);
  });
  it("renumbers eligible headings in source order and reserves labels on skipped headings", () => {
    const source = scenes("INT. A #12A#", "EXT. B [[private]] #01#", ".C #9#", ".D");
    const plan = planSceneNumbering(source, { mode: "renumber" });
    expect(plan.preview.map((p) => p.number)).toEqual(["2", "3", "4"]);
    expect(plan.skipped).toEqual([{ line: 5, reason: "private-comment" }]);
    expect(plan.candidate).toContain("[[private]] #01#");
    expect(plan.preserved).toBe(1);
  });
  it.each(["\n", "\r\n", "\r"])(
    "preserves BOM, indentation, trailing whitespace and %j endings",
    (nl) => {
      const source = `\uFEFF  INT. A  #20# \t${nl}${nl}!Action. [[private body]]${nl}${nl}\t.B  \t`;
      const plan = planSceneNumbering(source, { mode: "renumber", start: 4 });
      expect(plan.candidate).toBe(
        `\uFEFF  INT. A  #4# \t${nl}${nl}!Action. [[private body]]${nl}${nl}\t.B #5#  \t`,
      );
    },
  );
  it("preserves title, sections, synopses, dialogue and source spelling outside number spans", () => {
    const source =
      "Title: Film\nAuthor: Writer\n\n# Act\n= Outline\n\nINT. A\n= Synopsis\n\n@MARA\nA #12# reference.\n\n[[private]]\n\n.Heading #9#\n\n===\n!Action.";
    const plan = planSceneNumbering(source, { mode: "unnumbered" });
    expect(plan.candidate).toBe(source.replace("INT. A\n", "INT. A #10#\n"));
    expect(parseFountain(plan.candidate).elements.map((e) => [e.kind, e.text])).toEqual(
      parseFountain(source).elements.map((e) => [e.kind, e.text]),
    );
  });
  it("skips private, formatted and escaped headings without leaking private text into preview", () => {
    const source = scenes("INT. A [[SECRET]]", ".B *styled*", ".C \\*literal\\*", ".D");
    const plan = planSceneNumbering(source, { mode: "unnumbered" });
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "private-comment",
      "formatted-or-escaped",
      "formatted-or-escaped",
    ]);
    expect(plan.preview).toHaveLength(1);
    expect(JSON.stringify(plan.preview)).not.toContain("SECRET");
    expect(plan.candidate).toContain("[[SECRET]]");
  });
  it("preserves a private passage crossing a heading boundary and adjusts omission offsets exactly", () => {
    const source = "INT. A\n\n!Action.\n\n/*private\n*/.B\n\n!Action.\n\n.C";
    const plan = planSceneNumbering(source, { mode: "unnumbered" });
    expect(plan.skipped).toEqual([{ line: 6, reason: "private-comment" }]);
    expect(plan.preview.map((p) => p.number)).toEqual(["1", "2"]);
  });
  it("reports preserved duplicates and uses newly assigned collision-free labels", () => {
    const plan = planSceneNumbering(scenes(".A #01#", ".B #1#", ".C"), {
      mode: "unnumbered",
      start: 1,
    });
    expect(plan.warnings.join(" ")).toContain("1 duplicate existing");
    expect(plan.preview[0]?.number).toBe("2");
  });
  it("returns an empty change set when labels already match or no eligible scene needs labels", () => {
    expect(planSceneNumbering(scenes(".A #1#", ".B #2#"), { mode: "renumber" }).changes).toEqual(
      [],
    );
    expect(planSceneNumbering("!No scenes.", { mode: "unnumbered" }).changes).toEqual([]);
  });
  it("bounds starts and never rounds or collides with huge preexisting labels", () => {
    for (const start of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => planSceneNumbering("INT. A", { mode: "unnumbered", start })).toThrow(
        /positive whole/,
      );
    const source = scenes(".A #9007199254740992#", ".B");
    expect(sceneNumberingSummary(source).suggestedStart).toBeUndefined();
    expect(() => planSceneNumbering(source, { mode: "unnumbered" })).toThrow(/explicit starting/);
    expect(planSceneNumbering(source, { mode: "unnumbered", start: 1 }).preview[0]?.number).toBe(
      "1",
    );
    expect(() =>
      planSceneNumbering(scenes(".A", ".B"), { mode: "renumber", start: Number.MAX_SAFE_INTEGER }),
    ).toThrow(/exceed/);
  });
  it.each([
    "/* outer\n/* inner */\nINT. SECRET ROOM\n*/\n\nINT. PUBLIC ROOM",
    "[[outer [[inner]]\nINT. SECRET ROOM\n]]\n\nINT. PUBLIC ROOM",
  ])("blocks ambiguous nested private headings in summary and plans", (source) => {
    expect(() => sceneNumberingSummary(source)).toThrow(/Nested private/);
    expect(() => planSceneNumbering(source, { mode: "unnumbered" })).toThrow(/Nested private/);
  });
  it("refuses malformed omissions and oversized sources", () => {
    expect(() => planSceneNumbering("INT. A\n[[unfinished", { mode: "unnumbered" })).toThrow(
      /incomplete private/,
    );
    expect(() => planSceneNumbering("!".repeat(500001), { mode: "unnumbered" })).toThrow(/500,000/);
  });
  it("applies all heading labels with one-step undo", () => {
    const source = scenes(".A", ".B #12A#", ".C");
    const plan = planSceneNumbering(source, { mode: "renumber" });
    const target = {
      state: EditorState.create({ doc: source, extensions: [history()] }),
      dispatch(transaction: Transaction) {
        target.state = transaction.state;
      },
    };
    target.dispatch(target.state.update({ changes: plan.changes }));
    expect(target.state.doc.toString()).toBe(plan.candidate);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(source);
  });
  it("numbers thousands of scenes with bounded source-order validation", () => {
    const source = scenes(...Array.from({ length: 3000 }, (_, i) => `.ROOM ${i}`));
    const plan = planSceneNumbering(source, { mode: "unnumbered" });
    expect(plan.changes).toHaveLength(3000);
    expect(plan.preview.at(-1)?.number).toBe("3000");
  });
});
