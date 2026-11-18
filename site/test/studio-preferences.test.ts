import { describe, expect, it, vi } from "vitest";
import {
  defaultPreferences,
  parsePreferences,
  readPreferences,
  savePreferences,
} from "../src/studio/preferences";

describe("Studio workspace preferences", () => {
  it("migrates old preferences into the default writing workspace", () => {
    expect(parsePreferences({ theme: "dark", textSize: 18, typewriter: true })).toEqual({
      ...defaultPreferences,
      theme: "night",
      textSize: 18,
      typewriter: true,
    });
    for (const value of [null, undefined, [], "invalid", 42])
      expect(parsePreferences(value)).toEqual(defaultPreferences);
    expect(
      parsePreferences({
        toolbar: "false",
        margins: 0,
        outline: null,
        preview: "true",
        paper: "A3",
        textSize: "20",
      }),
    ).toEqual(defaultPreferences);
  });
  it("round-trips all intentional workspace choices without storing unrelated data", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const value = {
        ...defaultPreferences,
        toolbar: false,
        margins: false,
        outline: false,
        preview: true,
        paper: "a4" as const,
      };
      expect(savePreferences({ ...value, screenplay: "private" } as typeof value)).toBe(true);
      expect(readPreferences()).toEqual(value);
      expect(storage.get("studio-preferences")).not.toContain("private");
      storage.set("studio-preferences", "broken json");
      expect(readPreferences()).toEqual(defaultPreferences);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps usable defaults and reports denied storage without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("Storage blocked");
      },
      setItem() {
        throw new Error("Storage blocked");
      },
    });
    try {
      expect(readPreferences()).toEqual(defaultPreferences);
      expect(savePreferences(defaultPreferences)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
