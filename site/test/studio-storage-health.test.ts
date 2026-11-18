import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountStorageHealth } from "../src/studio/storage-health";

declare global {
  interface Window {
    healthUI: ReturnType<typeof mountStorageHealth>;
    healthCalls: {
      estimate: number;
      persisted: number;
      persist: number;
      gesture: boolean;
      actions: string[];
    };
    healthMock: {
      estimate(): Promise<StorageEstimate>;
      persisted(): Promise<boolean>;
      persist(): Promise<boolean>;
    };
    healthResolveEstimate?: (value: StorageEstimate) => void;
    healthResolvePersist?: (value: boolean) => void;
  }
}
const layoutCode = transpileModule(
  readFileSync(new URL("../src/studio/dialog-layout.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
const layoutURL = `data:text/javascript;base64,${Buffer.from(layoutCode).toString("base64")}`;
const compiled = transpileModule(
  readFileSync(new URL("../src/studio/storage-health.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText.replace('"./dialog-layout"', JSON.stringify(layoutURL));
const moduleURL = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
let browser: Browser;
let context: BrowserContext;
let page: Page;
const estimate = () => page.locator('[data-storage-health="estimate"]');
const persistence = () => page.locator('[data-storage-health="persistence"]');
const request = () => page.getByRole("button", { name: "Request persistent storage" });
const open = () => page.getByRole("button", { name: "Storage health", exact: true }).click();
const refresh = () => page.getByRole("button", { name: "Refresh storage information" }).click();
const readDone = () =>
  page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "Refresh storage information",
      )?.disabled,
  );
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32709/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><head><title>Storage health test</title></head><body><h1>Test workspace</h1><button id='opener'>Storage health</button></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32709/");
  await page.addScriptTag({
    type: "module",
    content: `
    import { mountStorageHealth } from ${JSON.stringify(moduleURL)};
    window.healthCalls = { estimate: 0, persisted: 0, persist: 0, gesture: false, actions: [] };
    window.healthMock = {
      estimate: async () => { window.healthCalls.estimate++; return { usage: 2000000, quota: 1000000000 }; },
      persisted: async () => { window.healthCalls.persisted++; return false; },
      persist: async () => { window.healthCalls.persist++; window.healthCalls.gesture = navigator.userActivation.isActive; return true; }
    };
    Object.defineProperty(navigator, 'storage', { configurable: true, get: () => window.healthMock });
    const action = name => () => { if (document.querySelector('dialog').open) throw new Error('Callback ran before dismissal'); window.healthCalls.actions.push(name); };
    window.healthUI = mountStorageHealth(document.body, { download: action('download'), backup: action('backup'), recover: action('recover') });
    document.getElementById('opener').onclick = () => window.healthUI.open();
  `,
  });
  await page.waitForFunction(() => Boolean(window.healthUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());

describe("Studio storage health", () => {
  it("reads only on demand, identifies website-wide estimates, and requests persistence only by a gesture", async () => {
    expect(await page.evaluate(() => window.healthCalls)).toMatchObject({
      estimate: 0,
      persisted: 0,
      persist: 0,
    });
    await open();
    await readDone();
    expect(await estimate().textContent()).toContain("2 MB used; 1 GB quota");
    expect(await page.getByRole("dialog").textContent()).toContain(
      "including other workspaces and offline app files",
    );
    expect(await page.evaluate(() => window.healthCalls.persist)).toBe(0);
    await request().click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-storage-health="persistence"]')
        ?.textContent?.includes("was granted"),
    );
    expect(await page.evaluate(() => window.healthCalls)).toMatchObject({
      persist: 1,
      gesture: true,
    });
    expect(
      await page.getByRole("button", { name: "Persistent storage granted" }).isDisabled(),
    ).toBe(true);
    expect(await persistence().textContent()).toContain("persistence is not a backup");
  });

  it("distinguishes denied, unsupported and unknown results without promising data safety", async () => {
    await page.evaluate(() => {
      window.healthMock.persist = async () => false;
    });
    await open();
    await readDone();
    await request().click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-storage-health="persistence"]')
        ?.textContent?.includes("did not grant"),
    );
    expect(await request().isEnabled()).toBe(true);
    await page.evaluate(() => {
      window.healthMock.estimate = async () => ({
        usage: Number.NaN,
        quota: Number.POSITIVE_INFINITY,
      });
      window.healthMock.persisted = async () => {
        throw new Error("Storage blocked");
      };
    });
    await refresh();
    await readDone();
    expect(await estimate().textContent()).toContain("did not provide a usable storage estimate");
    expect(await persistence().textContent()).toContain("unavailable");
    await page.evaluate(() => {
      window.healthMock.estimate = async () => ({ usage: 0, quota: 0 });
    });
    await refresh();
    await readDone();
    expect(await estimate().textContent()).toContain("0 bytes used; 0 bytes quota");
    expect(await estimate().textContent()).toContain("reports no storage quota");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
    });
    await refresh();
    await readDone();
    expect(await estimate().textContent()).toContain("does not provide");
    expect(await persistence().textContent()).toContain("does not provide");
    expect(await request().isDisabled()).toBe(true);
  });

  it("reports high usage and existing persistence without asking again", async () => {
    await page.evaluate(() => {
      window.healthMock.estimate = async () => ({ usage: 900000000, quota: 1000000000 });
      window.healthMock.persisted = async () => true;
    });
    await open();
    await readDone();
    expect(await estimate().textContent()).toContain("close to the quota");
    expect(await persistence().textContent()).toContain(
      "reduces automatic eviction; it is not a backup",
    );
    expect(
      await page.getByRole("button", { name: "Persistent storage granted" }).isDisabled(),
    ).toBe(true);
    expect(await page.evaluate(() => window.healthCalls.persist)).toBe(0);
  });

  it("bounds hanging reads and ignores an older reply after closing and reopening", async () => {
    await page.clock.install();
    await page.evaluate(() => {
      window.healthMock.estimate = () =>
        new Promise((resolve) => {
          window.healthResolveEstimate = resolve;
        });
    });
    await open();
    await page.clock.fastForward(5001);
    await readDone();
    expect(await estimate().textContent()).toContain("took too long");
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#opener").evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await page.evaluate(() => {
      window.healthMock.estimate = async () => ({ usage: 3000000, quota: 1000000000 });
    });
    await open();
    await readDone();
    await page.evaluate(async () => {
      window.healthResolveEstimate?.({ usage: 800000000, quota: 1000000000 });
      await Promise.resolve();
    });
    expect(await estimate().textContent()).toContain("3 MB used");
    expect(await estimate().textContent()).not.toContain("800 MB");
  });

  it("bounds pending permission requests without duplicating or reviving a closed dialog", async () => {
    await page.clock.install();
    await page.evaluate(() => {
      window.healthMock.persist = () => {
        window.healthCalls.persist++;
        return new Promise((resolve) => {
          window.healthResolvePersist = resolve;
        });
      };
    });
    await open();
    await readDone();
    await request().click();
    await page.clock.fastForward(5001);
    expect(await persistence().textContent()).toContain("has not answered yet");
    expect(await request().isDisabled()).toBe(true);
    await refresh();
    await readDone();
    expect(await persistence().textContent()).toContain("request is still pending");
    expect(await page.evaluate(() => window.healthCalls.persist)).toBe(1);
    await page.keyboard.press("Escape");
    await page.evaluate(async () => {
      window.healthResolvePersist?.(true);
      await Promise.resolve();
    });
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.evaluate(() => {
      window.healthMock.persisted = async () => true;
    });
    await open();
    await readDone();
    expect(await persistence().textContent()).toContain("is granted");
  });

  it("recovers from a synchronous persistence error and hands off backup actions after dismissal", async () => {
    await page.evaluate(() => {
      window.healthMock.persist = () => {
        throw new Error("Blocked");
      };
    });
    await open();
    await readDone();
    await request().click();
    expect(await persistence().textContent()).toContain("could not be completed");
    expect(await request().isEnabled()).toBe(true);
    for (const label of ["Download Fountain", "Portable backup…", "Open recovery…"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      expect(await page.getByRole("dialog").count()).toBe(0);
      await open();
      await readDone();
    }
    expect(await page.evaluate(() => window.healthCalls.actions)).toEqual([
      "download",
      "backup",
      "recover",
    ]);
    await page.evaluate(() => window.healthUI.dispose());
    expect(await page.locator("dialog").count()).toBe(0);
  });

  it.each(["reopen", "refresh", "timeout"] as const)(
    "refreshes settled native permission status after %s without asking again",
    async (mode) => {
      await page.clock.install();
      await page.evaluate(() => {
        window.healthMock.persist = () => {
          window.healthCalls.persist++;
          return new Promise((resolve) => {
            window.healthResolvePersist = resolve;
          });
        };
      });
      await open();
      await readDone();
      await request().click();
      if (mode === "reopen") {
        await page.keyboard.press("Escape");
        await open();
        await readDone();
      } else if (mode === "refresh") {
        await refresh();
        await readDone();
      } else {
        await page.clock.fastForward(5001);
      }
      expect(await request().isDisabled()).toBe(true);
      await page.evaluate(async () => {
        window.healthMock.persisted = async () => true;
        window.healthResolvePersist?.(true);
        await Promise.resolve();
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-storage-health="persistence"]')
          ?.textContent?.includes("is granted"),
      );
      expect(await persistence().textContent()).not.toContain("still pending");
      expect(
        await page.getByRole("button", { name: "Persistent storage granted" }).isDisabled(),
      ).toBe(true);
      expect(await page.evaluate(() => window.healthCalls.persist)).toBe(1);
    },
  );
});
