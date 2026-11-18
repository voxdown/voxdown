import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { planCharacterRename } from "../src/studio/rename";

describe("safe character-cue rename planner", () => {
  it("changes only cue-name spans and preserves extensions, dual markers and indentation", () => {
    const source =
      "INT. MARA'S ROOM\n\n!MARA enters.\n\n\tMARA (V.O.) (CONT'D)  \nHello MARA.\n\n  @ Mara (O.S.)  ^ \nMARA?\n\n[[MARA stays private.]]";
    const plan = planCharacterRename(source, "Mara", "ANNA");
    expect(plan.changes).toHaveLength(2);
    expect(plan.preview).toEqual([
      { line: 5, before: "\tMARA (V.O.) (CONT'D)  ", after: "\tANNA (V.O.) (CONT'D)  " },
      { line: 8, before: "  @ Mara (O.S.)  ^ ", after: "  @ ANNA (O.S.)  ^ " },
    ]);
    expect(plan.candidate).toBe(
      "INT. MARA'S ROOM\n\n!MARA enters.\n\n\tANNA (V.O.) (CONT'D)  \nHello MARA.\n\n  @ ANNA (O.S.)  ^ \nMARA?\n\n[[MARA stays private.]]",
    );
    expect(plan.skipped).toEqual([]);
  });

  it("uses cast-index Unicode normalization/case identity without normalizing unrelated source", () => {
    const source = "@E\u0301lise (V.O.)\nCafé.\n\n@ÉLISE\nBonjour.\n\n@élise\nOui.";
    const plan = planCharacterRename(source, "ÉLISE", "Zoë");
    expect(plan.changes).toHaveLength(3);
    expect(plan.candidate).toBe("@Zoë (V.O.)\nCafé.\n\n@Zoë\nBonjour.\n\n@Zoë\nOui.");
    expect(planCharacterRename("@小林\n你好", "小林", "王明").candidate).toBe("@王明\n你好");
  });

  it("matches normalized internal whitespace but keeps extensions exactly", () => {
    expect(
      planCharacterRename("@THE\t  MAN (v.o.)\nHello.", "THE MAN", "THE WOMAN").candidate,
    ).toBe("@THE WOMAN (v.o.)\nHello.");
  });

  it("preserves exact BOM and mixed line endings and original-source offsets", () => {
    const source = "\uFEFF@Mara\r\nHello.\r\n\r@MARA (V.O.)\nHi.\r";
    const plan = planCharacterRename(source, "MARA", "Anne-Marie");
    expect(plan.candidate).toBe("\uFEFF@Anne-Marie\r\nHello.\r\n\r@Anne-Marie (V.O.)\nHi.\r");
    expect(plan.changes.map((change) => source.slice(change.from, change.to))).toEqual([
      "Mara",
      "MARA",
    ]);
  });

  it("reports comment-fragmented and formatted cues without rewriting them", () => {
    const source =
      "@MA[[private]]RA\nOne.\n\n@MARA /*secret*/ (V.O.)\nTwo.\n\n@**MARA**\nThree.\n\n@_MARA_\nFour.\n\n@MARA\nFive.";
    const plan = planCharacterRename(source, "MARA", "ANNA");
    expect(plan.changes).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { line: 1, reason: "private-comment" },
      { line: 4, reason: "private-comment" },
      { line: 7, reason: "formatted-or-escaped-name" },
      { line: 10, reason: "formatted-or-escaped-name" },
    ]);
    expect(plan.candidate).toBe(`${source.slice(0, source.lastIndexOf("MARA"))}ANNA\nFive.`);
  });

  it("preserves omission bytes and mapped boundaries after different-length names", () => {
    const source = "[[before]]\n@MARA\nHello. [[within]]\n\n/*between*/\n@MARA\nBye.\n[[after]]";
    const plan = planCharacterRename(source, "MARA", "ALEXANDRIA");
    const before = parseFountain(source);
    const after = parseFountain(plan.candidate);
    expect(after.omissions.map((span) => plan.candidate.slice(span.from, span.to))).toEqual(
      before.omissions.map((span) => source.slice(span.from, span.to)),
    );
    expect(after.elements.map((element) => element.kind)).toEqual(
      before.elements.map((element) => element.kind),
    );
  });

  it("never searches omitted cues, action references, dialogue references or metadata", () => {
    const source =
      "Title: MARA\n\n!MARA\n\n@BOB\nMARA\n\n/*\n@MARA\nSecret.\n*/\n[[MARA]]\n\n@MARA\nHello.";
    const plan = planCharacterRename(source, "MARA", "ANNA");
    expect(plan.preview.map((entry) => entry.line)).toEqual([14]);
    expect(plan.candidate).toBe(`${source.slice(0, source.lastIndexOf("MARA"))}ANNA\nHello.`);
  });

  it.each(["Mara", "INT. ROOM", "EXT. ROAD", "EST. HILL"])(
    "rejects a natural-cue rename that would change roles: %s",
    (name) => {
      expect(() => planCharacterRename("MARA\nHello.", "MARA", name)).toThrow(/interpretation/);
      // Forced cues safely preserve that same spelling and role.
      expect(planCharacterRename("@MARA\nHello.", "MARA", name).candidate).toBe(`@${name}\nHello.`);
    },
  );

  it.each([
    "",
    " ANNA",
    "ANNA ",
    "ANNA\nBOB",
    "ANNA\rBOB",
    "ANNA\tBOB",
    "ANNA\u2028BOB",
    "ANNA\u2029BOB",
    "ANNA\0BOB",
    "ANNA\u202eBOB",
    "ANNA\u2066BOB",
    "ANNA\u200bBOB",
    "@ANNA",
    "I/E. CAR",
    "ANNA (V.O.)",
    "ANNA ^",
    "ANNA [[private]]",
    "ANNA /*private*/",
    "**ANNA**",
    "!ANNA",
    "ANNA:",
    "=ANNA",
    "\\ANNA",
    "A".repeat(201),
  ])("rejects syntax/control characters or invalid new names: %s", (name) => {
    expect(() => planCharacterRename("@MARA\nHello.", "MARA", name)).toThrow(/character name/);
  });

  it("rejects malformed private passages even outside the edited cue", () => {
    for (const privateSource of ["[[unclosed", "/*unclosed"])
      expect(() =>
        planCharacterRename(`@MARA\nHello.\n\n${privateSource}`, "MARA", "ANNA"),
      ).toThrow(/incomplete private/);
  });

  it("returns no-op and missing-name plans honestly and flags cast collisions", () => {
    const source = "@MARA\nHello.\n\n@ANNA\nHi.";
    expect(planCharacterRename(source, "MARA", "MARA").changes).toEqual([]);
    expect(planCharacterRename(source, "BOB", "ANNA").changes).toEqual([]);
    const merging = planCharacterRename(source, "MARA", "ANNA");
    expect(merging.targetAlreadyExists).toBe(true);
    expect(merging.changes).toHaveLength(1);
    expect(planCharacterRename(source, "MARA", "BOB").targetAlreadyExists).toBe(false);
  });

  it("applies every cue as one atomic editor change set with exact one-step undo", () => {
    const source = "@MARA\nHello.\n\nMARA (O.S.)\nBye.";
    const plan = planCharacterRename(source, "MARA", "ALEX");
    const target = {
      state: EditorState.create({ doc: source, extensions: [history()] }),
      dispatch(transaction: Transaction) {
        target.state = transaction.state;
      },
    };
    target.dispatch(target.state.update({ changes: plan.changes, userEvent: "input.rename" }));
    expect(target.state.doc.toString()).toBe(plan.candidate);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(source);
  });

  it("handles thousands of cues/omissions without losing offsets or unrelated bytes", () => {
    const source = "@MARA (V.O.)\nHello [[secret]].\n\n".repeat(3_000);
    const plan = planCharacterRename(source, "MARA", "ALEXANDRIA");
    expect(plan.changes).toHaveLength(3_000);
    expect(plan.candidate).toBe(source.replaceAll("@MARA", "@ALEXANDRIA"));
  });

  it("rejects expansion beyond the document size limit", () => {
    const source = `@A\n${"word ".repeat(99_997)}`;
    expect(source.length).toBeLessThan(500_000);
    expect(() => planCharacterRename(source, "A", "B".repeat(200))).toThrow(/500,000/);
  });
});
