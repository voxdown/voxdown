import { describe, expect, it } from "vitest";
import { createWorkspaceSession } from "../src/studio/workspace-session";
const position = { anchor: 7, head: 12, scrollTop: 500, documentLength: 40 };
function storage(initial?: string) {
  let raw = initial ?? "";
  return {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
  };
}
describe("Studio workspace position", () => {
  it("restores selections and scrolling per draft across sessions, without storing source", () => {
    const disk = storage();
    const session = createWorkspaceSession(disk);
    expect(session.save("first", position)).toBe(true);
    session.save("second", { ...position, anchor: 20, head: 20 });
    const reopened = createWorkspaceSession(disk);
    expect(reopened.restore("first", 40)).toEqual(position);
    expect(reopened.restore("second", 40)?.head).toBe(20);
    expect(Object.keys(JSON.parse(disk.getItem())[0]).sort()).toEqual([
      "anchor",
      "documentLength",
      "head",
      "id",
      "scrollTop",
      "updated",
    ]);
  });
  it("clamps caret and drops stale pixel offsets after source length changes", () => {
    const session = createWorkspaceSession(storage());
    session.save("draft", position);
    expect(session.restore("draft", 5)).toEqual({
      anchor: 5,
      head: 5,
      scrollTop: 0,
      documentLength: 5,
    });
    expect(session.restore("missing", 10)).toBeUndefined();
    expect(session.restore("draft", -1)).toBeUndefined();
  });
  it("retains a visible source anchor without trusting it after the source length changes", () => {
    const session = createWorkspaceSession(storage());
    const anchored = { ...position, viewportAnchor: 4, viewportOffset: -18 };
    expect(session.save("draft", anchored)).toBe(true);
    expect(session.restore("draft", 40)).toEqual(anchored);
    expect(session.restore("draft", 30)?.viewportAnchor).toBeUndefined();
    expect(session.save("bad", { ...anchored, viewportAnchor: 41 })).toBe(false);
    expect(session.save("bad", { ...anchored, viewportOffset: Number.NaN })).toBe(false);
  });
  it("keeps only 80 recent view states, retaining the active draft on timestamp ties", () => {
    const disk = storage();
    const session = createWorkspaceSession(disk);
    for (let i = 0; i < 100; i++) session.save(String(i), position);
    expect(JSON.parse(disk.getItem())).toHaveLength(80);
    expect(session.restore("99", 40)).toEqual(position);
    expect(session.restore("0", 40)).toBeUndefined();
  });
  it("survives denied writes and reads using memory and refuses invalid positions", () => {
    const session = createWorkspaceSession({
      getItem: () => {
        throw new Error("Denied");
      },
      setItem: () => {
        throw new Error("Full");
      },
    });
    expect(session.save("draft", position)).toBe(false);
    expect(session.restore("draft", 40)).toEqual(position);
    expect(session.save("draft", { ...position, anchor: Number.POSITIVE_INFINITY })).toBe(false);
    expect(session.save("draft", { ...position, head: 41 })).toBe(false);
    expect(session.restore("draft", 40)).toEqual(position);
  });
  it("ignores corrupt or oversized storage and strips unknown stored fields", () => {
    for (const raw of [
      "{",
      "null",
      "[]".repeat(20000),
      JSON.stringify([{ ...position, id: "bad", updated: 1, head: -1 }]),
    ]) {
      const session = createWorkspaceSession(storage(raw));
      expect(session.restore("bad", 40)).toBeUndefined();
      expect(session.save("draft", position)).toBe(true);
    }
    const disk = storage(
      JSON.stringify([{ ...position, id: "legacy", updated: 1, source: "PRIVATE TEXT" }]),
    );
    const session = createWorkspaceSession(disk);
    session.save("new", position);
    expect(disk.getItem()).not.toContain("PRIVATE TEXT");
  });
});
