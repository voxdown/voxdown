// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Keeper, keepScraps, scrapsFile } from "../src/writer/scraps";
import { ScrapsFiles } from "../src/writer/scraps-files";

/** A browser's storage, in memory. */
function keeper(): Keeper & { removeItem(key: string): void } {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  };
}

/** A file on a disk in memory, as the File System Access API gives one. */
function fileOn(disk: { text: string }) {
  return {
    name: "owl.scraps.md",
    kind: "file",
    getFile: async () => new File([disk.text], "owl.scraps.md"),
    createWritable: async () => {
      let written = "";
      return {
        write: async (text: string) => {
          written += text;
        },
        close: async () => {
          disk.text = written;
        },
      };
    },
    isSameEntry: async () => true,
  } as unknown as FileSystemFileHandle;
}

const owl = { id: "a1", text: "The owl said nothing.", note: "", at: 0, from: "" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a scraps file beside a story", () => {
  it("is never written over unasked when it holds words besides the scraps", async () => {
    const store = keeper();
    keepScraps(store, "owl", [owl], "owl.vxd");
    // The file holds these very scraps, and a note of the writer's above them.
    const disk = { text: `My own note, not a scrap.\n\n${scrapsFile([owl], "The Owl")}` };
    vi.stubGlobal("showSaveFilePicker", async () => fileOn(disk));
    const asked: string[] = [];
    const files = new ScrapsFiles(
      {
        story: () => ({ id: "owl", name: "owl.vxd", title: "The Owl" }),
        notice: () => {},
        ask: async (message) => {
          asked.push(message);
          return "cancel";
        },
        download: () => {},
        redraw: () => {},
        show: () => {},
      },
      store,
    );
    await files.save(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("words of its own besides");
    expect(disk.text).toContain("My own note, not a scrap.");
  });

  it("writes over what it wrote itself, or an empty file, without asking", async () => {
    const store = keeper();
    keepScraps(store, "owl", [owl], "owl.vxd");
    const disk = { text: "" };
    vi.stubGlobal("showSaveFilePicker", async () => fileOn(disk));
    const asked: string[] = [];
    const host = {
      story: () => ({ id: "owl", name: "owl.vxd", title: "The Owl" }),
      notice: () => {},
      ask: async (message: string) => {
        asked.push(message);
        return "cancel";
      },
      download: () => {},
      redraw: () => {},
      show: () => {},
    };
    await new ScrapsFiles(host, store).save(true);
    expect(disk.text).toContain("The owl said nothing.");
    // A new visit (a reload): what it wrote is still known as its own.
    keepScraps(store, "owl", [owl, { ...owl, id: "b2", text: "A fox." }], "owl.vxd");
    await new ScrapsFiles(host, store).save(true);
    expect(asked).toEqual([]);
    expect(disk.text).toContain("A fox.");
  });
});
