import { describe, expect, it, vi } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { fountainRuns } from "../src/studio/inline";
import { layoutScreenplay } from "../src/studio/layout";
import { screenplayPdf } from "../src/studio/pdf";

// Original adversarial cases derived from the rules at https://fountain.io/syntax/.
// Keep this corpus independent of UI commands: arbitrary imported Fountain must work too.
const printed = (source: string) =>
  layoutScreenplay(parseFountain(source)).pages.flatMap((page) => page.lines);
const visible = (source: string) =>
  printed(source)
    .map((line) => line.text)
    .join("\n");

describe("Fountain conformance corpus", () => {
  it("does not swallow a first-line transition escape as title metadata", () => {
    for (const source of ["CUT TO: ", "CUT TO:\t", "   MATCH CUT TO: "]) {
      const document = parseFountain(`${source}\n\nAn ordinary action.`);
      expect(document.title).toEqual({});
      expect(document.elements[0]).toMatchObject({
        kind: "action",
        text: source.replaceAll("\t", "    "),
      });
      expect(visible(source)).toContain(source.trimEnd());
    }
    expect(parseFountain("CUT TO:\n\nNext.").elements[0]?.kind).toBe("transition");
    expect(parseFountain("Photo: A lighthouse\n\nNext.").title.photo).toBe("A lighthouse");
  });

  it("preserves duplicate, empty and multiline title fields and source addresses", () => {
    const source =
      "\uFEFFTitle:\r\n   _**A Night**_\r\nAuthor: Jo\r\nAuthor: Lee\r\nContact:\r\n\twriter@example.test\r\nCustom flag: yes\r\n\r\n!Begin.";
    const document = parseFountain(source);
    expect(document.title).toEqual({
      title: "_**A Night**_",
      author: "Jo\nLee",
      contact: "writer@example.test",
      "custom flag": "yes",
    });
    expect(document.elements.map((line) => source.slice(line.from, line.to))).toEqual(
      source.split("\r\n"),
    );
    const layout = layoutScreenplay(document);
    expect(layout.pages.map((page) => page.number)).toEqual([null, 1]);
    expect(layout.pages[0]?.lines.find((line) => line.text === "A Night")?.runs[0]).toMatchObject({
      bold: true,
      underline: true,
    });
    expect(layout.warnings).toEqual([expect.stringContaining("custom flag")]);
    expect(layout.exportBlocked).toBe(false);
  });

  it("forces mixed-case cues and actions without changing punctuation or indentation", () => {
    const source =
      "@McKay (on radio)\nWait -- what... 'really'?\n\n\t!INT. FALSE SCENE - DAY\n    A written letter.\n...continued.";
    const document = parseFountain(source);
    expect(document.elements[0]).toMatchObject({ kind: "character", text: "McKay (on radio)" });
    expect(document.elements[3]).toMatchObject({
      kind: "action",
      text: "    INT. FALSE SCENE - DAY",
    });
    expect(document.elements[4]?.text).toBe("    A written letter.");
    expect(visible(source)).toContain("Wait -- what... 'really'?");
    expect(document.elements[5]?.kind).toBe("action");
  });

  it("retains escaped trailing carets instead of turning names into dual dialogue", () => {
    const source = String.raw`@Ada
Left.

@Bex \^
Right.`;
    const document = parseFountain(source);
    expect(document.elements[3]).toMatchObject({ kind: "character", text: String.raw`Bex \^` });
    expect(document.elements[3]?.dual).toBeUndefined();
    const lines = printed(source);
    expect(lines.find((line) => line.text === "Ada")?.x).toBe(252);
    expect(lines.find((line) => line.text === "Bex ^")?.x).toBe(252);
    expect(parseFountain("@Bex ^  \nWords.").elements[0]?.dual).toBe(true);
  });

  it("removes complete private text across all supported newline forms", () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = [
        "Visible [[SECRET_ONE]] action.",
        "",
        "/*",
        "SECRET_TWO",
        "",
        "*/",
        "",
        "[[SECRET_THREE",
        "  ",
        "SECRET_FOUR]]",
        "",
        "@Ada",
        "[[SECRET_FIVE]]",
        "Hello.",
      ].join(newline);
      const document = parseFountain(source);
      expect(document.warnings).toEqual([]);
      expect(document.omissions).toHaveLength(4);
      expect(
        document.omissions.every((span) => source.slice(span.from, span.to).includes("SECRET_")),
      ).toBe(true);
      expect(visible(source)).not.toContain("SECRET_");
      expect(document.elements.at(-1)?.kind).toBe("dialogue");
      expect(document.elements.map((line) => source.slice(line.from, line.to))).toEqual(
        source.split(newline),
      );
    }
  });

  it("does not confuse comment families or escaped closers inside a private span", () => {
    const source = String.raw`Visible [[one /* SECRET_ONE */ two \]] SECRET_TWO]] ending.
/* [[SECRET_THREE]] and \*/ SECRET_FOUR */
Done.`;
    const document = parseFountain(source);
    expect(document.omissions).toHaveLength(2);
    expect(document.warnings).toEqual([]);
    expect(visible(source)).toBe("Visible  ending.\nDone.");
  });

  it("keeps escaped note openers literal and respects even backslash parity", () => {
    expect(visible(String.raw`A \[[literal]] note.`)).toBe("A [[literal]] note.");
    expect(visible(String.raw`A \\[[PRIVATE]] note.`)).toBe(String.raw`A \ note.`);
  });

  it("blocks direct PDF export of malformed private syntax before loading fonts", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      for (const source of ["[[PRIVATE", "/* PRIVATE", "[[PRIVATE\n\nPUBLIC]]"]) {
        const document = parseFountain(source);
        const layout = layoutScreenplay(document);
        expect(layout.exportBlocked).toBe(true);
        expect(
          layout.pages.flatMap((page) => page.lines).some((line) => line.text.includes("PRIVATE")),
        ).toBe(true);
        await expect(screenplayPdf(layout)).rejects.toThrow(/unclosed notes or boneyards/);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("limits multiline notes to connected lines while boneyards span paragraphs", () => {
    expect(parseFountain("[[one\n  \ntwo]]").warnings).toEqual([]);
    expect(parseFountain("[[one\n \ntwo]]").warnings).toHaveLength(1);
    expect(parseFountain("/*one\n\ntwo*/").warnings).toEqual([]);
    expect(visible("/*one\n\ntwo*/")).toBe("");
  });

  it("keeps emphasis scoped to physical lines and permits nested mixed styles", () => {
    expect(visible("!A *half\nfinished* thought.")).toBe("A *half\nfinished* thought.");
    expect(fountainRuns("_***all three***_")).toEqual([
      { text: "all three", bold: true, italic: true, underline: true },
    ]);
    expect(fountainRuns(String.raw`\*literal\* and **bold**`)).toEqual([
      { text: "*literal* and ", bold: false, italic: false, underline: false },
      { text: "bold", bold: true, italic: false, underline: false },
    ]);
  });

  it("excludes structure but retains explicit page boundaries between speeches", () => {
    const source =
      "# Act one\n= PRIVATE_SYNOPSIS\n@Ada\nLeft.\n===\n@Bex ^\nRight.\n\n## PRIVATE_SECTION\n[[PRIVATE_NOTE]]";
    const layout = layoutScreenplay(parseFountain(source));
    expect(layout.pages.map((page) => page.number)).toEqual([1, 2]);
    expect(layout.pages[0]?.lines.some((line) => line.text === "Ada")).toBe(true);
    expect(layout.pages[1]?.lines.find((line) => line.text === "Bex")?.x).toBe(252);
    expect(layout.warnings).toEqual([expect.stringContaining("no preceding speech")]);
    expect(visible(source)).not.toContain("PRIVATE_");
  });

  it("keeps unequal dual speeches in their columns until each finishes", () => {
    const source = `@Ada\n${Array.from({ length: 100 }, (_, i) => `left${i}.`).join("\n")}\n\n@Bex ^\nright0.\nright1.`;
    const layout = layoutScreenplay(parseFountain(source));
    const lines = layout.pages.flatMap((page) => page.lines);
    expect(lines.filter((line) => /^left\d+\.$/.test(line.text))).toHaveLength(100);
    expect(lines.filter((line) => /^right\d+\.$/.test(line.text))).toHaveLength(2);
    expect(
      layout.pages
        .slice(1)
        .flatMap((page) => page.lines)
        .every((line) => !line.text.includes("Bex")),
    ).toBe(true);
    expect(lines.find((line) => line.text === "left0.")?.y).toBe(
      lines.find((line) => line.text === "right0.")?.y,
    );
  });

  it.each(["letter", "a4"] as const)(
    "keeps styled long tokens complete and inside %s pages",
    (paper) => {
      const token = "É".repeat(1400);
      const layout = layoutScreenplay(parseFountain(`!_**${token}**_`), paper);
      const rows = layout.pages.flatMap((page) => page.lines).filter((line) => line.sourceLine > 0);
      expect(rows.map((line) => line.text).join("")).toBe(token);
      expect(rows.every((line) => line.runs.every((run) => run.bold && run.underline))).toBe(true);
      for (const row of rows) {
        expect(row.x).toBeGreaterThanOrEqual(108);
        expect(row.x + Array.from(row.text).length * 7.2).toBeLessThanOrEqual(
          layout.width - 72 + 0.001,
        );
        expect(row.y).toBeLessThanOrEqual(layout.height - 72);
      }
    },
  );
});
