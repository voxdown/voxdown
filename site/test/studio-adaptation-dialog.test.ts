import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountAdaptation } from "../src/studio/adaptation-dialog";
declare global {
  interface Window {
    adaptationUI: ReturnType<typeof mountAdaptation>;
    adaptationCurrent: { source: string; name: string };
    adaptationDownloads: { text: string; name: string; type: string }[];
    adaptationDownloadError: boolean;
  }
}
let browser: Browser;
let context: BrowserContext;
let page: Page;
let delayModule = false;
let crashWorker = false;
const requestedModules: string[] = [];
let releaseModule: (() => void) | undefined;
const modules = new Map<string, string>();
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  delayModule = false;
  crashWorker = false;
  requestedModules.length = 0;
  releaseModule = undefined;
  context = await browser.newContext();
  page = await context.newPage();
  await context.route("http://localhost:32725/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requestedModules.push(path);
    if (crashWorker && path.endsWith("/adaptation-worker.js")) {
      await route.fulfill({
        contentType: "text/javascript",
        body: 'throw new Error("PRIVATE worker details");',
      });
      return;
    }
    if (path === "/modules/voxdown.js") {
      await route.fulfill({
        contentType: "text/javascript",
        body: 'export {parse} from "./core/parse.js";export {lines} from "./core/lines.js";export {SPEC_VERSION} from "./core/version.js";',
      });
      return;
    }
    const match = /^\/modules\/(studio|core)\/([a-z-]+)\.js$/.exec(path);
    if (match) {
      if (delayModule && match[2] === "adaptation")
        await new Promise<void>((resolve) => {
          releaseModule = resolve;
        });
      let compiled = modules.get(path);
      if (!compiled) {
        const source = readFileSync(
          new URL(
            match[1] === "studio"
              ? `../src/studio/${match[2]}.ts`
              : `../../packages/core/src/${match[2]}.ts`,
            import.meta.url,
          ),
          "utf8",
        );
        compiled = transpileModule(source, {
          compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
        })
          .outputText.replace(/(["'])\.\/([a-z-]+)\1/g, '"./$2.js"')
          .replace("./adaptation-worker.ts", "./adaptation-worker.js")
          .replace(/from ["']voxdown["']/g, 'from "/modules/voxdown.js"');
        modules.set(path, compiled);
      }
      await route.fulfill({ contentType: "text/javascript", body: compiled });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><body><button id='open'>Adapt</button></body></html>",
    });
  });
  await page.goto("http://localhost:32725/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountAdaptation} from '/modules/studio/adaptation-dialog.js';
window.adaptationCurrent={source:'Title: PRIVATE TITLE\\nContact: PRIVATE CONTACT\\n\\nINT. ROOM\\n\\n!A lamp.\\n\\n@MARA\\nHello [[PRIVATE NOTE]].',name:'Original.fountain'};
window.adaptationDownloads=[];window.adaptationDownloadError=false;
window.adaptationUI=mountAdaptation(document.body,{current:()=>window.adaptationCurrent,download:(text,name,type)=>{if(window.adaptationDownloadError)throw Error('blocked');window.adaptationDownloads.push({text,name,type})}});
document.querySelector('#open').onclick=()=>window.adaptationUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.adaptationUI));
});
afterEach(async () => {
  releaseModule?.();
  await context.close();
});
afterAll(async () => browser.close());
const open = () => page.locator("#open").click();
const ready = () =>
  page.waitForFunction(() =>
    document
      .querySelector('.adaptation-dialog [role="status"]')
      ?.textContent?.startsWith("Validated"),
  );
const download = () =>
  page.getByRole("button", { name: "Download adapted .vxd", exact: true }).click();

describe("explicit VoxDown adaptation dialog", () => {
  it("prepares a report without downloading and exports only captured public content", async () => {
    await open();
    await ready();
    expect(await page.evaluate(() => window.adaptationDownloads)).toEqual([]);
    expect(
      await page.getByRole("list", { name: "VoxDown adaptation report" }).textContent(),
    ).toContain("not a screenplay backup");
    await page.evaluate(() => {
      window.adaptationCurrent.source = "@OTHER\nNew text.";
      window.adaptationCurrent.name = "New.fountain";
    });
    await download();
    const file = await page.evaluate(() => window.adaptationDownloads[0]);
    expect(file?.name).toBe("Original.vxd");
    expect(file?.type).toBe("text/plain;charset=utf-8");
    expect(file?.text).not.toContain("PRIVATE");
    expect(file?.text).not.toContain("New text");
    expect(
      await page.evaluate(() => ({
        source: window.adaptationCurrent.source,
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ source: "@OTHER\nNew text.", local: 0, session: 0 });
  });
  it("makes headings optional and invalidates previous readiness while recomputing", async () => {
    await open();
    await ready();
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads[0]?.text)).toContain("{hidden}");
    await page.getByLabel("Read scene headings aloud", { exact: false }).check();
    await ready();
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads[1]?.text)).not.toContain(
      "{hidden}",
    );
    expect(
      await page.getByRole("list", { name: "VoxDown adaptation report" }).textContent(),
    ).toContain("are read by the narrator");
  });
  it("requires explicit dual overlap acknowledgment and resets it after option changes", async () => {
    await page.evaluate(() => {
      window.adaptationCurrent.source = "@MARA\nLeft.\n\n@JON ^\nRight.";
    });
    await open();
    await ready();
    const button = page.getByRole("button", { name: "Download adapted .vxd", exact: true });
    expect(await button.isDisabled()).toBe(true);
    await page.evaluate(() =>
      document
        .querySelector<HTMLButtonElement>(".adaptation-dialog button")
        ?.dispatchEvent(new MouseEvent("click")),
    );
    expect(await page.evaluate(() => window.adaptationDownloads)).toEqual([]);
    await page.getByLabel("I accept reading overlapping dialogue", { exact: false }).check();
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads)).toHaveLength(1);
    await page.getByLabel("Read scene headings aloud", { exact: false }).check();
    await ready();
    expect(await button.isDisabled()).toBe(true);
  });
  it("cancels lazy preparation and preserves a new open after queued close events", async () => {
    delayModule = true;
    await open();
    await page.waitForFunction(() =>
      document.querySelector('[role="status"]')?.textContent?.startsWith("Preparing"),
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.adaptationCurrent.source = "@NEW\nCurrent.";
      window.adaptationUI.open();
    });
    delayModule = false;
    await new Promise<void>((resolve) => {
      const poll = () => {
        if (releaseModule) {
          releaseModule();
          resolve();
        } else setTimeout(poll, 5);
      };
      poll();
    });
    await ready();
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads[0]?.text)).toContain("Current");
    expect(await page.evaluate(() => window.adaptationDownloads[0]?.text)).not.toContain("Hello");
  });
  it("clears retained preview on Escape and never downloads from closed stale buttons", async () => {
    await open();
    await ready();
    await page.keyboard.press("Escape");
    expect(await page.locator(".adaptation-preview").inputValue()).toBe("");
    expect(await page.locator("#open").evaluate((node) => node === document.activeElement)).toBe(
      true,
    );
    await page.evaluate(() =>
      document
        .querySelector<HTMLButtonElement>(".adaptation-dialog button")
        ?.dispatchEvent(new MouseEvent("click")),
    );
    expect(await page.evaluate(() => window.adaptationDownloads)).toEqual([]);
  });
  it("blocks invalid private syntax with no preview or downloadable result", async () => {
    await page.evaluate(() => {
      window.adaptationCurrent.source = "@MARA\n[[PRIVATE unclosed";
    });
    await open();
    await page.waitForFunction(() =>
      document.querySelector('[role="status"]')?.textContent?.startsWith("Close unfinished"),
    );
    expect(
      await page.getByRole("button", { name: "Download adapted .vxd", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await page.locator(".adaptation-preview").inputValue()).toBe("");
    expect(await page.getByRole("dialog").textContent()).not.toContain("PRIVATE unclosed");
  });
  it("bounds preview/cast DOM and renders hostile filenames as inert text", async () => {
    await page.evaluate(() => {
      window.adaptationCurrent.name = "<img src=x onerror=alert(1)>.fountain";
      window.adaptationCurrent.source = Array.from(
        { length: 60 },
        (_, i) => `@ROLE ${i}\n${"Words ".repeat(80)}.`,
      ).join("\n\n");
    });
    await open();
    await ready();
    expect(await page.locator(".adaptation-cast li").count()).toBe(30);
    expect((await page.locator(".adaptation-preview").inputValue()).length).toBe(8000);
    expect(await page.locator("dialog img").count()).toBe(0);
    expect(await page.getByRole("dialog").textContent()).toContain("complete validated adaptation");
  });
  it("loads core only in an on-demand worker and reports unavailable workers without fallback", async () => {
    expect(
      requestedModules.some(
        (path) =>
          path.includes("/core/") ||
          path.endsWith("/adaptation.js") ||
          path.endsWith("/adaptation-worker.js"),
      ),
    ).toBe(false);
    await page.evaluate(() => {
      Reflect.set(window, "OriginalAdaptationWorker", window.Worker);
      window.Worker = class {
        constructor() {
          throw Error("disabled");
        }
      } as unknown as typeof Worker;
    });
    await open();
    await page.getByRole("button", { name: "Retry preparation", exact: true }).waitFor();
    expect(await page.getByRole("status").textContent()).toContain("workers are available");
    expect(
      requestedModules.some((path) => path.includes("/core/") || path.endsWith("/adaptation.js")),
    ).toBe(false);
    expect(
      await page.getByRole("button", { name: "Download adapted .vxd", exact: true }).isDisabled(),
    ).toBe(true);
    await page.evaluate(() => {
      window.Worker = Reflect.get(window, "OriginalAdaptationWorker");
    });
    await page.getByRole("button", { name: "Retry preparation", exact: true }).click();
    await ready();
    expect(requestedModules.some((path) => path.endsWith("/adaptation-worker.js"))).toBe(true);
    expect(requestedModules.some((path) => path.includes("/core/"))).toBe(true);
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads.length)).toBe(1);
  });
  it("handles actual worker startup crashes and explicit retry without private error leakage", async () => {
    crashWorker = true;
    await open();
    await page.getByRole("button", { name: "Retry preparation", exact: true }).waitFor();
    expect(await page.getByRole("status").textContent()).toContain("worker stopped");
    expect(await page.getByRole("dialog").textContent()).not.toContain("PRIVATE worker details");
    expect(await page.getByRole("button", { name: "Close", exact: true }).isEnabled()).toBe(true);
    crashWorker = false;
    await page.getByRole("button", { name: "Retry preparation", exact: true }).click();
    await ready();
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads.length)).toBe(1);
  });
  it("replaces a still-loading worker when options change and exposes only the latest result", async () => {
    delayModule = true;
    await open();
    await page.waitForFunction(() =>
      document.querySelector('[role="status"]')?.textContent?.startsWith("Preparing"),
    );
    expect(await page.getByRole("button", { name: "Close", exact: true }).isEnabled()).toBe(true);
    expect(
      await page.getByRole("button", { name: "Download adapted .vxd", exact: true }).isDisabled(),
    ).toBe(true);
    delayModule = false;
    await page.getByLabel("Read scene headings aloud", { exact: false }).check();
    releaseModule?.();
    await ready();
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads[0]?.text)).not.toContain(
      "{hidden}",
    );
    expect(
      await page.getByRole("button", { name: "Retry preparation", exact: true }).isVisible(),
    ).toBe(false);
  });
  it("retains a validated result for retry when download fails", async () => {
    await open();
    await ready();
    await page.evaluate(() => {
      window.adaptationDownloadError = true;
    });
    await download();
    expect(await page.getByRole("status").textContent()).toContain("could not start");
    await page.evaluate(() => {
      window.adaptationDownloadError = false;
    });
    await download();
    expect(await page.evaluate(() => window.adaptationDownloads)).toHaveLength(1);
  });
});
