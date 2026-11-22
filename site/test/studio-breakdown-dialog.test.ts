import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountBreakdown } from "../src/studio/breakdown-dialog";
declare global {
  interface Window {
    breakdownUI: ReturnType<typeof mountBreakdown>;
    breakdownCurrent: { source: string; name: string };
    breakdownDownloads: { text: string; name: string; type: string }[];
    breakdownDownloadError: boolean;
  }
}
let browser: Browser;
let context: BrowserContext;
let page: Page;
const modules = new Map<string, string>();
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32726/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const match = /^\/modules\/studio\/([a-z-]+)\.js$/.exec(path);
    if (match) {
      let compiled = modules.get(path);
      if (!compiled) {
        const source = readFileSync(
          new URL(`../src/studio/${match[1]}.ts`, import.meta.url),
          "utf8",
        );
        compiled = transpileModule(source, {
          compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
        }).outputText.replace(/(["'])\.\/([a-z-]+)\1/g, '"./$2.js"');
        modules.set(path, compiled);
      }
      await route.fulfill({ contentType: "text/javascript", body: compiled });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><body><button id='open'>Breakdown</button></body></html>",
    });
  });
  await page.goto("http://localhost:32726/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountBreakdown} from '/modules/studio/breakdown-dialog.js';
window.breakdownCurrent={source:'Title: PRIVATE TITLE\\nContact: PRIVATE CONTACT\\n\\nINT. ROOM\\n\\n!A lamp.\\n\\n@MARA\\nHello [[PRIVATE NOTE]].',name:'Original.fountain'};
window.breakdownDownloads=[];window.breakdownDownloadError=false;
window.breakdownUI=mountBreakdown(document.body,{current:()=>window.breakdownCurrent,download:(text,name,type)=>{if(window.breakdownDownloadError)throw Error('blocked');window.breakdownDownloads.push({text,name,type})}});
document.querySelector('#open').onclick=()=>window.breakdownUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.breakdownUI));
});
afterEach(async () => {
  await context.close();
});
afterAll(async () => browser.close());
const open = () => page.locator("#open").click();
const ready = () =>
  page.waitForFunction(() =>
    document.querySelector('.breakdown-dialog [role="status"]')?.textContent?.startsWith("Showing"),
  );
const download = () =>
  page.getByRole("button", { name: "Download filtered CSV", exact: true }).click();
describe("scene/cast breakdown dialog", () => {
  it("captures a public snapshot and downloads only on request", async () => {
    await open();
    await ready();
    expect(await page.evaluate(() => window.breakdownDownloads)).toEqual([]);
    expect(await page.locator(".breakdown-dialog").innerText()).not.toContain("PRIVATE");
    await page.evaluate(() => {
      window.breakdownCurrent = { source: "INT. NEW\n\n!New words", name: "Changed.fountain" };
    });
    await download();
    const exported = await page.evaluate(() => window.breakdownDownloads[0]);
    expect(exported?.name).toBe("Original-breakdown.csv");
    expect(exported?.text).toContain("MARA");
    expect(exported?.text).not.toMatch(/PRIVATE|NEW/);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(await page.locator(".breakdown-rows").textContent()).toBe("");
    await open();
    await ready();
    await download();
    expect((await page.evaluate(() => window.breakdownDownloads[1]))?.text).toContain("INT. NEW");
  });
  it("bounds rows, paginates and exports every filtered row, not only the page", async () => {
    await page.evaluate(() => {
      window.breakdownCurrent.source = Array.from(
        { length: 123 },
        (_, i) => `INT. ROOM ${i + 1}\n\n@${i % 2 ? "JON" : "MARA"}\nHello.`,
      ).join("\n\n");
    });
    await open();
    await ready();
    expect(await page.locator(".breakdown-rows > li").count()).toBe(50);
    await download();
    expect((await page.evaluate(() => window.breakdownDownloads[0]))?.text).toContain(
      "INT. ROOM 123",
    );
    await page.getByRole("button", { name: "Next 50 scenes", exact: true }).click();
    expect(await page.locator(".breakdown-rows > li").first().innerText()).toContain(
      "occurrence 51",
    );
    await page.getByRole("button", { name: "Next 50 scenes", exact: true }).click();
    expect(await page.locator(".breakdown-rows > li").count()).toBe(23);
    await page.getByLabel("Speaking role contains", { exact: true }).fill("mara");
    expect(await page.locator(".breakdown-rows > li").count()).toBe(50);
    expect(await page.getByRole("status").innerText()).toContain("of 62");
    await download();
    expect((await page.evaluate(() => window.breakdownDownloads[1]))?.text).not.toContain("JON");
    await page
      .getByLabel("Scene heading or number contains", { exact: true })
      .fill("does not exist");
    expect(await page.locator(".breakdown-rows > li").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Download filtered CSV" }).isDisabled()).toBe(
      true,
    );
  });
  it("Escape closes a populated search and restores opener focus", async () => {
    await open();
    await ready();
    await page.getByLabel("Speaking role contains", { exact: true }).fill("mara");
    await page.keyboard.press("Escape");
    expect(
      await page
        .locator(".breakdown-dialog")
        .evaluate((element) => (element as HTMLDialogElement).open),
    ).toBe(false);
    expect(
      await page.locator("#open").evaluate((element) => document.activeElement === element),
    ).toBe(true);
  });
  it("withholds output for ambiguous privacy and retries failed downloads", async () => {
    await page.evaluate(() => {
      window.breakdownCurrent.source = "[[unfinished";
    });
    await open();
    expect(await page.getByRole("status").innerText()).toContain("unfinished private");
    expect(await page.getByRole("button", { name: "Download filtered CSV" }).isDisabled()).toBe(
      true,
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => {
      window.breakdownCurrent.source = "INT. ROOM";
      window.breakdownDownloadError = true;
    });
    await open();
    await ready();
    await download();
    expect(await page.getByRole("status").innerText()).toContain("could not start");
    await page.evaluate(() => {
      window.breakdownDownloadError = false;
    });
    await download();
    expect(await page.evaluate(() => window.breakdownDownloads.length)).toBe(1);
  });
  it("rapid close/reopen keeps the new snapshot and bounds long visual content", async () => {
    await open();
    await ready();
    await page.evaluate(() => {
      window.breakdownUI.close();
      window.breakdownCurrent = {
        source: `.${"X".repeat(1000)}\n\n@${"Y".repeat(1000)}\nHello.`,
        name: "Long.fountain",
      };
      window.breakdownUI.open();
    });
    await ready();
    expect((await page.locator(".breakdown-rows").innerText()).length).toBeLessThan(600);
    await download();
    const text = await page.evaluate(() => window.breakdownDownloads[0]?.text);
    expect(text).toContain("X".repeat(1000));
    expect(text).toContain("Y".repeat(1000));
  });
});
