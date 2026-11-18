import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_BYTES,
  MAX_PROJECT_SNAPSHOTS,
  createProject,
  parseProject,
  projectName,
  serializeProject,
} from "../src/studio/project";
import { MAX_LINES, MAX_SOURCE } from "../src/studio/source";

const draft = { name: "The dragon.fountain", source: "INT. CAVE - DAY\n\nA dragon sleeps." };
const snapshot = { name: "Before the ending", source: "Old ending.", created: 1234 };
function raw(changes: Record<string, unknown>): string {
  return JSON.stringify({ ...createProject(draft), ...changes });
}
describe("portable Studio projects", () => {
  it("round trips exact source and named snapshots without browser identities", () => {
    const original = "\uFEFFTitle: Café 🐉\r\n\r\nINT. CAVE - DAY\n\n[[unfinished\r";
    const project = createProject({ name: "Dragon", source: original }, [snapshot]);
    const restored = parseProject(serializeProject(project));
    expect(restored).toEqual(project);
    expect(restored.draft.source).toBe(original);
    expect(restored.snapshots[0]).toEqual(snapshot);
    expect(Object.keys(restored.snapshots[0] ?? {})).toEqual(["name", "source", "created"]);
  });
  it("accepts an optional JSON BOM and empty screenplay content", () => {
    const project = createProject({ name: "Untitled", source: "" });
    expect(parseProject(`\uFEFF${serializeProject(project)}`)).toEqual(project);
  });
  it("returns independent content objects, leaving inputs untouched", () => {
    const supplied = { ...draft };
    const suppliedSnapshot = { ...snapshot };
    const project = createProject(supplied, [suppliedSnapshot]);
    project.draft.source = "Changed";
    const copiedSnapshot = project.snapshots[0];
    if (!copiedSnapshot) throw new Error("Expected copied snapshot");
    copiedSnapshot.name = "Changed";
    expect(supplied).toEqual(draft);
    expect(suppliedSnapshot).toEqual(snapshot);
  });
  it("rejects unrecognized formats, old/future versions and malformed JSON", () => {
    expect(() => parseProject(raw({ format: "other" }))).toThrow(/not a VoxDown/);
    for (const version of [0, 2, "1", null])
      expect(() => parseProject(raw({ version }))).toThrow(/version is unsupported/);
    for (const value of ["", "{", "null", "[]", "42"])
      expect(() => parseProject(value)).toThrow(/cannot be opened/);
  });
  it("rejects unexpected fields and prototype-pollution payloads", () => {
    const good = serializeProject(createProject(draft));
    for (const key of ["__proto__", "constructor", "prototype", "settings"])
      expect(() => parseProject(good.replace('"draft": {', `"draft": {"${key}": {},`))).toThrow(
        /unsupported fields/,
      );
    expect(() => parseProject(raw({ extra: true }))).toThrow(/unsupported fields/);
    expect({}.toString).toBe(Object.prototype.toString);
  });
  it("requires source strings and bounded, nonempty names", () => {
    for (const source of [null, [], {}, 42])
      expect(() => parseProject(raw({ draft: { ...draft, source } }))).toThrow(/must be text/);
    for (const name of [null, "", "  ", "x".repeat(201), "Bad\nname", "Bad\0name"])
      expect(() => parseProject(raw({ draft: { ...draft, name } }))).toThrow(/needs a name/);
  });
  it("enforces each screenplay's character, line and binary limits", () => {
    for (const source of ["x".repeat(MAX_SOURCE + 1), "\n".repeat(MAX_LINES), "binary\0"])
      expect(() => createProject({ ...draft, source })).toThrow(/Draft:/);
    expect(() => createProject(draft, [{ ...snapshot, source: "\n".repeat(MAX_LINES) }])).toThrow(
      /Snapshot 1:/,
    );
  });
  it("bounds total text independently from per-screenplay limits", () => {
    const full = "x".repeat(MAX_SOURCE);
    expect(() =>
      createProject({ ...draft, source: full }, Array(4).fill({ ...snapshot, source: full })),
    ).toThrow(/combined screenplay characters/);
    expect(
      createProject({ ...draft, source: full }, Array(3).fill({ ...snapshot, source: full })),
    ).toBeDefined();
  });
  it("bounds snapshots and rejects holes, missing fields and invalid dates", () => {
    expect(() => createProject(draft, Array(MAX_PROJECT_SNAPSHOTS + 1).fill(snapshot))).toThrow(
      /at most 50/,
    );
    expect(() => createProject(draft, new Array(1))).toThrow(/plain list/);
    expect(() => parseProject(raw({ snapshots: {} }))).toThrow(/must be a list/);
    expect(() => parseProject(raw({ snapshots: [{ name: "Missing", source: "" }] }))).toThrow(
      /missing or unsupported/,
    );
    for (const created of [null, "123", -1, 1.5, 8_640_000_000_000_001])
      expect(() => parseProject(raw({ snapshots: [{ ...snapshot, created }] }))).toThrow(
        /invalid creation time/,
      );
  });
  it("checks UTF-8 file bytes before attempting JSON parsing", () => {
    expect(() => parseProject(" ".repeat(MAX_PROJECT_BYTES + 1))).toThrow(/16 MB/);
    expect(() => parseProject("🐉".repeat(MAX_PROJECT_BYTES / 4 + 1))).toThrow(/16 MB/);
  });
  it("does not invoke accessor values and validates again before serialization", () => {
    let read = false;
    const unsafe = {
      name: "Getter",
      get source() {
        read = true;
        return "";
      },
    };
    expect(() => createProject(unsafe)).toThrow(/unsupported property/);
    expect(read).toBe(false);
    const unsafeList = [snapshot];
    Object.defineProperty(unsafeList, "0", {
      enumerable: true,
      get() {
        read = true;
        return snapshot;
      },
    });
    expect(() => createProject(draft, unsafeList)).toThrow(/plain object/);
    expect(read).toBe(false);
    const project = createProject(draft);
    project.draft.source = "binary\0";
    expect(() => serializeProject(project)).toThrow(/binary/);
  });
  it("makes safe portable filenames without paths, controls or reserved device names", () => {
    expect(projectName("../Dragon\\Take:1.fountain")).toBe("-Dragon-Take-1.studio.json");
    expect(projectName("CON.txt")).toBe("_CON.studio.json");
    expect(projectName("... ")).toBe("Untitled.studio.json");
    expect(projectName("Café 🐉.studio.json")).toBe("Café 🐉.studio.json");
    expect(projectName("long".repeat(100)).length).toBeLessThanOrEqual(132);
    expect(projectName("Bad\u202ename\0")).toBe("Bad-name-.studio.json");
    const unicodeName = projectName("龍🐉".repeat(100));
    expect(new TextEncoder().encode(unicodeName).length).toBeLessThan(200);
    expect(unicodeName).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});
