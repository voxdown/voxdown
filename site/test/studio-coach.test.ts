import { describe, expect, it } from "vitest";
import { explainFountainAt } from "../src/studio/coach";

describe("on-demand Fountain help", () => {
  it("explains how to explicitly format ambiguous scene abbreviations", () => {
    for (const prefix of ["I.", "IN.", "IN/EX."]) {
      const source = `${prefix} ROOM - DAY`;
      const help = explainFountainAt(source, 0);
      expect(help.title).toBe("Action");
      expect(help.next).toContain("choose Scene heading");
      expect(help.example).toBe(`.${source}`);
    }
    expect(explainFountainAt("NORA\nI. is the first item.", 10).title).toBe("Dialogue");
  });
  it("explains actual context rather than guessing from uppercase text", () => {
    const source = "INT. ROOM - DAY\n\nMARA\nHELLO THERE.\n\nAction.";
    expect(explainFountainAt(source, source.indexOf("MARA")).title).toBe("Character cue");
    expect(explainFountainAt(source, source.indexOf("HELLO")).title).toBe("Dialogue");
    expect(explainFountainAt(source, source.indexOf("Action")).title).toBe("Action");
  });
  it("recognizes an inline omission without copying its contents into help", () => {
    const source = "A [[secret]] light.";
    const result = explainFountainAt(source, source.indexOf("secret"));
    expect(result.title).toBe("Private note");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("reports unfinished comment diagnostics instead of claiming the text is hidden", () => {
    const result = explainFountainAt("[[unfinished", 5);
    expect(result.title).toBe("Action");
    expect(result.warnings.join(" ")).toContain("Unclosed note");
  });
  it("handles new documents, title pages and bounded invalid positions", () => {
    expect(explainFountainAt("", 0).title).toBe("A fresh paragraph");
    expect(explainFountainAt("Title: Hello\n\nINT. ROOM", -50).title).toBe("Title page");
    expect(explainFountainAt("Action.\n\n", 1000).line).toBe(3);
    expect(explainFountainAt("Action.", Number.NaN).line).toBe(1);
  });
});
