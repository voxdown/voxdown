// Real IndexedDB tests: uses the Chromium installed for site:check, without an IndexedDB mock.
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Storage from "../src/studio/storage";

declare global {
  interface Window {
    recoveryStore: typeof Storage;
    oldConnection?: IDBDatabase;
  }
}
const compiled = transpileModule(
  readFileSync(new URL("../src/studio/storage.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
let browser: Browser;
let context: BrowserContext;
let page: Page;
async function load() {
  await page.addScriptTag({
    type: "module",
    content: `import * as api from "data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}"; window.recoveryStore = api;`,
  });
  await page.waitForFunction(() => Boolean(window.recoveryStore));
}
async function seedV1(keepOpen = false) {
  await page.evaluate(async (keepOpen) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("voxdown-studio", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("drafts", { keyPath: "id" }).put({
          id: "legacy",
          name: "Original.fountain",
          source: "\uFEFFINT. ROOM - DAY\r\n[[private]]",
          updated: 12,
        });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (keepOpen) window.oldConnection = request.result;
        else request.result.close();
        resolve();
      };
    });
  }, keepOpen);
}

beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32701/**", (route) =>
    route.fulfill({ body: "<html></html>" }),
  );
  await page.goto("http://localhost:32701/");
});
afterEach(async () => context.close());
afterAll(async () => browser.close());

describe("Studio recovery in real IndexedDB", () => {
  it("bounds a stalled transaction and leaves recovery usable after uncertain completion", async () => {
    await load();
    const result = await page.evaluate(async () => {
      await window.recoveryStore.listDrafts();
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete");
      if (!descriptor) throw new Error("Missing native IDB event descriptor");
      Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
        configurable: true,
        set() {},
      });
      let message = "";
      try {
        await window.recoveryStore.keepDraft({
          id: "stalled",
          name: "Safe",
          source: "Keep this",
          updated: 1,
        });
      } catch (error) {
        message = String(error);
      } finally {
        Object.defineProperty(IDBTransaction.prototype, "oncomplete", descriptor);
      }
      const draft = await window.recoveryStore.getDraft("stalled");
      return { message, source: draft?.source };
    });
    expect(result.message).toMatch(/did not confirm.*in time/);
    expect(result.source).toBe("Keep this");
  }, 15000);

  it("migrates v1 without changing exact source and lists metadata without source-store reads", async () => {
    await seedV1();
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      const draft = await api.getDraft("legacy");
      const original = IDBDatabase.prototype.transaction;
      const accessed: string[][] = [];
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        accessed.push(typeof stores === "string" ? [stores] : [...stores]);
        return original.call(this, stores, mode, options);
      };
      const listed = await api.listDrafts();
      IDBDatabase.prototype.transaction = original;
      return { draft, listed, accessed };
    });
    expect(result.draft?.source).toBe("\uFEFFINT. ROOM - DAY\r\n[[private]]");
    expect(result.listed.items).toEqual([
      { id: "legacy", name: "Original.fountain", updated: 12, characters: 29 },
    ]);
    expect(result.accessed).toEqual([["draft-metadata"]]);
  });

  it("migrates valid v1 drafts beside corrupt records and preserves every original record", async () => {
    await seedV1();
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("voxdown-studio", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const connection = request.result;
          const tx = connection.transaction("drafts", "readwrite");
          const store = tx.objectStore("drafts");
          store.put({ id: "bad-source", name: "Broken", source: null, updated: 20 });
          store.put({ id: "bad-time", name: "Broken", source: "Keep me", updated: Number.NaN });
          store.put({ id: "bad-name", name: 42, source: "Keep me too", updated: 21 });
          tx.oncomplete = () => {
            connection.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      const listed = await api.listDrafts();
      const valid = await api.getDraft("legacy");
      const errors: string[] = [];
      for (const id of ["bad-source", "bad-time", "bad-name"]) {
        try {
          await api.getDraft(id);
        } catch (caught) {
          errors.push(String(caught));
        }
      }
      const raw = await new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open("voxdown-studio", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const connection = request.result;
          const tx = connection.transaction("drafts", "readonly");
          const read = tx.objectStore("drafts").getAll();
          tx.oncomplete = () => {
            connection.close();
            resolve(read.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      return { listed, valid, errors, raw };
    });
    expect(result.listed.items.map((item) => item.id)).toEqual(["legacy"]);
    expect(result.valid?.source).toBe("\uFEFFINT. ROOM - DAY\r\n[[private]]");
    expect(result.errors).toHaveLength(3);
    expect(
      result.errors.every(
        (error) => error.includes("invalid recovery data") && error.includes("preserved"),
      ),
    ).toBe(true);
    expect(result.raw).toHaveLength(4);
    expect(result.raw).toContainEqual({
      id: "bad-source",
      name: "Broken",
      source: null,
      updated: 20,
    });
    expect(result.raw).toContainEqual({
      id: "bad-time",
      name: "Broken",
      source: "Keep me",
      updated: Number.NaN,
    });
  });

  it("rejects malformed snapshots and skips corrupt metadata without hiding valid snapshots", async () => {
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      const valid = await api.createSnapshot({ name: "Good", source: "INT. ROOM - DAY" });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("voxdown-studio", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const connection = request.result;
          const tx = connection.transaction(["snapshots", "snapshot-metadata"], "readwrite");
          tx.objectStore("snapshots").put({
            id: "broken",
            name: "Broken",
            source: null,
            created: 1,
          });
          tx.objectStore("snapshot-metadata").put({
            id: "broken",
            name: null,
            characters: -1,
            created: 1,
          });
          tx.oncomplete = () => {
            connection.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      let error = "";
      try {
        await api.getSnapshot("broken");
      } catch (caught) {
        error = String(caught);
      }
      return { error, listed: await api.listSnapshots(), valid: await api.getSnapshot(valid.id) };
    });
    expect(result.error).toContain("saved snapshot contains invalid recovery data");
    expect(result.listed.items.map((item) => item.name)).toEqual(["Good"]);
    expect(result.valid?.source).toBe("INT. ROOM - DAY");
  });

  it("pages equal timestamps without duplicates, caps hydration, and updates metadata atomically", async () => {
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      for (let index = 0; index < 105; index++) {
        await api.keepDraft({
          id: String(index).padStart(3, "0"),
          name: "Draft",
          source: "Text",
          updated: 1,
        });
      }
      const first = await api.listDrafts({ limit: 100 });
      const second = await api.listDrafts({ limit: 100, before: first.next });
      const recent = await api.recentDrafts();
      await api.keepDraft({ id: "000", name: "Renamed", source: "Longer text", updated: 2 });
      const newest = await api.listDrafts({ limit: 1 });
      return { first, second, recent: recent.length, newest };
    });
    expect(result.first.items).toHaveLength(100);
    expect(result.second.items).toHaveLength(5);
    expect(result.second.next).toBeUndefined();
    expect(new Set([...result.first.items, ...result.second.items].map((x) => x.id)).size).toBe(
      105,
    );
    expect(result.recent).toBe(50);
    expect(result.newest.items[0]).toEqual({
      id: "000",
      name: "Renamed",
      characters: 11,
      updated: 2,
    });
  });

  it("keeps immutable named snapshots separate from mutable drafts and explicitly deletes both records", async () => {
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      await api.keepDraft({ id: "active", name: "Draft", source: "Before", updated: 1 });
      const snapshot = await api.createSnapshot({
        name: "Act one",
        source: "Before",
        draftId: "active",
      });
      await api.keepDraft({ id: "active", name: "Draft", source: "After", updated: 2 });
      const saved = await api.getSnapshot(snapshot.id);
      const listed = await api.listSnapshots();
      await api.deleteDraft("active");
      const stillSaved = await api.getSnapshot(snapshot.id);
      await api.deleteSnapshot(snapshot.id);
      await api.deleteDraft("missing");
      return {
        snapshot,
        saved,
        listed,
        stillSaved,
        draft: await api.getDraft("active"),
        deleted: await api.getSnapshot(snapshot.id),
        drafts: await api.listDrafts(),
        snapshots: await api.listSnapshots(),
      };
    });
    expect(result.snapshot.id).not.toBe("active");
    expect(result.saved?.source).toBe("Before");
    expect(result.stillSaved).toEqual(result.saved);
    expect(result.listed.items[0]).not.toHaveProperty("source");
    expect(result.listed.items[0]?.characters).toBe(6);
    expect(result.deleted).toBeUndefined();
    expect(result.draft).toBeUndefined();
    expect(result.drafts.items).toEqual([]);
    expect(result.snapshots.items).toEqual([]);
  });

  it("rolls back draft writes when metadata storage fails", async () => {
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      await api.keepDraft({ id: "active", name: "Draft", source: "Original", updated: 1 });
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "draft-metadata")
          throw new DOMException("Storage full", "QuotaExceededError");
        return original.apply(this, args);
      };
      let error = "";
      try {
        await api.keepDraft({ id: "active", name: "Changed", source: "Unsaved", updated: 2 });
      } catch (caught) {
        error = String(caught);
      }
      IDBObjectStore.prototype.put = original;
      return { error, draft: await api.getDraft("active"), metadata: await api.listDrafts() };
    });
    expect(result.error).toContain("Storage full");
    expect(result.draft?.source).toBe("Original");
    expect(result.metadata.items[0]?.updated).toBe(1);
  });

  it("reports blocked upgrades and can retry after an older tab closes", async () => {
    await seedV1(true);
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      let error = "";
      try {
        await api.listDrafts();
      } catch (caught) {
        error = String(caught);
      }
      window.oldConnection?.close();
      return { error, draft: await api.getDraft("legacy") };
    });
    expect(result.error).toContain("Close older Studio tabs");
    expect(result.draft?.name).toBe("Original.fountain");
  });

  it("retries after unavailable storage and closes connections on versionchange", async () => {
    await load();
    const result = await page.evaluate(async () => {
      const api = window.recoveryStore;
      const original = IDBFactory.prototype.open;
      IDBFactory.prototype.open = () => {
        throw new Error("Storage disabled");
      };
      let error = "";
      try {
        await api.listDrafts();
      } catch (caught) {
        error = String(caught);
      }
      IDBFactory.prototype.open = original;
      await api.keepDraft({ id: "active", name: "Draft", source: "Text", updated: 1 });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("voxdown-studio");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Connection was not closed"));
      });
      return { error, fresh: await api.listDrafts() };
    });
    expect(result.error).toContain("Storage disabled");
    expect(result.fresh.items).toEqual([]);
  });

  it("rejects unbounded or invalid page sizes", async () => {
    await load();
    const errors = await page.evaluate(async () => {
      const errors: string[] = [];
      for (const limit of [0, 101, -1, 1.2]) {
        try {
          await window.recoveryStore.listDrafts({ limit });
        } catch (caught) {
          errors.push(String(caught));
        }
      }
      return errors;
    });
    expect(errors).toHaveLength(4);
    expect(errors.every((error) => error.includes("between 1 and 100"))).toBe(true);
  });
});
