import { describe, expect, it } from "vitest";
import {
  breakdownCsv,
  filterBreakdown,
  prepareBreakdown,
  spreadsheetCell,
  summarizeBreakdown,
} from "../src/studio/breakdown";

describe("public scene/cast breakdown", () => {
  it("retains repeated scene occurrences and explicit numbers including empty scenes", () => {
    const result = prepareBreakdown("INT. ROOM #1A#\n\n!A lamp.\n\nINT. ROOM #2#\n\nEXT. FIELD");
    expect(result.rows.map((row) => [row.id, row.heading, row.number, row.line])).toEqual([
      [1, "INT. ROOM", "1A", 1],
      [2, "INT. ROOM", "2", 5],
      [3, "EXT. FIELD", "", 7],
    ]);
    expect(result.summary).toMatchObject({ scenes: 3, beforeFirst: 0, actionWords: 2, roles: 0 });
  });
  it("excludes private/title/outline and detects real speech with canonical role extensions", () => {
    const result = prepareBreakdown(
      "Title: SECRET TITLE\nContact: PRIVATE CONTACT\n\n# SECRET OUTLINE\n= SECRET SYNOPSIS\n\nINT. ROOM\n\n@MARA (V.O.)\n(softly)\nHello [[SECRET NOTE]] world.\n\n@Mara\n~One more.\n\n@EMPTY\n(quietly)\n\n/* SECRET OMITTED */\n\n@OTHER ^\n...\n",
    );
    expect(result.rows[0]?.roles).toEqual([
      { name: "MARA", speeches: 2, words: 4, dualCues: 0 },
      { name: "OTHER", speeches: 1, words: 0, dualCues: 1 },
    ]);
    expect(result.summary).toMatchObject({ dialogueWords: 4, speeches: 3, dualCues: 1, roles: 2 });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE|EMPTY|quietly|softly/);
  });
  it("only creates a before-first row for public content and points at its first source line", () => {
    expect(prepareBreakdown("Title: Hidden\n\n# hidden\n\n[[hidden]]").rows).toEqual([]);
    const result = prepareBreakdown("Title: Hidden\n\n!Before this.\n\nINT. ROOM");
    expect(result.rows[0]).toMatchObject({ id: 0, beforeFirst: true, line: 3, actionWords: 2 });
    expect(result.summary).toMatchObject({ scenes: 1, beforeFirst: 1 });
  });
  it("counts Unicode dialogue/lyrics and centered action but not directions/transitions/headings", () => {
    const result = prepareBreakdown(
      "INT. ROOM\n\n>Two words<\n\nCUT TO:\n\n@A\n(six quiet directions here)\nL’été mother-in-law 日本語\n~One song\n\n~Uncued lyric",
    );
    expect(result.summary).toMatchObject({
      dialogueWords: 7,
      actionWords: 2,
      speeches: 1,
      roles: 1,
    });
  });
  it("filters complete scenes by heading/number and real speaking role, retaining all their words", () => {
    const result = prepareBreakdown(
      "INT. ONE #12#\n\n@MARA\nOne.\n\n@JON\nTwo words.\n\nEXT. TWO\n\n@MARA\nThree.",
    );
    const rows = filterBreakdown(result, { query: "12", role: "mar" });
    expect(rows).toHaveLength(1);
    expect(summarizeBreakdown(rows)).toMatchObject({ roles: 2, dialogueWords: 3 });
    expect(filterBreakdown(result, { role: "nobody" })).toEqual([]);
  });
  it.each(["[[unfinished", "/*unfinished", "[[a [[nested]] b]]", "/* a [[nested]] b */"])(
    "rejects ambiguous private input %s",
    (source) => {
      expect(() => prepareBreakdown(source)).toThrow(/private|Nested/);
    },
  );
  it("does not mutate source and returns immutable rows and role records", () => {
    const source = "INT. ROOM\n\n@MARA\nWords.";
    const report = prepareBreakdown(source);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.rows[0]?.roles[0])).toBe(true);
    expect(source).toBe("INT. ROOM\n\n@MARA\nWords.");
  });
  it.each(["=1+1", "+cmd", "-1", "@SUM(A1)", " \t=1", "\r\n+cmd", "\uFEFF@formula", "\u200B=1"])(
    "neutralizes spreadsheet formula prefix %j",
    (value) => {
      expect(spreadsheetCell(value)).toBe(`"'${value}"`);
    },
  );
  it("quotes RFC4180 commas, quotes and newlines without changing ordinary text", () => {
    expect(spreadsheetCell('A,"B"\nC')).toBe('"A,""B""\nC"');
    expect(spreadsheetCell("A-B")).toBe('"A-B"');
  });
  it("exports full values and every filtered occurrence with CRLF rows", () => {
    const heading = "X".repeat(1000);
    const report = prepareBreakdown(
      `.${heading} #12#\n\n@=EVIL\nHello.\n\n@OTHER\nBye.\n\nINT. OMIT`,
    );
    const csv = breakdownCsv(filterBreakdown(report, { query: heading }));
    expect(csv).toContain(heading);
    expect(csv).toContain('"12"');
    expect(csv).toContain('"\'=EVIL\nOTHER"');
    expect(csv).not.toContain("INT. OMIT");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it.each(["@", "@(V.O.)"])("counts unnamed speech without inventing a role for %s", (cue) => {
    const report = prepareBreakdown(`${cue}\nHello there.\n\nINT. ROOM`);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({
      beforeFirst: true,
      dialogueWords: 2,
      speeches: 1,
      roles: [],
    });
    expect(report.summary).toMatchObject({ dialogueWords: 2, speeches: 1, roles: 0 });
  });
  it("includes public cue-only content before a scene without counting a speaking role", () => {
    const report = prepareBreakdown("@EMPTY\n(quietly)\n\nINT. ROOM");
    expect(report.rows[0]).toMatchObject({ beforeFirst: true, roles: [], speeches: 0, line: 1 });
  });
  it("enforces shared source bounds", () => {
    expect(() => prepareBreakdown("x".repeat(500001))).toThrow();
    expect(() => prepareBreakdown("\0")).toThrow();
  });
});
