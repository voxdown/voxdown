import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { fountainRuns } from "../src/studio/inline";
import { type ScreenplayLayout, layoutScreenplay } from "../src/studio/layout";
import { screenplayPdf } from "../src/studio/pdf";

const layout = (source: string) => layoutScreenplay(parseFountain(source));
const bodyLines = (result: ScreenplayLayout) =>
  result.pages
    .filter((page) => page.number !== null)
    .flatMap((page) => page.lines)
    .filter((line) => line.sourceLine > 0);
function inBounds(result: ScreenplayLayout) {
  for (const page of result.pages)
    for (const line of page.lines) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + Array.from(line.text).length * 7.2).toBeLessThanOrEqual(result.width + 0.001);
      expect(line.y).toBeGreaterThanOrEqual(48);
      expect(line.y).toBeLessThanOrEqual(result.height - 72);
      expect(line.runs.map((run) => run.text).join("")).toBe(line.text);
    }
}

describe("native screenplay layout", () => {
  it("uses actual screenplay offsets, excludes private notes, and keeps text inert", () => {
    const result = layout(
      "INT. ROOM - DAY #12A#\n\nA <script>alert(1)</script> sign.\n\nADA\n(quietly)\n**Hello**, _world_.\n\n> CUT TO:\n\n[[private]]\n/* omitted */\n# Outline\n= A summary\n",
    );
    const lines = bodyLines(result);
    expect(lines.find((line) => line.text === "ADA")?.x).toBe(252);
    expect(lines.find((line) => line.text === "(quietly)")?.x).toBe(216);
    expect(lines.find((line) => line.text === "Hello, world.")?.x).toBe(180);
    expect(lines.some((line) => line.text.includes("<script>alert(1)</script>"))).toBe(true);
    expect(lines.map((line) => line.text).join("\n")).not.toMatch(
      /private|omitted|Outline|summary/,
    );
    expect(lines.filter((line) => line.text === "12A")).toHaveLength(2);
    inBounds(result);
  });

  it("continues a very long speech with MORE and repeated cues without losing words", () => {
    const result = layout(`ADA\n${"speech ".repeat(1400)}finish.`);
    expect(result.pages.length).toBeGreaterThan(3);
    const lines = bodyLines(result);
    const speeches = lines
      .filter((line) => line.sourceLine === 2)
      .map((line) => line.text)
      .join(" ");
    expect(speeches.match(/speech/g)).toHaveLength(1400);
    expect(speeches).toContain("finish.");
    for (const page of result.pages.slice(0, -1)) expect(page.lines.at(-1)?.text).toBe("(MORE)");
    for (const page of result.pages.slice(1))
      expect(page.lines.find((line) => line.sourceLine > 0)?.text).toBe("ADA (CONT'D)");
    inBounds(result);
  });

  it("keeps sung lines inside a speech while standalone lyrics keep action margins", () => {
    const result = layout(
      "BOB\n~La la la.\n~Singing again.\nStill speaking.\n\nThe radio plays.\n~An unassigned song.",
    );
    const lines = bodyLines(result);
    for (const text of ["La la la.", "Singing again.", "Still speaking."])
      expect(lines.find((line) => line.text === text)?.x).toBe(180);
    for (const text of ["La la la.", "Singing again.", "An unassigned song."])
      expect(lines.find((line) => line.text === text)?.runs.every((run) => run.italic)).toBe(true);
    expect(lines.find((line) => line.text === "Still speaking.")?.runs[0]?.italic).toBe(false);
    expect(lines.find((line) => line.text === "An unassigned song.")?.x).toBe(108);
    expect(result.warnings).toEqual([]);
    inBounds(result);
  });

  it("paginates mixed spoken and sung dialogue with its cue and parentheticals", () => {
    const result = layout(
      `BOB\n(softly)\n~Opening lyric.\nA spoken line.\n${Array.from({ length: 130 }, () => "~A repeated lyric.").join("\n")}\n(taking a breath)\n~Final lyric.\nA spoken ending.`,
    );
    expect(result.pages.length).toBeGreaterThan(2);
    const lines = bodyLines(result);
    expect(lines.filter((line) => line.text === "A repeated lyric.")).toHaveLength(130);
    expect(lines.find((line) => line.text === "(softly)")?.x).toBe(216);
    expect(lines.find((line) => line.text === "Final lyric.")?.runs[0]?.italic).toBe(true);
    expect(lines.find((line) => line.text === "A spoken ending.")?.x).toBe(180);
    for (const page of result.pages.slice(0, -1)) expect(page.lines.at(-1)?.text).toBe("(MORE)");
    for (const page of result.pages.slice(1))
      expect(page.lines.find((line) => line.sourceLine > 0)?.text).toBe("BOB (CONT'D)");
    expect(result.warnings).toEqual([]);
    inBounds(result);
  });

  it("keeps both singers in dual columns when their lyrics cross pages", () => {
    const result = layout(
      `ADA\n(singing)\n${Array.from({ length: 120 }, () => "~Left melody.").join("\n")}\nA spoken ending.\n\nBOB ^\n(singing too)\n${Array.from({ length: 150 }, () => "~Right harmony.").join("\n")}\nAnother spoken ending.`,
    );
    const lines = bodyLines(result);
    const left = lines.filter((line) => line.text === "Left melody.");
    const right = lines.filter((line) => line.text === "Right harmony.");
    expect(left).toHaveLength(120);
    expect(right).toHaveLength(150);
    expect(left.every((line) => line.x === 108 && line.runs.every((run) => run.italic))).toBe(true);
    expect(right.every((line) => line.x > 300 && line.runs.every((run) => run.italic))).toBe(true);
    expect(left[0]?.y).toBe(right[0]?.y);
    expect(lines.some((line) => line.text === "ADA (CONT'D)")).toBe(true);
    expect(lines.some((line) => line.text === "BOB (CONT'D)")).toBe(true);
    expect(result.warnings).toEqual([]);
    inBounds(result);
  });

  it("keeps cues and parentheticals with dialogue and scenes with their opening", () => {
    const source = `${Array.from({ length: 50 }, () => "An action line.").join("\n")}\n\nINT. NEXT ROOM - NIGHT\n\nADA\n(softly)\nFirst line.\nSecond line.`;
    const result = layout(source);
    expect(result.pages).toHaveLength(2);
    const second = result.pages[1]?.lines.map((line) => line.text) ?? [];
    expect(second).toEqual([
      "2.",
      "INT. NEXT ROOM - NIGHT",
      "ADA",
      "(softly)",
      "First line.",
      "Second line.",
    ]);
    expect(result.pages[0]?.lines.some((line) => line.text.includes("NEXT ROOM"))).toBe(false);
    inBounds(result);
  });

  it("keeps mid-speech parentheticals intact across a page boundary", () => {
    const source = `ADA\n${Array.from({ length: 50 }, () => "A spoken line.").join("\n")}\n(with considerable hesitation, looking out the window)\nThe final spoken line.`;
    const result = layout(source);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.lines.at(-1)?.text).toBe("(MORE)");
    expect(result.pages[1]?.lines.map((line) => line.text).join(" ")).toContain(
      "considerable hesitation",
    );
    inBounds(result);
  });

  it("prints dual dialogue in separate columns and continues both speakers", () => {
    const result = layout(
      `ADA\n${"left ".repeat(800)}left-end.\n\nBOB ^\n${"right ".repeat(1000)}right-end.`,
    );
    expect(result.pages.length).toBeGreaterThan(3);
    const lines = bodyLines(result);
    expect(
      lines
        .filter((line) => line.sourceLine === 2)
        .map((line) => line.text)
        .join(" ")
        .match(/left/g),
    ).toHaveLength(801);
    expect(
      lines
        .filter((line) => line.sourceLine === 5)
        .map((line) => line.text)
        .join(" ")
        .match(/right/g),
    ).toHaveLength(1001);
    const ada = result.pages[0]?.lines.find((line) => line.text === "ADA");
    const bob = result.pages[0]?.lines.find((line) => line.text === "BOB");
    expect(ada?.y).toBe(bob?.y);
    expect((bob?.x ?? 0) - (ada?.x ?? 0)).toBeGreaterThan(200);
    expect(lines.some((line) => line.text === "ADA (CONT'D)")).toBe(true);
    expect(lines.some((line) => line.text === "BOB (CONT'D)")).toBe(true);
    inBounds(result);
  });

  it("wraps unbroken tokens without dropping characters or overflowing", () => {
    const word = "W".repeat(10000);
    const result = layout(`!${word}`);
    expect(
      bodyLines(result)
        .map((line) => line.text)
        .join(""),
    ).toBe(word);
    expect(result.warnings.some((warning) => warning.includes("wider than its column"))).toBe(true);
    inBounds(result);
  });

  it("preserves internal blank lines without generating trailing empty pages", () => {
    const result = layout(`First.\n\n\nSecond.\n${"\n".repeat(300)}Third.\n\n===\n===\n`);
    expect(result.pages).toHaveLength(2);
    const first = bodyLines(result).find((line) => line.text === "First.");
    const second = bodyLines(result).find((line) => line.text === "Second.");
    expect((second?.y ?? 0) - (first?.y ?? 0)).toBe(36);
    expect(result.pages.at(-1)?.lines.at(-1)?.text).toBe("Third.");
    expect(result.warnings.some((warning) => warning.includes("Blank lines"))).toBe(true);
    inBounds(result);
  });

  it("honors explicit breaks, empty sources and intentional empty dialogue", () => {
    expect(layout("").pages).toHaveLength(1);
    const result = layout("===\nFirst.\n===\nSecond.\n===\n");
    expect(result.pages).toHaveLength(2);
    expect(bodyLines(result).map((line) => line.text)).toEqual(["First.", "Second."]);
    const speech = layout("ADA\nOne.\n  \nTwo.");
    const one = bodyLines(speech).find((line) => line.text === "One.");
    const two = bodyLines(speech).find((line) => line.text === "Two.");
    expect((two?.y ?? 0) - (one?.y ?? 0)).toBe(24);
    inBounds(speech);
  });

  it("supports A4 and an unnumbered title page with bounded metadata", () => {
    const parsed = parseFountain(
      "Title: **A Story**\nCredit: Written by\nAuthor: Zoë\nContact: writer@example.org\nDraft date: Today\nCustom: Saved but not printed\n\nINT. ROOM - DAY\n\nIt begins.",
    );
    const result = layoutScreenplay(parsed, "a4");
    expect(result.width).toBeCloseTo(595.276);
    expect(result.pages.map((page) => page.number)).toEqual([null, 1]);
    expect(result.pages[0]?.lines.find((line) => line.text === "A Story")?.runs[0]?.bold).toBe(
      true,
    );
    expect(result.warnings.some((warning) => warning.includes("custom"))).toBe(true);
    inBounds(result);
  });

  it("fails clearly on title, cue, scene-number and parenthetical overflow", () => {
    expect(() => layout(`Title: ${"long ".repeat(2000)}\n\nIt begins.`)).toThrow(
      /title-page metadata/,
    );
    expect(() => layout(`@${"NAME ".repeat(100)}\nWords.`)).toThrow(/Character cue/);
    expect(() => layout("INT. ROOM - DAY #123456789#\n\nAction.")).toThrow(/Scene number/);
    expect(() => layout(`ADA\n(${"long ".repeat(1000)})\nWords.`)).toThrow(
      /Parenthetical|parenthetical/,
    );
  });
});

describe("Fountain inline text", () => {
  it("combines styles, preserves HTML as text, and respects escaped delimiters", () => {
    expect(fountainRuns("_a **bold** and *italic* phrase_")).toEqual([
      { text: "a ", bold: false, italic: false, underline: true },
      { text: "bold", bold: true, italic: false, underline: true },
      { text: " and ", bold: false, italic: false, underline: true },
      { text: "italic", bold: false, italic: true, underline: true },
      { text: " phrase", bold: false, italic: false, underline: true },
    ]);
    expect(fountainRuns("**bold *and italic***")).toEqual([
      { text: "bold ", bold: true, italic: false, underline: false },
      { text: "and italic", bold: true, italic: true, underline: false },
    ]);
    expect(fountainRuns("*italic **and bold***")).toEqual([
      { text: "italic ", bold: false, italic: true, underline: false },
      { text: "and bold", bold: true, italic: true, underline: false },
    ]);
    expect(fountainRuns("***both***")[0]).toMatchObject({ text: "both", bold: true, italic: true });
    expect(fountainRuns(String.raw`**\*9765\***`)[0]).toMatchObject({ text: "*9765*", bold: true });
    expect(
      fountainRuns(String.raw`\*literal\* <img onerror=evil()>`)
        .map((run) => run.text)
        .join(""),
    ).toBe("*literal* <img onerror=evil()>");
    expect(
      fountainRuns("He dialed *69 and then *23.")
        .map((run) => run.text)
        .join(""),
    ).toBe("He dialed *69 and then *23.");
  });
});

describe("embedded-font screenplay PDF", () => {
  afterEach(() => vi.unstubAllGlobals());
  function mockFonts() {
    vi.stubGlobal("location", new URL("https://voxdown.test/studio.html"));
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(url);
        const filename = new URL(url).pathname.split("/").at(-1);
        const bytes = await readFile(new URL(`../src/studio/fonts/${filename}`, import.meta.url));
        return new Response(new Uint8Array(bytes).buffer);
      }),
    );
    return requests;
  }
  it("retries failed font downloads, embeds styled fonts and exports matching page sizes", async () => {
    vi.stubGlobal("location", new URL("https://voxdown.test/studio.html"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 503 })),
    );
    const result = layout(
      "Title: **A Story**\nAuthor: Zoë\n\nINT. ROOM - DAY\n\nA café. *Italic* and ***both*** and _underlined_.\n\n===\nSecond page.",
    );
    await expect(screenplayPdf(result)).rejects.toThrow(/font could not be loaded/);
    const requests = mockFonts();
    const bytes = await screenplayPdf(result, "A Story");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(result.pages.length);
    expect(pdf.getTitle()).toBe("A Story");
    expect(pdf.getPages()[0]?.getSize()).toEqual({ width: result.width, height: result.height });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(requests).toHaveLength(4);
    expect(requests.every((url) => new URL(url).origin === "https://voxdown.test")).toBe(true);
  });
  it("rejects unsupported glyphs instead of exporting missing characters", async () => {
    mockFonts();
    await expect(screenplayPdf(layout("A dragon 🐉 and 東京."))).rejects.toThrow(
      /Courier Prime cannot print.*U\+1F409/,
    );
  });
});
