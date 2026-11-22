import { describe, expect, it } from "vitest";
import { lines, parse } from "voxdown";
import { adaptToVoxDown } from "../src/studio/adaptation";
const rows = (source: string, readSceneHeadings = false) =>
  lines(parse(adaptToVoxDown(source, { readSceneHeadings }).source)).map(
    ({ speaker, text, direction, heading, kind, together }) => ({
      speaker,
      text,
      direction,
      heading,
      kind,
      together,
    }),
  );
const literalFountain = (value: string) => value.replace(/[\\*_\[\]@!>~.#^<]/g, "\\$&");

describe("explicit Fountain to VoxDown adaptation", () => {
  it("keeps action narration and character words, with hidden or spoken scene labels", () => {
    const source =
      "Title: PRIVATE TITLE\nContact: PRIVATE CONTACT\n\nINT. ROOM - DAY #12#\n\n!A **bright** light.\n\n@MARA\nHello.";
    expect(rows(source)).toEqual([
      {
        kind: "speech",
        speaker: "Narrator",
        text: "A bright light.",
        direction: null,
        heading: null,
        together: undefined,
      },
      {
        kind: "speech",
        speaker: "Cast1",
        text: "Hello.",
        direction: null,
        heading: null,
        together: undefined,
      },
    ]);
    expect(rows(source, true)[0]).toMatchObject({
      speaker: "Narrator",
      text: "INT. ROOM - DAY",
      heading: 2,
    });
    expect(adaptToVoxDown(source).source).not.toContain("PRIVATE");
    expect(adaptToVoxDown(source).cast).toEqual([{ handle: "Cast1", name: "MARA" }]);
  });
  it("allocates deterministic collision-free handles, distinct from narration", () => {
    const source = ["MARY JANE", "MARYJANE", "A.B", "AB", "Narrator", "123", "王"]
      .map((name) => `@${name}\nHello.`)
      .join("\n\n");
    const result = adaptToVoxDown(source);
    expect(result.cast.map((role) => role.handle)).toEqual([
      "Cast1",
      "Cast2",
      "Cast3",
      "Cast4",
      "Cast5",
      "Cast6",
      "Cast7",
    ]);
    expect(result.cast.map((role) => role.name)).toEqual([
      "MARY JANE",
      "MARYJANE",
      "A.B",
      "AB",
      "Narrator",
      "123",
      "王",
    ]);
    expect(new Set(rows(source).map((row) => row.speaker)).size).toBe(7);
    expect(adaptToVoxDown(source).source).toBe(result.source);
  });
  it("groups Unicode/case/extension variants and preserves successive directions", () => {
    const source =
      "@Café (V.O.)\n(quietly)\n(to the door)\nHello.\nAgain.\n(loudly)\nGoodbye.\n\n@CAFE\u0301 (O.S.)\n~Sung words.";
    const result = adaptToVoxDown(source);
    expect(result.cast).toEqual([{ handle: "Cast1", name: "Café" }]);
    expect(rows(source).map((row) => row.direction)).toEqual([
      "V.O.; quietly; to the door",
      "V.O.; quietly; to the door",
      "V.O.; loudly",
      "O.S.; sung",
    ]);
  });
  it("escapes every ASCII punctuation and supported quotation mark without changing content", () => {
    const punctuation = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join("");
    const text = `Literal ${punctuation} “quoted” ‘single’ „low“ ‚low‘ «guillemet» ‹small› 「角」 『引用』 &amp; &#64;`;
    expect(rows(`@MARA\n${literalFountain(text)}`)[0]?.text).toBe(text);
    expect(rows(`!${literalFountain(text)}`)[0]?.text).toBe(text);
  });
  it.each([
    "@Evil [boom] {pause:9} %%note%% <!--comment--> &amp;",
    "::: @Evil",
    "---",
    "## Heading {hidden}",
    "[link](https://example.test)",
  ])("prevents VoxDown injection in public text: %s", (text) => {
    const source = `@MARA\n${literalFountain(`Literal ${text}`)}`;
    const result = adaptToVoxDown(source);
    expect(rows(source)[0]).toMatchObject({
      text: `Literal ${text}`,
      speaker: "Cast1",
      direction: null,
      kind: "speech",
    });
    expect(parse(result.source).warnings).toEqual([]);
    expect(parse(result.source).groups).toEqual([]);
  });
  it("escapes malicious cast names and directions as data", () => {
    const name = 'Role ": & {bad}';
    const source = `@${literalFountain(name)}\n(${literalFountain("softly) @Evil (very [bad] &amp;")})\nHello.`;
    const result = adaptToVoxDown(source);
    expect(result.cast[0]?.name).toBe(name);
    expect(rows(source)[0]).toMatchObject({
      speaker: "Cast1",
      direction: "softly) @Evil (very [bad] &amp;",
      text: "Hello.",
    });
  });
  it("excludes private text everywhere, outline and title contacts", () => {
    const source =
      "Title: PRIVATE TITLE\nAuthor: PRIVATE AUTHOR\n\n# PRIVATE OUTLINE\n= PRIVATE SUMMARY\n\nINT. ROOM [[PRIVATE HEADING]]\n\n!Public [[PRIVATE ACTION]] text.\n\n@MARA [[PRIVATE CUE]]\n(soft [[PRIVATE DIRECTION]])\nHello [[PRIVATE SPEECH]].\n/* PRIVATE BONEYARD */";
    const result = adaptToVoxDown(source);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(rows(source).map((row) => row.text)).toEqual(["Public text.", "Hello ."]);
  });
  it.each([
    "@MARA\n[[PRIVATE",
    "!Public /*PRIVATE",
    "!Public [[outer [[inner]] TAIL]]",
    "!Public /*outer /*inner*/ TAIL*/",
  ])("refuses malformed or nested comments: %s", (source) => {
    expect(() => adaptToVoxDown(source)).toThrow(/private|Nested/);
  });
  it("reports dual source-order delivery and never invents together/unison semantics", () => {
    const source = "@MARA\nOne.\n\n@JON ^\nTwo.";
    const result = adaptToVoxDown(source);
    expect(result.dualCues).toBe(1);
    expect(rows(source).map((row) => row.text)).toEqual(["One.", "Two."]);
    expect(rows(source).every((row) => !row.together)).toBe(true);
    expect(result.report.join(" ")).toContain("Overlap/timing is lost");
  });
  it.each(["@MARA\nHello.\n(quietly)", "@MARA\n(quietly)\n\n!Action.", "@MARA\n..."])(
    "refuses silent loss of unrepresentable direction or spoken symbol line: %s",
    (source) => {
      expect(() => adaptToVoxDown(source)).toThrow(/parenthetical|punctuation/);
    },
  );
  it("reports structural losses and keeps intentional blank lines out of timed pauses", () => {
    const source =
      "INT. ROOM #2#\n\n> Centered <\n\n@MARA\nOne.\n  \nTwo.\n\n> CUT TO:\n\n===\n\n~A song.";
    const result = adaptToVoxDown(source);
    expect(rows(source).map((row) => row.text)).toEqual(["Centered", "One.", "Two.", "A song."]);
    expect(result.report.join(" ")).toContain(
      "1 transitions, 1 page breaks, 1 scene numbers and 1 centered",
    );
    expect(result.report.join(" ")).toContain("1 intentional blank dialogue");
    expect(rows(source).at(-1)?.direction).toBe("sung");
  });
  it("handles BOM/newlines and long scripts without modifying source", () => {
    const source = "\uFEFF@MARA\r\nHello.\r\n\r@JON\nAgain.";
    expect(rows(source).map((row) => row.text)).toEqual(["Hello.", "Again."]);
    expect(source).toBe("\uFEFF@MARA\r\nHello.\r\n\r@JON\nAgain.");
    expect(adaptToVoxDown("@MARA\nHello.\n\n".repeat(3000)).spokenRows).toBe(3000);
    expect(() => adaptToVoxDown("!".repeat(500001))).toThrow(/500,000/);
  });
  it("rejects output expansion and invalid public Unicode without producing a partial file", () => {
    const source = `@MARA (${"x".repeat(10000)})\n${"Hi.\n".repeat(300)}`;
    expect(() => adaptToVoxDown(source)).toThrow(/too large/);
    expect(() => adaptToVoxDown("@MARA\nHi \uD800.")).toThrow(/Unicode/);
    expect(() => adaptToVoxDown("!Hi \u0001.")).toThrow(/control/);
  });
});
