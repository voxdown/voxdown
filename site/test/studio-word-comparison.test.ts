import { describe, expect, it } from "vitest";
import { compareWords } from "../src/studio/word-comparison";
describe("bounded literal word comparison", () => {
  it("retains unchanged words and highlights replacement chunks on their own sides", () => {
    const result = compareWords("Mara walks home.\n", "Mara runs home.\n");
    expect(result?.before).toEqual([
      { text: "Mara ", changed: false },
      { text: "walks", changed: true },
      { text: " home.\n", changed: false },
    ]);
    expect(result?.after).toEqual([
      { text: "Mara ", changed: false },
      { text: "runs", changed: true },
      { text: " home.\n", changed: false },
    ]);
  });
  it.each([
    ["", "new"],
    ["old", ""],
    ["same", "same"],
    ["Éloïse 世界 👩‍🚀!", "Éloïse 世界 👨‍🚀?"],
    ["[[private]] <img> \\*literal*", "[[changed]] <script> \\*literal*"],
    ["a  b\n\t", "a b\n  "],
  ])("preserves every source character for %j versus %j", (before, after) => {
    const result = compareWords(before, after);
    expect(result).toBeDefined();
    expect(result?.before.map((x) => x.text).join("")).toBe(before);
    expect(result?.after.map((x) => x.text).join("")).toBe(after);
    expect(
      result?.before
        .filter((x) => !x.changed)
        .map((x) => x.text)
        .join(""),
    ).toBe(
      result?.after
        .filter((x) => !x.changed)
        .map((x) => x.text)
        .join(""),
    );
  });
  it("bounds long text and token matrix work instead of returning misleading partial highlights", () => {
    expect(compareWords("a".repeat(4097), "b")).toBeUndefined();
    expect(compareWords("one ".repeat(101), "two ".repeat(101))).toBeUndefined();
    expect(compareWords("a".repeat(4096), "b")).toBeDefined();
  });
  it("preserves reconstruction and common subsequences across repeated-token fixtures", () => {
    let state = 17;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state;
    };
    for (let fixture = 0; fixture < 200; fixture++) {
      const text = () =>
        Array.from(
          { length: random() % 20 },
          () => ["a", "b", " ", "\n", "[[", "😀"][random() % 6],
        ).join("");
      const a = text();
      const b = text();
      const result = compareWords(a, b);
      expect(result).toBeDefined();
      expect(result?.before.map((x) => x.text).join("")).toBe(a);
      expect(result?.after.map((x) => x.text).join("")).toBe(b);
      expect(
        result?.before
          .filter((x) => !x.changed)
          .map((x) => x.text)
          .join(""),
      ).toBe(
        result?.after
          .filter((x) => !x.changed)
          .map((x) => x.text)
          .join(""),
      );
    }
  });
});
