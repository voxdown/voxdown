import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
let browser: Browser;
let context: BrowserContext;
let page: Page;
const compiled = transpileModule(
  readFileSync(new URL("../src/studio/palette.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.setContent("<button id='opener'>Commands</button>");
  await page.addScriptTag({
    type: "module",
    content: `${compiled}
    window.calls=[]; window.allowed=true;
    window.palette=mountPalette(document.body,[
      {label:'Scene cards',category:'Plan',keywords:'reorder index board',run(){window.calls.push('cards')}},
      {label:'Download Fountain',category:'Files',run(){window.calls.push('download')}},
      {label:'Rename a character',category:'Plan',keywords:'cast cue',run(){window.calls.push('rename')}},
      {label:'Save to file',category:'Files',enabled:()=>window.allowed,run(){window.calls.push('save')}}
    ]);
    document.querySelector('#opener').onclick=()=>window.palette.open();`,
  });
  await page.locator("#opener").click();
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
it("groups related tools and combines category with unordered search keywords", async () => {
  expect(await page.locator(".command-list h3").allTextContents()).toEqual(["Plan", "Files"]);
  await page.getByRole("searchbox").fill("board index");
  expect(await page.locator(".command-list button").allTextContents()).toEqual(["Scene cards"]);
  await page.getByLabel("Show commands").selectOption("Files");
  expect(await page.getByText("No matching commands.", { exact: true }).isVisible()).toBe(true);
  await page.getByRole("searchbox").fill("");
  expect(await page.locator(".command-list button").allTextContents()).toEqual([
    "Download Fountain",
    "Save to file",
  ]);
});
it("keyboard navigation skips disabled tools and returns to search", async () => {
  await page.evaluate(() => {
    (window as unknown as { allowed: boolean }).allowed = false;
  });
  await page.getByLabel("Show commands").selectOption("Files");
  await page.getByRole("searchbox").focus();
  await page.keyboard.press("ArrowDown");
  expect(
    await page
      .getByRole("button", { name: "Download Fountain", exact: true })
      .evaluate((n) => n === document.activeElement),
  ).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  expect(await page.getByRole("searchbox").evaluate((n) => n === document.activeElement)).toBe(
    true,
  );
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual([
    "download",
  ]);
});
it("rechecks availability when running and leaves the palette open if it changed", async () => {
  await page.getByRole("searchbox").fill("Save to file");
  await page.evaluate(() => {
    (window as unknown as { allowed: boolean }).allowed = false;
  });
  await page.keyboard.press("Enter");
  expect(await page.getByRole("dialog").isVisible()).toBe(true);
  expect(await page.getByRole("button", { name: "Save to file" }).isDisabled()).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual([]);
});
it("does not execute during composition and resets filters on next open", async () => {
  await page.getByLabel("Show commands").selectOption("Files");
  await page.getByRole("searchbox").fill("Download");
  await page.getByRole("searchbox").dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.getByRole("dialog").isVisible()).toBe(true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.id === "opener", undefined, {
    timeout: 2000,
  });
  await page.locator("#opener").click();
  expect(await page.getByLabel("Show commands").inputValue()).toBe("");
  expect(await page.getByRole("searchbox").inputValue()).toBe("");
  expect(await page.locator(".command-list button").count()).toBe(4);
});
