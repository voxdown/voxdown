import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE,
  encodeUtf8Losslessly,
  fountainName,
  readSource,
  writeSource,
} from "../src/studio/source";

describe("Studio source files", () => {
  it("retains exact original bytes through an unchanged open/download, including BOM and mixed newlines", () => {
    const original = "\uFEFFTitle: Café\r\n\r\nINT. ROOM - DAY\n\nADA\rA line.\n";
    const file = readSource(original);
    expect(file.mixed).toBe(true);
    expect(writeSource(file, file.normalized)).toBe(original);
    expect(writeSource(file, `${file.normalized}More.`)).toBe(
      "\uFEFFTitle: Café\r\n\r\nINT. ROOM - DAY\r\n\r\nADA\r\nA line.\r\nMore.",
    );
  });
  it("can reopen any accepted normalized draft with CRLF serialization", () => {
    const file = readSource("A\r\n");
    const edited = `${"A".repeat(25)}\n`.repeat(19_000);
    const saved = writeSource(file, edited);
    expect(saved.length).toBe(513_000);
    expect(readSource(saved).normalized).toBe(edited);
  });
  it("bounds line count independently of file size", () => {
    expect(() => readSource(".A\n".repeat(20_000))).toThrow(/20,000 lines/);
  });
  it("rejects binary and oversized inputs without returning partial content", () => {
    expect(() => readSource("abc\0def")).toThrow(/binary/);
    expect(() => readSource("a".repeat(MAX_SOURCE + 1))).toThrow(/500,000/);
  });
  it("does not serialize through a parser, even for unknown syntax or incomplete notes", () => {
    const value = "Custom: metadata\n\n[[incomplete\n!KEEP ALL OF THIS\n";
    const file = readSource(value);
    expect(writeSource(file, file.normalized)).toBe(value);
  });
  it("makes a portable Fountain download name", () => {
    expect(fountainName("../draft\u0001.txt")).toBe("-draft-.fountain");
    expect(fountainName(" ")).toBe("Untitled.fountain");
    expect(fountainName("CON.txt")).toBe("_CON.fountain");
    expect(fountainName("name\u202efile.txt")).toBe("name-file.fountain");
    expect(new TextEncoder().encode(fountainName("龍".repeat(200))).length).toBeLessThan(200);
  });
});

describe("lossless UTF-8 source encoding", () => {
  it("preserves BOM, mixed newlines, combining marks and supplementary characters", () => {
    const text = "\uFEFFCafe\u0301 🌙\r\n\r\nA\nB\rC";
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(encodeUtf8Losslessly(text))).toBe(
      text,
    );
  });
  it.each(["A\ud800B", "A\udfffB", "\ud800\ud800", "\udfff\ud800"])(
    "refuses unpaired surrogates without mutating source",
    (text) => {
      expect(() => encodeUtf8Losslessly(text)).toThrow(/incomplete Unicode character/);
      expect(JSON.parse(JSON.stringify({ text })).text).toBe(text);
    },
  );
});
