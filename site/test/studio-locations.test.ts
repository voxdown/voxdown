import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { locationDirectory, planLocationRename } from "../src/studio/locations";

describe("conservative location directory and rename", () => {
  it("groups explicit locations across prefixes, times, case and Unicode normalization", () => {
    const source =
      "INT. CAFÉ - DAY\n\n!A.\n\nEXT. Cafe\u0301 - NIGHT\n\n!B.\n\nINT./EXT. CAFÉ - CONTINUOUS\n\n!C.\n\nI/E. CAFÉ - MORNING\n\n!D.";
    const directory = locationDirectory(source);
    expect(directory.locations).toHaveLength(1);
    expect(directory.locations[0]?.name).toBe("CAFÉ");
    expect(directory.locations[0]?.appearances.map((row) => row.prefix)).toEqual([
      "INT.",
      "EXT.",
      "INT./EXT.",
      "I/E.",
    ]);
    expect(directory.excluded).toEqual([]);
    const plan = planLocationRename(source, "café", "BISTRO");
    expect(plan.changes).toHaveLength(4);
    expect(plan.candidate).toContain("INT./EXT. BISTRO - CONTINUOUS");
    expect(plan.candidate).toContain("EXT. BISTRO - NIGHT");
  });

  it("preserves forced markers, exact spacing, time extensions and scene numbers", () => {
    const source =
      "  .INT./EXT.  JOHN’S HOUSE - LATE NIGHT (FLASHBACK) #12A#  \n\n!A.\n\n\t.ext. JOHN’S HOUSE\t-\tDAY #2#\n\n!B.";
    const plan = planLocationRename(source, "JOHN’S HOUSE", "ST. MARY’S (LOBBY)");
    expect(plan.candidate).toBe(
      "  .INT./EXT.  ST. MARY’S (LOBBY) - LATE NIGHT (FLASHBACK) #12A#  \n\n!A.\n\n\t.ext. ST. MARY’S (LOBBY)\t-\tDAY #2#\n\n!B.",
    );
    expect(plan.changes.map((change) => source.slice(change.from, change.to))).toEqual([
      "JOHN’S HOUSE",
      "JOHN’S HOUSE",
    ]);
  });

  it("uses only the last spaced separator and rejects unknown final time labels", () => {
    const source =
      "INT. HOUSE - KITCHEN - DAY\n\n!A.\n\nEXT. HOUSE - KITCHEN - NIGHT\n\n!B.\n\nINT. HOUSE - WEST WING\n\n!C.\n\n.INT. HOUSE - DAY - FLASHBACK\n\n!D.";
    const directory = locationDirectory(source);
    expect(directory.locations.map((location) => location.name)).toEqual(["HOUSE - KITCHEN"]);
    expect(directory.excluded.map((entry) => entry.reason)).toEqual([
      "ambiguous-time",
      "ambiguous-time",
    ]);
    expect(planLocationRename(source, "HOUSE - KITCHEN", "HOUSE - BEDROOM").changes).toHaveLength(
      2,
    );
  });

  it("lists forced unqualified, formatted, escaped and private headings as exclusions", () => {
    const source =
      ".A STRANGE DREAM\n\n!A.\n\nINT. **HOUSE** - DAY\n\n!B.\n\nINT. HO[[private]]USE - DAY\n\n!C.\n\nINT. HOUSE\\_ - DAY\n\n!D.\n\nINT. HOUSE - DAY\n\n!E.";
    const directory = locationDirectory(source);
    expect(directory.locations[0]?.appearances).toHaveLength(1);
    expect(directory.excluded.map((row) => row.reason)).toEqual([
      "unqualified-heading",
      "formatted-or-escaped",
      "private-comment",
      "formatted-or-escaped",
    ]);
    const plan = planLocationRename(source, "HOUSE", "CABIN");
    expect(plan.changes).toHaveLength(1);
    expect(plan.excluded).toHaveLength(4);
    expect(plan.candidate).toContain("HO[[private]]USE");
  });

  it("keeps original BOM and mixed newline bytes while preserving nonheading references", () => {
    const source =
      "\uFEFFINT. HOUSE - DAY\r\n\r\n!HOUSE is old.\r\n\r\n@MARA\rHOUSE.\n\nEXT. HOUSE - NIGHT\r\n\r\n[[HOUSE stays private]]";
    const plan = planLocationRename(source, "HOUSE", "CABIN");
    expect(plan.candidate).toBe(
      "\uFEFFINT. CABIN - DAY\r\n\r\n!HOUSE is old.\r\n\r\n@MARA\rHOUSE.\n\nEXT. CABIN - NIGHT\r\n\r\n[[HOUSE stays private]]",
    );
  });

  it("reports collisions and supports literal punctuation and scripts without case", () => {
    const source = "INT. 小林の家 - DAY\n\n!A.\n\nEXT. 王の家 - NIGHT\n\n!B.";
    expect(planLocationRename(source, "小林の家", "王の家").targetAlreadyExists).toBe(true);
    expect(planLocationRename(source, "小林の家", "王の家: ROOM 2/A").candidate).toContain(
      "INT. 王の家: ROOM 2/A - DAY",
    );
  });

  it.each([
    "",
    " HOUSE",
    "HOUSE ",
    "HOUSE\nEXT. ROAD",
    "HOUSE\rROAD",
    "HOUSE\tROOM",
    "HOUSE\u2028ROOM",
    "HOUSE\u202eROOM",
    "HOUSE\u2066ROOM",
    "HOUSE\0",
    "[[secret]]",
    "HOUSE #2#",
    "HOUSE *",
    "@HOUSE",
    "INT. HOUSE",
    "EXT./INT. HOUSE",
    "A".repeat(201),
  ])("rejects unsafe destination %s", (name) => {
    expect(() => planLocationRename("INT. HOUSE - DAY\n\n!A.", "HOUSE", name)).toThrow(
      /location name/,
    );
  });

  it("rejects introducing a new time-boundary ambiguity into a heading without a time", () => {
    expect(() => planLocationRename("INT. HOUSE\n\n!A.", "HOUSE", "CABIN - NIGHT")).toThrow(
      /boundary ambiguous/,
    );
    expect(() => planLocationRename("INT. HOUSE\n\n!A.", "HOUSE", "CABIN - WEST WING")).toThrow(
      /boundary ambiguous/,
    );
  });

  it("excludes stacked time labels instead of treating DAY as a location suffix", () => {
    expect(locationDirectory("INT. HOUSE - DAY - CONTINUOUS\n\n!A.").excluded[0]?.reason).toBe(
      "ambiguous-time",
    );
  });

  it("shows incomplete-comment warnings but refuses every rename until fixed", () => {
    const source = "INT. HOUSE - DAY\n\n!A.\n[[unclosed";
    expect(locationDirectory(source).warnings).toHaveLength(1);
    expect(() => planLocationRename(source, "HOUSE", "CABIN")).toThrow(/incomplete private/);
  });

  it("preserves distant omissions across differing-length replacements", () => {
    const source =
      "[[global]]\n\nINT. HOUSE - DAY\n\n!A. [[secret]]\n\nEXT. HOUSE - NIGHT\n\n/*last*/";
    const plan = planLocationRename(source, "HOUSE", "VERY LONG APARTMENT");
    expect(plan.candidate).toBe(source.replaceAll(". HOUSE -", ". VERY LONG APARTMENT -"));
  });

  it("returns honest no-op/missing plans and applies all appearances with one undo", () => {
    const source = "INT. HOUSE - DAY\n\n!A.\n\nEXT. HOUSE - NIGHT\n\n!B.";
    expect(planLocationRename(source, "HOUSE", "HOUSE").changes).toEqual([]);
    expect(planLocationRename(source, "MISSING", "CABIN").changes).toEqual([]);
    const plan = planLocationRename(source, "HOUSE", "CABIN");
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

  it("handles thousands of headings and omissions with complete bounded-source results", () => {
    const source = "INT. HOUSE - DAY\n\n!A. [[secret]]\n\n".repeat(3_000);
    expect(planLocationRename(source, "HOUSE", "CABIN").changes).toHaveLength(3_000);
    expect(locationDirectory(source).locations[0]?.appearances).toHaveLength(3_000);
  });
});
