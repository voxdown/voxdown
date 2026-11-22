import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { listSceneCards, planSceneSynopsis } from "../src/studio/scene-edits";

describe("portable scene synopsis edits", () => {
  it("adds after the heading, preserving title, numbering, notes, sections and body", () => {
    const source =
      "Title: Film\n\n# Act\n\nINT. HOUSE #12A# [[private heading]]\n[[private note]]\n\n!Action.\n\n# Next\n= Act synopsis\n\nEXT. PARK\n!Rain.";
    const plan = planSceneSynopsis(source, 0, "Mara arrives.\nShe changes her mind.");
    expect(plan.candidate).toBe(
      source.replace(
        "\n[[private note]]",
        "\n= Mara arrives.\n= She changes her mind.\n[[private note]]",
      ),
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.preview.before).toBe("");
    expect(plan.preview.after).toBe("\n= Mara arrives.\n= She changes her mind.");
  });
  it.each(["\n", "\r\n", "\r"])("preserves %j newlines and a BOM", (nl) => {
    const source = `\uFEFFINT. HOUSE${nl}= Old${nl}= Second${nl}${nl}!Action.`;
    const plan = planSceneSynopsis(source, 0, "New\nSecond new");
    expect(plan.candidate).toBe(`\uFEFFINT. HOUSE${nl}= New${nl}= Second new${nl}${nl}!Action.`);
    expect(plan.preview.before).toBe(`= Old${nl}= Second`);
  });
  it("handles heading-only EOF with and without a terminal newline", () => {
    expect(planSceneSynopsis("INT. HOUSE", 0, "Arrive").candidate).toBe("INT. HOUSE\n= Arrive");
    expect(planSceneSynopsis("INT. HOUSE\n", 0, "Arrive").candidate).toBe("INT. HOUSE\n= Arrive\n");
    expect(planSceneSynopsis("INT. HOUSE\n= Old", 0, "New").candidate).toBe("INT. HOUSE\n= New");
  });
  it("removes an entire block without changing following action interpretation", () => {
    const source = "INT. HOUSE\n= Old\n= More\nMARA\nWalks.";
    expect(planSceneSynopsis(source, 0, "").candidate).toBe("INT. HOUSE\nMARA\nWalks.");
    expect(planSceneSynopsis("INT. HOUSE\n= Old", 0, "").candidate).toBe("INT. HOUSE\n");
  });
  it("removes an existing empty synopsis block when cleared", () => {
    expect(planSceneSynopsis("INT. HOUSE\n= \n\n!Action.", 0, "").candidate).toBe(
      "INT. HOUSE\n\n!Action.",
    );
    expect(planSceneSynopsis("INT. HOUSE\n= \n= \n\n!Action.", 0, "").candidate).toBe(
      "INT. HOUSE\n\n!Action.",
    );
    expect(planSceneSynopsis("INT. HOUSE", 0, "").changes).toEqual([]);
  });
  it("keeps exact existing spelling for unchanged public text", () => {
    const source = "INT. HOUSE\n  =    Old  \n= Second\n\n!Action.";
    const plan = planSceneSynopsis(source, 0, listSceneCards(source)[0]?.synopsis ?? "");
    expect(plan.changes).toEqual([]);
    expect(plan.candidate).toBe(source);
  });
  it("supports internal blank lines, Unicode, and text that looks like Fountain syntax", () => {
    const plan = planSceneSynopsis(
      "INT. HOUSE\n\n!Action.",
      0,
      "Éloïse enters.\n\n# Act\n===\n@MARA",
    );
    expect(listSceneCards(plan.candidate)[0]?.synopsis).toBe("Éloïse enters.\n\n# Act\n===\n@MARA");
  });
  it.each(["= Old [[secret]]", "= Old /*secret*/", "= Old\n[[secret]]\n= More", "= Old\n\n= More"])(
    "refuses private or dispersed source %j",
    (block) => {
      expect(() => planSceneSynopsis(`INT. HOUSE\n${block}\n\n!Action.`, 0, "Replacement")).toThrow(
        /private comment|separate synopsis blocks/,
      );
    },
  );
  it("refuses omissions spanning the insertion point and malformed private passages", () => {
    expect(() => planSceneSynopsis("INT. HOUSE [[start\nend]]\n!Action.", 0, "New")).toThrow(
      /private passage/,
    );
    expect(() => planSceneSynopsis("INT. HOUSE\n[[unfinished", 0, "New")).toThrow(
      /incomplete private/,
    );
  });
  it.each(["[[secret]]", "/*secret*/", "end]]", "\u202Ehidden", "\u0000", "\u000B", "\uD800"])(
    "rejects unsafe input %j",
    (text) => {
      expect(() => planSceneSynopsis("INT. HOUSE", 0, text)).toThrow(
        /control characters|private-comment/,
      );
    },
  );
  it("bounds size, line count and invalid indexes", () => {
    expect(() => planSceneSynopsis("INT. HOUSE", 0, "x".repeat(10001))).toThrow(/10,000/);
    expect(() => planSceneSynopsis("INT. HOUSE", 0, Array(101).fill("x").join("\n"))).toThrow(
      /100 lines/,
    );
    expect(() => planSceneSynopsis(`INT. HOUSE\n= ${"x".repeat(10001)}`, 0, "New")).toThrow(
      /too long/,
    );
    expect(() => planSceneSynopsis("INT. HOUSE", -1, "New")).toThrow(/Choose a scene/);
  });
  it("makes an atomic edit with one-step undo", () => {
    const source = "INT. HOUSE\n= Old\n\n!Action.";
    const plan = planSceneSynopsis(source, 0, "New\nMore");
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
  it("edits one scene in a long source without changing thousands of private spans", () => {
    const scenes = Array.from(
      { length: 2000 },
      (_, i) => `INT. ROOM ${i}\n\n!Action [[secret${i}]].`,
    );
    const source = scenes.join("\n\n");
    const plan = planSceneSynopsis(source, 1999, "Last scene");
    expect(plan.candidate).toBe(
      source.replace("INT. ROOM 1999\n", "INT. ROOM 1999\n= Last scene\n"),
    );
  });
});
