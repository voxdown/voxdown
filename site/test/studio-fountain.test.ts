import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";

describe("native Fountain", () => {
  it("retains every physical source line and original CRLF/Unicode offsets", () => {
    const source = ".Été 🦊\r\n\r\n@Zoë\r\nBonjour.\r\n";
    const parsed = parseFountain(source);
    expect(parsed.elements.map((e) => [e.kind, e.line, source.slice(e.from, e.to)])).toEqual([
      ["scene", 1, ".Été 🦊"],
      ["blank", 2, ""],
      ["character", 3, "@Zoë"],
      ["dialogue", 4, "Bonjour."],
      ["blank", 5, ""],
    ]);
    expect(parsed.elements.at(-1)?.from).toBe(source.length);
  });

  it("reads title continuations, arbitrary metadata and duplicate fields", () => {
    const result = parseFountain(
      "Title:\n    **One**\n    _Two_\nAuthor: Ada\nAuthor: Bex\nContact:\n\tStudio\nCustom key: Local\n\nINT. ROOM - DAY #1A#\n\nAction.",
    );
    expect(result.title).toEqual({
      title: "**One**\n_Two_",
      author: "Ada\nBex",
      contact: "Studio",
      "custom key": "Local",
    });
    expect(result.elements[9]).toMatchObject({
      kind: "scene",
      text: "INT. ROOM - DAY",
      sceneNumber: "1A",
    });
  });

  it("recognizes standard and forced scenes without treating ellipses as headings", () => {
    for (const prefix of ["INT.", "ext.", "EST ", "INT./EXT.", "INT/EXT ", "I/E."]) {
      expect(parseFountain(`${prefix} ROOM\n\n`).elements[0]?.kind).toBe("scene");
    }
    expect(parseFountain(".A MEMORY #I-1.A#").elements[0]).toMatchObject({
      kind: "scene",
      text: "A MEMORY",
      sceneNumber: "I-1.A",
    });
    expect(parseFountain("...a distant memory").elements[0]?.kind).toBe("action");
    expect(parseFountain("IN/EX. CAR - DAY").elements[0]?.kind).toBe("action");
    expect(parseFountain(".IN/EX. CAR - DAY").elements[0]).toMatchObject({
      kind: "scene",
      text: "IN/EX. CAR - DAY",
    });
    expect(parseFountain("NORA\nI/E. is the abbreviation I use.").elements[1]?.kind).toBe(
      "dialogue",
    );
    expect(parseFountain("!INT. ROOM\nA lamp.").elements[0]).toMatchObject({
      kind: "action",
      text: "INT. ROOM",
    });
  });

  it("distinguishes uppercase action, numerical action and actual character cues", () => {
    const result = parseFountain(
      "A LOUD NOISE\n\n23\nFootsteps.\n\n!SCANNING THE AISLES\nWhere is he?\n\nÉLODIE (on radio)\nHello!\n\n@小明\n你好。",
    );
    expect(result.elements.map((e) => e.kind)).toEqual([
      "action",
      "blank",
      "action",
      "action",
      "blank",
      "action",
      "action",
      "blank",
      "character",
      "dialogue",
      "blank",
      "character",
      "dialogue",
    ]);
    expect(parseFountain("SCANNING THE AISLES\nWhere is he?").elements[0]?.kind).toBe("character");
    expect(parseFountain("ALICE").elements[0]?.kind).toBe("action");
  });

  it("keeps dialogue line breaks, intentional blank lines, extensions and dual markers", () => {
    const result = parseFountain(
      "    ALICE (V.O.)\n\tHello.\n  \n    Again.\n    (quietly)\n    **Please**.\n\nBOB ^\nYes.",
    );
    expect(result.elements.map((e) => e.kind)).toEqual([
      "character",
      "dialogue",
      "dialogue",
      "dialogue",
      "parenthetical",
      "dialogue",
      "blank",
      "character",
      "dialogue",
    ]);
    expect(result.elements[1]?.text).toBe("Hello.");
    expect(result.elements[2]?.text).toBe("");
    expect(result.elements[5]?.text).toBe("**Please**.");
    expect(result.elements[7]).toMatchObject({ text: "BOB", dual: true });
    expect(parseFountain("ALICE\nHello.\n \nShe leaves.").elements[3]?.kind).toBe("action");
  });

  it("preserves action indentation and escapes rather than interpreting escaped markers", () => {
    const result = parseFountain(
      "!A letter:\n\tDear Sam,\n    Regards.\n\n\\.NOT A SCENE\n\n\\@Nobody\n\n\\!Loud\n\nA literal \\[[note]] and **\\*code\\***.",
    );
    expect(result.elements[1]).toMatchObject({ kind: "action", text: "    Dear Sam," });
    expect(result.elements.filter((e) => e.kind === "scene" || e.kind === "character")).toEqual([]);
    expect(result.elements.at(-1)?.text).toBe("A literal \\[[note]] and **\\*code\\***.");
  });

  it("handles transitions, centered text, lyrics and nonprinting structure", () => {
    const result = parseFountain(
      "CUT TO:\n\nCUT TO: \n\n>fade out\n> THE END <\n~A song\n## Sequence\n= A summary\n====",
    );
    expect(result.elements.map((e) => e.kind)).toEqual([
      "transition",
      "blank",
      "action",
      "blank",
      "transition",
      "centered",
      "lyric",
      "section",
      "synopsis",
      "page-break",
    ]);
    expect(result.elements[5]?.text).toBe("THE END");
    expect(result.elements[7]).toMatchObject({ level: 2, text: "Sequence" });
  });

  it("removes completed inline and multiline notes and boneyards only from print text", () => {
    const source =
      "She [[aside]] waits.\n\n[[A note\n  \ncontinued]]\n\n/*\nINT. OMITTED - DAY\n\nGone.\n*/\nVisible /* secret */ action.";
    const result = parseFountain(source);
    expect(result.elements[0]?.text).toBe("She  waits.");
    expect(result.elements.slice(2, 5).every((e) => e.kind === "note")).toBe(true);
    expect(result.elements.slice(6, 11).every((e) => e.kind === "boneyard")).toBe(true);
    expect(result.elements[11]?.text).toBe("Visible  action.");
    expect(source.slice(result.elements[0]?.from ?? -1, result.elements[0]?.to ?? -1)).toContain(
      "[[aside]]",
    );
    expect(result.warnings).toEqual([]);
  });

  it("keeps malformed omissions visible and gives actionable line-specific warnings", () => {
    const result = parseFountain("[[Unclosed\nStill here\n\nVisible.\n\n/* Unclosed\nAlso here.");
    expect(result.warnings).toEqual([
      { line: 1, message: expect.stringContaining("add ]] before an empty line") },
      { line: 6, message: expect.stringContaining("add */") },
    ]);
    expect(result.elements[0]?.text).toBe("[[Unclosed");
    expect(result.elements[1]?.text).toBe("Still here");
    expect(result.elements[5]?.text).toBe("/* Unclosed");
    expect(result.elements[6]?.text).toBe("Also here.");
  });

  it("does not let an unclosed note conceal later independent comments", () => {
    const result = parseFountain("[[unfinished\n\n[[complete]]\n\nShown.");
    expect(result.warnings).toHaveLength(1);
    expect(result.elements[0]?.text).toBe("[[unfinished");
    expect(result.elements[2]?.kind).toBe("note");
    expect(result.elements[4]?.text).toBe("Shown.");
  });

  it("keeps comments transparent to dialogue and supports an intentional first blank line", () => {
    const result = parseFountain(
      "ALICE\n[[A direction for the writer]]\nHello.\n\nBOB\n  \nGoodbye.",
    );
    expect(result.elements.map((e) => e.kind)).toEqual([
      "character",
      "note",
      "dialogue",
      "blank",
      "character",
      "dialogue",
      "dialogue",
    ]);
  });

  it("accepts a BOM and legacy CR line endings without shifting source offsets", () => {
    const source = "\uFEFFTitle: Test\r\r.INTRO\r\r@Alice\rHi.";
    const result = parseFountain(source);
    expect(result.title.title).toBe("Test");
    expect(result.elements[2]).toMatchObject({ kind: "scene", text: "INTRO", line: 3 });
    expect(source.slice(result.elements[2]?.from ?? -1, result.elements[2]?.to ?? -1)).toBe(
      ".INTRO",
    );
  });

  it("handles long escaped text without a quadratic backslash scan", () => {
    const source = `!${"\\".repeat(100_000)} literal`;
    expect(parseFountain(source).elements[0]?.text).toBe(source.slice(1));
  });

  it("bounds cue and scene suffix parsing on pathological permitted lines", () => {
    const start = performance.now();
    const unmatched = parseFountain(`${"(".repeat(490_000)}\ntext`);
    expect(unmatched.elements[0]?.kind).toBe("action");
    const spaces = parseFountain(`NAME${" ".repeat(490_000)}literal\ntext`);
    expect(spaces.elements[0]?.kind).toBe("action");
    const scene = parseFountain(`INT. ROOM${" ".repeat(490_000)}#invalid!#`);
    expect(scene.elements[0]?.sceneNumber).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("keeps unknown input and empty documents safe", () => {
    expect(parseFountain("").elements).toEqual([
      { kind: "blank", text: "", from: 0, to: 0, line: 1 },
    ]);
    expect(parseFountain("__proto__: safe\n\nUnknown.").title.__proto__).toBe("safe");
    expect(parseFountain("<script>alert(1)</script>").elements[0]?.text).toBe(
      "<script>alert(1)</script>",
    );
  });
});
