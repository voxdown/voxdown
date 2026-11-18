import { describe, expect, it } from "vitest";
import { captureScrapOrigin, locateScrapOrigin } from "../src/studio/scrap-origin";
import { readScrapBook, writeScrapBook } from "../src/studio/scraps-storage";

describe("returning scraps conservatively", () => {
  const before = `Earlier scene.\n${"A".repeat(180)}\n`;
  const after = `\n${"B".repeat(180)}\nLater scene.`;
  const passage = "NORA\n**Not this ending.**";
  const source = before + passage + after;
  const origin = captureScrapOrigin(source, before.length, before.length + passage.length);
  it("finds an intact passage after unrelated insertions without duplicating it", () => {
    const result = locateScrapOrigin(`New opening.\n${source}`, origin);
    expect(result).toEqual({
      from: before.length + 13,
      to: before.length + passage.length + 13,
      present: true,
    });
  });
  it("finds the gap after a moved selection, including after reload serialization", () => {
    expect(
      locateScrapOrigin(`New opening.\n${before}${after}`, JSON.parse(JSON.stringify(origin))),
    ).toEqual({ from: before.length + 13, to: before.length + 13, present: false });
  });
  it("refuses changed, repeated, or partially replaced contexts", () => {
    expect(locateScrapOrigin(`${before}Another ending.${after}`, origin)).toBeNull();
    expect(locateScrapOrigin(source + source, origin)).toBeNull();
    expect(locateScrapOrigin(before.slice(0, -3) + passage + after, origin)).toBeNull();
    expect(locateScrapOrigin(source + before + after, origin)).toBeNull();
  });
  it("handles whole-document and boundary selections without guessing", () => {
    const whole = captureScrapOrigin(passage, 0, passage.length);
    expect(locateScrapOrigin("", whole)).toEqual({ from: 0, to: 0, present: false });
    expect(locateScrapOrigin("new text", whole)).toBeNull();
    expect(locateScrapOrigin(passage, whole)?.present).toBe(true);
    const beginning = captureScrapOrigin(passage + after, 0, passage.length);
    expect(locateScrapOrigin(after, beginning)?.from).toBe(0);
    expect(locateScrapOrigin(`elsewhere${after}`, beginning)).toBeNull();
  });
  it("validates optional origin metadata without breaking older scraps", () => {
    let value: string | null = null;
    const store = {
      getItem: () => value,
      setItem: (_key: string, raw: string) => {
        value = raw;
      },
    };
    const scrap = { id: "1", text: passage, note: "", from: "", at: 1, origin, pinned: true };
    writeScrapBook(store, "draft", null, { version: 1, scraps: [scrap], deleted: [] });
    expect(readScrapBook(store, "draft").book.scraps[0]).toEqual(scrap);
    value = JSON.stringify({
      version: 1,
      scraps: [{ ...scrap, origin: { ...origin, before: "x".repeat(161) } }],
      deleted: [],
    });
    expect(() => readScrapBook(store, "draft")).toThrow("unsupported data");
  });
});
