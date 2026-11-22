import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import {
  countWords,
  screenplayInsights,
  searchCharacters,
  searchDiagnostics,
  searchPrivateNotes,
} from "../src/studio/insights";

function insights(source: string, wordsPerMinute?: number) {
  return screenplayInsights(
    parseFountain(source),
    source,
    wordsPerMinute === undefined ? {} : { wordsPerMinute },
  );
}

describe("Studio screenplay insights", () => {
  it("counts printable text, excluding title metadata, structural markers, and completed omissions", () => {
    const result = insights(
      "Title: Hidden title\nAuthor: Hidden author\n\n# Secret section\n= Secret synopsis\n\nINT. ROOM - DAY #12#\n\n!A **bright** light. [[secret words]]\n\n@ADA\n(quietly)\nHello, _whole_ world.\n\n/* Secret abandoned scene */\n\n===",
    );
    expect(result.statistics).toEqual({
      words: 11,
      scenes: 1,
      dialogueWords: 3,
      characters: 1,
      estimatedSpokenSeconds: 1.2,
      wordsPerMinute: 150,
    });
    expect(result.characters[0]).toMatchObject({ name: "ADA", words: 3, blocks: 1 });
    expect(result.notes.map((note) => note.text)).toEqual([
      "secret words",
      " Secret abandoned scene ",
    ]);
  });

  it("uses rendered inline text and handles Unicode, combining marks, numbers, and contractions", () => {
    expect(countWords("Café cafe\u0301 naïve Привет 42 don't mother-in-law 🎭")).toBe(7);
    expect(countWords("  … — 🎭 ** __ ")).toBe(0);
    expect(insights("!**inter**national _co_op café.").statistics.words).toBe(3);
    // Whitespace-free scripts are explicitly approximate tokens, not an English-only regex.
    expect(countWords("你好世界 ไทย")).toBe(2);
  });

  it("merges repeated character cues and extensions while tracking dual dialogue and source lines", () => {
    const result = insights(
      "@ÉLISE (V.O.)\nHello there.\n[[private direction]]\nStill speaking.\n\n@BOB ^\nOne two three.\n\n@E\u0301lise (CONT'D) (O.S.)\n(whispers)\nGood night.\n\n!Silence.\n~Unattributed song.",
    );
    expect(result.characters).toEqual([
      {
        name: "ÉLISE",
        blocks: 2,
        words: 6,
        lines: [1, 9],
        dialogueLines: [2, 4, 11],
        dualBlocks: 0,
      },
      { name: "BOB", blocks: 1, words: 3, lines: [6], dialogueLines: [7], dualBlocks: 1 },
    ]);
    expect(result.statistics.dialogueWords).toBe(11);
    expect(result.statistics.characters).toBe(2);
  });

  it("indexes exact multiline private text with BOM and mixed line endings", () => {
    const source = "\uFEFF!Visible [[first\r\nsecond]] remains.\r/*gone\nagain*/\n!Last [[third]]";
    const result = insights(source);
    expect(
      result.notes.map(({ source, text, line, endLine, kind }) => ({
        source,
        text,
        line,
        endLine,
        kind,
      })),
    ).toEqual([
      { source: "[[first\r\nsecond]]", text: "first\r\nsecond", line: 1, endLine: 2, kind: "note" },
      { source: "/*gone\nagain*/", text: "gone\nagain", line: 3, endLine: 4, kind: "boneyard" },
      { source: "[[third]]", text: "third", line: 5, endLine: 5, kind: "note" },
    ]);
    for (const note of result.notes) expect(source.slice(note.from, note.to)).toBe(note.source);
    expect(result.statistics.words).toBe(3);
  });

  it("does not misidentify escaped or incomplete notes as private and links diagnostics to source", () => {
    const source = "!Visible \\[[literal]]\n\n![[unfinished note\n\n!After";
    const result = insights(source);
    expect(result.notes).toEqual([]);
    expect(result.statistics.words).toBe(5);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: "warning", line: 3 });
    const diagnostic = result.diagnostics[0];
    expect(source.slice(diagnostic?.from, diagnostic?.to)).toBe("![[unfinished note");
    expect(searchDiagnostics(result.diagnostics, "UNCLOSED").total).toBe(1);
    expect(searchDiagnostics(result.diagnostics, "nothing").total).toBe(0);
  });

  it("labels duration as a rate-based estimate, counts lyrics, and ignores directions", () => {
    const source = "@ADA\n(very slowly)\nOne two.\n~Three four.\n\n!An hour passes.";
    const result = insights(source, 120);
    expect(result.statistics.dialogueWords).toBe(4);
    expect(result.statistics.estimatedSpokenSeconds).toBe(2);
    expect(result.characters[0]?.words).toBe(4);
    expect(insights(source, Number.NaN).statistics.wordsPerMinute).toBe(150);
    expect(insights(source, 0).statistics.wordsPerMinute).toBe(1);
    expect(insights(source, 50_000).statistics.wordsPerMinute).toBe(1_000);
    expect(insights("").statistics.estimatedSpokenSeconds).toBe(0);
  });

  it("searches names and notes with normalized text and bounded result rendering", () => {
    const result = insights(
      Array.from({ length: 800 }, (_, i) => `@CAFÉ ${i}\nHello. [[private café ${i}]]`).join(
        "\n\n",
      ),
    );
    const characters = searchCharacters(result.characters, "cafe\u0301", 20);
    expect(characters.items).toHaveLength(20);
    expect(characters.total).toBe(800);
    expect(searchPrivateNotes(result.notes, "CAFÉ", 1_000).items).toHaveLength(500);
    expect(searchPrivateNotes(result.notes, "missing").total).toBe(0);
    expect(searchPrivateNotes(result.notes, "", -1)).toEqual({ items: [], total: 800 });
    expect(searchPrivateNotes(result.notes, "", Number.NaN).items).toHaveLength(100);
  });

  it("keeps adjacent inline omissions separate and excludes nested-looking private contents", () => {
    const source = "!Before [[one /* two */]] [[three]] after.\n/* [[private]] */";
    const result = insights(source);
    expect(result.statistics.words).toBe(2);
    expect(result.notes.map((note) => note.source)).toEqual([
      "[[one /* two */]]",
      "[[three]]",
      "/* [[private]] */",
    ]);
    expect(result.notes.map((note) => note.line)).toEqual([1, 1, 2]);
  });

  it("indexes the supported 20,000-line document without truncating totals or private ranges", () => {
    const source = Array.from({ length: 20_000 }, () => "!Visible [[secret]]").join("\n");
    const result = insights(source);
    expect(result.statistics.words).toBe(20_000);
    expect(result.notes).toHaveLength(20_000);
    expect(result.notes.at(-1)?.line).toBe(20_000);
    expect(searchPrivateNotes(result.notes, "secret")).toMatchObject({ total: 20_000 });
    expect(searchPrivateNotes(result.notes, "secret").items).toHaveLength(100);
  });
});
