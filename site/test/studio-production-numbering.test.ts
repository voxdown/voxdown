import { describe, expect, it } from "vitest";
import { exportFdx } from "../src/studio/fdx";
import { parseFountain } from "../src/studio/fountain";
import {
  planCommitSceneNumber,
  planLock,
  planReleaseProductionLock,
  planSuggestedSceneNumbers,
  readProduction,
  sceneNumberSuggestions,
} from "../src/studio/production-numbering";
const scenes = (...labels: string[]) =>
  labels
    .map((number, index) => `INT. ROOM ${index}${number ? ` #${number}#` : ""}\n\n!Action.`)
    .join("\n\n");
const numbers = (source: string) => sceneNumberSuggestions(source).map((item) => item.number);

describe("portable production numbering", () => {
  it("can explicitly release a damaged lock while preserving labels and comment contents", () => {
    const source = "INT. ROOM #15#\n\n/* VoxDown production v9\n{broken}\n*/";
    const released = planReleaseProductionLock(source);
    expect(released.candidate).toBe(source.replace("VoxDown production", "Released lock"));
    expect(readProduction(released.candidate).locked).toBe(false);
    expect(parseFountain(released.candidate).elements[0]?.sceneNumber).toBe("15");
  });
  it("allocates sibling labels within a gap without growing on every insertion", () => {
    expect(numbers(scenes("15", "", "", "15A"))).toEqual(["15AA", "15AB"]);
    const labels = numbers(scenes("15", ...Array.from({ length: 1000 }, () => ""), "15A"));
    expect(new Set(labels).size).toBe(1000);
    expect(Math.max(...labels.map((label) => label.length))).toBeLessThan(7);
  });
  it("suggests sequential numbers without modifying source or overriding labels", () => {
    expect(numbers(scenes("15", "16", "", ""))).toEqual(["17", "18"]);
    expect(numbers(scenes("", "", ""))).toEqual(["1", "2", "3"]);
    expect(numbers(scenes("15", "", "", "16"))).toEqual(["15A", "15B"]);
    expect(numbers(scenes("15", "", "18"))).toEqual(["16"]);
  });
  it("uses deterministic nested inserted labels and avoids all document labels", () => {
    expect(numbers(scenes("15", "", "15A"))).toEqual(["15AA"]);
    expect(numbers(scenes("15A", "", "15B"))).toEqual(["15AA"]);
    expect(numbers(scenes("15", "", "16", "15A"))).toEqual(["15B"]);
    expect(numbers(scenes("15A", ""))).toEqual(["16"]);
  });
  it("reserves current explicit labels when locked and preserves every heading byte", () => {
    const source = scenes("015", "16", "");
    const result = planLock(source, true);
    expect(result.candidate.startsWith(source)).toBe(true);
    expect(readProduction(result.candidate)).toMatchObject({
      locked: true,
      reserved: ["015", "16"],
    });
    expect(planLock(result.candidate, true).changes).toEqual([]);
    expect(numbers(result.candidate)).toEqual(["17"]);
  });
  it("keeps deleted labels reserved across reload and commits new labels atomically", () => {
    const original = planLock(scenes("15", "16", "17", ""), true).candidate;
    const deleted = original.replace(/INT\. ROOM 2 #17#\n\n!Action\.\n\n/, "");
    expect(numbers(deleted)).toEqual(["18"]);
    const suggestion = sceneNumberSuggestions(deleted)[0];
    if (!suggestion) throw new Error("Missing suggestion");
    const committed = planCommitSceneNumber(deleted, suggestion.line);
    expect(committed.changes).toHaveLength(2);
    expect(committed.candidate).toContain("INT. ROOM 3 #18#");
    expect(readProduction(committed.candidate).reserved).toEqual(["15", "16", "17", "18"]);
    expect(numbers(committed.candidate)).toEqual([]);
    expect(() => planCommitSceneNumber(committed.candidate, suggestion.line)).toThrow(
      /never replaced/,
    );
  });
  it("does not suggest reserved deleted insertion labels", () => {
    const locked = planLock(scenes("15", "15A", "16", ""), true).candidate;
    const source = locked.replace("INT. ROOM 1 #15A#", "INT. ROOM 1");
    expect(numbers(source)).toEqual(["15B", "17"]);
  });
  it("unlocks by removing only its own block and leaves numbers and user comments intact", () => {
    const source = `${scenes("15", "16")}\n\n/* writer notes */`;
    const locked = planLock(source, true).candidate;
    const unlocked = planLock(locked, false).candidate;
    expect(unlocked).toBe(`${source}\n\n`);
    expect(readProduction(unlocked)).toEqual({ locked: false, reserved: [] });
  });
  it.each(["\n", "\r\n", "\r"])(
    "preserves %j source endings and hides metadata in output",
    (newline) => {
      const source = scenes("15", "").replaceAll("\n", newline);
      const locked = planLock(source, true).candidate;
      expect(readProduction(locked).locked).toBe(true);
      const parsed = parseFountain(locked);
      expect(parsed.warnings).toEqual([]);
      expect(
        parsed.elements
          .filter((e) => e.kind !== "blank" && e.kind !== "boneyard")
          .map((e) => [e.kind, e.text]),
      ).toEqual(
        parseFountain(source)
          .elements.filter((e) => e.kind !== "blank" && e.kind !== "boneyard")
          .map((e) => [e.kind, e.text]),
      );
      expect(
        parsed.omissions.some((span) =>
          locked.slice(span.from, span.to).includes("VoxDown production"),
        ),
      ).toBe(true);
    },
  );
  it("commits all suggestions and metadata atomically while excluding metadata from FDX", () => {
    const source = planLock(scenes("15", "", "", "16", ""), true).candidate;
    const result = planSuggestedSceneNumbers(source);
    expect(result.changes).toHaveLength(4);
    expect(numbers(result.candidate)).toEqual([]);
    expect(readProduction(result.candidate).reserved).toEqual(["15", "16", "15A", "15B", "17"]);
    const xml = exportFdx(result.candidate).xml;
    expect(xml).not.toContain("VoxDown production");
    expect(xml).not.toContain("reserved");
    expect(xml).toContain('Number="15A"');
    expect(planSuggestedSceneNumbers(result.candidate).changes).toEqual([]);
  });
  it("keeps integer identities exact even beyond JavaScript safe integers", () => {
    expect(numbers(scenes("9007199254740992", ""))).toEqual(["9007199254740993"]);
    expect(numbers(scenes("0001", "1", "", "3"))).toEqual(["2"]);
    expect(readProduction(planLock(scenes("0001", "1"), true).candidate).reserved).toEqual([
      "0001",
    ]);
  });
  it("avoids guessing around exotic and descending neighbours", () => {
    expect(numbers(scenes("A-15", "", "16"))).toEqual([]);
    expect(numbers(scenes("15", "", "14"))).toEqual([]);
    expect(numbers(scenes("15", "", "15a"))).toEqual([]);
    expect(numbers(scenes("15a", "", "16"))).toEqual([]);
  });
  it("excludes private, styled and escaped headings and safely commits the remainder", () => {
    const source =
      "/*\nINT. SECRET\n*/\n\nINT. PUBLIC [[private]]\n\nINT. *STYLED*\n\nINT. ESCAPED \\*\n\nINT. SAFE";
    const suggestions = sceneNumberSuggestions(source);
    expect(suggestions).toHaveLength(1);
    expect(planCommitSceneNumber(source, suggestions[0]?.line ?? 0).candidate).toBe(
      `${source} #1#`,
    );
  });
  it.each([
    '/* VoxDown production v2\n{"reserved":[]}\n*/',
    "/* VoxDown production v1\nnope\n*/",
    '/* VoxDown production v1\n{"reserved":["1","01"]}\n*/',
    '/* VoxDown production v1\n{"reserved":[null]}\n*/',
    '/* VoxDown production v1\n{"reserved":[],"extra":true}\n*/',
    '/* VoxDown production v1\n{"reserved":[]}\n',
    '\\/* VoxDown production v1\n{"reserved":[]}\n*/',
  ])("fails closed for invalid metadata %s", (metadata) => {
    const source = `${scenes("15", "")}\n\n${metadata}`;
    expect(() => readProduction(source)).toThrow();
    expect(() => sceneNumberSuggestions(source)).toThrow();
    expect(() => planLock(source, false)).toThrow();
  });
  it("fails closed for duplicate metadata, nested comments and incomplete private passages", () => {
    const locked = planLock(scenes(""), true).candidate;
    const state = readProduction(locked);
    expect(() => numbers(`${locked}\n\n${locked.slice(state.from, state.to)}`)).toThrow(/metadata/);
    expect(() => numbers("/* outer /* inner */\nINT. SECRET\n*/")).toThrow();
    expect(() => numbers("INT. A\n\n[[unfinished")).toThrow(/incomplete/);
  });
  it("reports lock state while the author has an unrelated unfinished private note", () => {
    expect(readProduction("INT. A\n\n[[unfinished")).toEqual({ locked: false, reserved: [] });
    const source = `${planLock(scenes("15"), true).candidate}\n\n[[unfinished`;
    expect(readProduction(source)).toMatchObject({ locked: true, reserved: ["15"] });
    expect(() => sceneNumberSuggestions(source)).toThrow(/incomplete/);
  });
  it("validates source size before reading or extending metadata", () => {
    expect(() => numbers("!".repeat(500001))).toThrow(/500,000/);
    expect(() => planLock(`!${"x".repeat(499999)}`, true)).toThrow(/500,000/);
  });
  it("supports a supplied parsed document and thousands of suggestions in one pass", () => {
    const source = scenes(...Array.from({ length: 3000 }, () => ""));
    const suggestions = sceneNumberSuggestions(source, parseFountain(source));
    expect(suggestions).toHaveLength(3000);
    expect(suggestions.at(-1)?.number).toBe("3000");
  });
});
