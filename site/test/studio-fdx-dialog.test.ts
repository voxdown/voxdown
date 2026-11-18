import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountFdxExport } from "../src/studio/fdx-dialog";
declare global {
  interface Window {
    fdxUI: ReturnType<typeof mountFdxExport>;
    fdxCurrent: { source: string; name: string };
    fdxDownloads: { xml: string; name: string; type: string }[];
    fdxThrow: boolean;
  }
}
const modules = new Map<string, string>();
function compile(name: string): string {
  const old = modules.get(name);
  if (old) return old;
  const source = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
  ).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dependency: string) =>
    JSON.stringify(compile(dependency)),
  );
  const result = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  modules.set(name, result);
  return result;
}
const moduleURL = compile("fdx-dialog");
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32721/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><button id='open'>Export</button></body></html>",
    }),
  );
  await page.goto("http://localhost:32721/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountFdxExport} from ${JSON.stringify(moduleURL)};
window.fdxCurrent={source:'Title: Original title\\nContact: author@example.test\\n\\n@MARA\\nOriginal [[PRIVATE]].',name:'Original.fountain'};
window.fdxDownloads=[];window.fdxThrow=false;
window.fdxUI=mountFdxExport(document.body,{current:()=>window.fdxCurrent,download:(xml,name,type)=>{if(window.fdxThrow)throw Error('blocked');window.fdxDownloads.push({xml,name,type});}});
document.querySelector('#open').onclick=()=>window.fdxUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.fdxUI));
});
afterEach(async () => {
  await context.close();
});
afterAll(async () => {
  await browser.close();
});
const open = () => page.locator("#open").click();
const download = () => page.getByRole("button", { name: "Download FDX", exact: true });
describe("FDX compatibility dialog", () => {
  it("shows report before explicit download and exports captured snapshot despite later edits", async () => {
    await open();
    expect(await page.evaluate(() => window.fdxDownloads)).toEqual([]);
    expect(
      await page.getByRole("list", { name: "FDX compatibility report" }).textContent(),
    ).toContain("Pagination");
    expect(await page.getByRole("dialog").textContent()).toContain("author and contact details");
    await page.evaluate(() => {
      window.fdxCurrent.source = "@BOB\nNew draft.";
      window.fdxCurrent.name = "New.fountain";
    });
    await download().click();
    const result = await page.evaluate(() => ({
      file: window.fdxDownloads[0],
      current: window.fdxCurrent.source,
    }));
    expect(result.file?.xml).toContain("Original");
    expect(result.file?.xml).not.toContain("PRIVATE");
    expect(result.file?.xml).not.toContain("New draft");
    expect(result.file?.name).toBe("Original.fdx");
    expect(result.file?.type).toBe("application/xml;charset=utf-8");
    expect(result.current).toBe("@BOB\nNew draft.");
  });
  it("title toggle rebuilds captured export and excludes contact metadata", async () => {
    await open();
    await page.getByRole("checkbox").uncheck();
    await download().click();
    const xml = await page.evaluate(() => window.fdxDownloads[0]?.xml);
    expect(xml).not.toContain("TitlePage");
    expect(xml).not.toContain("author@example.test");
    expect(await page.getByRole("list").textContent()).toContain("excluded by your choice");
  });
  it("Escape clears retained source/report and no delayed download can happen", async () => {
    await open();
    await page.keyboard.press("Escape");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.evaluate(() => window.fdxDownloads)).toEqual([]);
    expect(await page.locator("#open").evaluate((e) => e === document.activeElement)).toBe(true);
    await page.evaluate(() =>
      document.querySelector("dialog button")?.dispatchEvent(new MouseEvent("click")),
    );
    expect(await page.evaluate(() => window.fdxDownloads)).toEqual([]);
    expect(await page.locator("dialog ul li").count()).toBe(0);
  });
  it("preserves reopened state when a close event is queued", async () => {
    await open();
    await page.evaluate(() => {
      window.fdxUI.close();
      window.fdxCurrent.source = "@NEW\nCurrent.";
      window.fdxUI.open();
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await download().click();
    expect(await page.evaluate(() => window.fdxDownloads[0]?.xml)).toContain("Current.");
  });
  it("reports failure without enabling download, and close/reopen retries new source", async () => {
    await page.evaluate(() => {
      window.fdxCurrent.source = "@MARA\n[[PRIVATE unclosed";
    });
    await open();
    expect(await download().isDisabled()).toBe(true);
    expect(await page.getByRole("status").textContent()).toContain("unfinished private");
    expect(await page.getByRole("dialog").textContent()).not.toContain("PRIVATE unclosed");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => {
      window.fdxCurrent.source = "@MARA\nFixed.";
    });
    await open();
    expect(await download().isEnabled()).toBe(true);
  });
  it("renders hostile filenames as text and makes download errors retryable", async () => {
    await page.evaluate(() => {
      window.fdxCurrent.name = "<img src=x onerror=alert(1)>.fountain";
      window.fdxThrow = true;
    });
    await open();
    expect(await page.locator("dialog img").count()).toBe(0);
    await download().click();
    expect(await page.getByRole("status").textContent()).toContain("could not start");
    await page.evaluate(() => {
      window.fdxThrow = false;
    });
    await download().click();
    expect(await page.evaluate(() => window.fdxDownloads.length)).toBe(1);
  });
});
