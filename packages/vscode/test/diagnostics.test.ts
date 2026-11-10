import { describe, expect, it } from "vitest";
import type { Warning } from "voxdown";
import { DIAGNOSTIC_SOURCE, diagnose, toDiagnostics } from "../src/diagnostics";

describe("diagnostics", () => {
  it("come from the core's warnings, with their codes and messages", () => {
    const text = "---\ncast:\n  Gerald:\n---\n@Wanda “Hello.”\n{pause soon}";
    const found = diagnose(text);
    expect(found.map((d) => d.code)).toEqual([
      "silent-cast-member",
      "unknown-character",
      "pause-value",
    ]);
    expect(found.every((d) => d.message.length > 0)).toBe(true);
    expect(DIAGNOSTIC_SOURCE).toBe("voxdown");
  });

  it("are warnings, or information for the core's info", () => {
    const text = "---\ncast:\n  Gerald:\n---\n@Wanda “Hello.”";
    expect(diagnose(text).map((d) => [d.code, d.severity])).toEqual([
      ["silent-cast-member", "information"],
      ["unknown-character", "warning"],
    ]);
  });

  it("put each warning on its 0-based line and UTF-16 column", () => {
    const text = "Once upon a time.\n@Gerald “Could you not?\n\nThe end.";
    const [unclosed] = diagnose(text);
    expect(unclosed?.code).toBe("unclosed-quote");
    expect(unclosed?.start).toEqual({ line: 1, character: 8 });
    expect(unclosed?.end).toEqual({ line: 1, character: 9 });
  });

  it("count columns in UTF-16 code units, as VS Code does", () => {
    const text = "𝒜 is a letter outside the BMP. {nothing}";
    const [unknown] = diagnose(text);
    expect(unknown?.code).toBe("unknown-instruction");
    expect(unknown?.start).toEqual({ line: 0, character: text.indexOf("{") });
    expect(unknown?.start.character).toBe(32);
  });

  it("never put a column past the end of a line, with CRLF line endings too", () => {
    const text = "One.\r\nTwo.\r\n";
    const warning = (from: number, to: number): Warning => ({
      code: "front-matter",
      severity: "warning",
      message: "m",
      range: { from, to },
      line: 1,
      column: 1,
    });
    const [crlf, end, past] = toDiagnostics(text, [
      warning(0, 5),
      warning(6, text.length),
      warning(text.length + 4, text.length + 9),
    ]);
    expect(crlf?.end).toEqual({ line: 0, character: 4 });
    expect(end?.start).toEqual({ line: 1, character: 0 });
    expect(end?.end).toEqual({ line: 2, character: 0 });
    expect(past?.start).toEqual({ line: 2, character: 0 });
  });

  it("are none for a clean story", () => {
    expect(diagnose("@Gerald “Could you not?” said the dragon.")).toEqual([]);
  });
});
