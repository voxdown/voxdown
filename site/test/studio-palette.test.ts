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

async function navigationFixture() {
  await page.keyboard.press("Escape");
  await page.locator("dialog").evaluateAll((nodes) => {
    for (const node of nodes) node.remove();
  });
  await page.addScriptTag({
    type: "module",
    content: `${compiled}
    window.palette=mountPalette(document.body,[
      {label:'Scene cards',category:'Plan and revise',run(){}},
      {label:'Actor sides PDF',category:'Export and perform',run(){window.calls.push('sides')}},
      {label:'Import Final Draft XML',category:'Files and recovery',keywords:'open',run(){window.calls.push('import')}},
      {label:'Fountain guide',category:'Learn and inspect',run(){}},
      {label:'Preferences',category:'Writing space',run(){}},
      {label:'Next scene',category:'Navigate',run(){}},
      {label:'Export PDF',category:'Export and perform',run(){window.calls.push('pdf')}},
      {label:'Recovery and snapshots',category:'Files and recovery',run(){window.calls.push('recovery')}},
      {label:'Open Fountain file',category:'Files and recovery',run(){window.calls.push('open')}},
      {label:'Custom tool',category:'Extension tools',run(){}}
    ]);
    document.querySelector('#opener').onclick=()=>window.palette.open();`,
  });
  await page.locator("#opener").click();
}

it("uses a stable task order in both category filter and headings", async () => {
  await navigationFixture();
  const groups = [
    "Files and recovery",
    "Writing space",
    "Navigate",
    "Plan and revise",
    "Export and perform",
    "Learn and inspect",
    "Extension tools",
  ];
  expect(await page.locator(".command-list h3").allTextContents()).toEqual(groups);
  expect(await page.getByLabel("Show commands").locator("option").allTextContents()).toEqual([
    "All tools",
    ...groups,
  ]);
});

it("runs an exact command name before incidental category matches", async () => {
  await navigationFixture();
  await page.getByRole("searchbox").fill("  EXPORT   PDF ");
  expect(await page.locator(".command-list button").allTextContents()).toEqual([
    "Export PDF",
    "Actor sides PDF",
  ]);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual([
    "pdf",
  ]);
});

it("prioritizes label matches across groups while keeping each heading together", async () => {
  await navigationFixture();
  await page.getByRole("searchbox").fill("scene");
  expect(await page.locator(".command-list h3").allTextContents()).toEqual([
    "Plan and revise",
    "Navigate",
  ]);
  expect(await page.locator(".command-list button").allTextContents()).toEqual([
    "Scene cards",
    "Next scene",
  ]);
  await page.getByRole("searchbox").fill("open");
  expect(await page.locator(".command-list button").allTextContents()).toEqual([
    "Open Fountain file",
    "Import Final Draft XML",
  ]);
  await page.getByRole("searchbox").fill("recovery");
  expect(await page.locator(".command-list button").first().textContent()).toBe(
    "Recovery and snapshots",
  );
  await page.getByLabel("Show commands").selectOption("Export and perform");
  expect(await page.locator(".command-list button").count()).toBe(0);
});

it("returns from a launched tool to the original opener", async () => {
  await page.keyboard.press("Escape");
  await page.addScriptTag({
    type: "module",
    content: `${compiled}
    const tool=document.createElement('dialog');
    tool.setAttribute('aria-label','Scene tool');
    tool.innerHTML='<button>Close tool</button>';
    document.body.append(tool);
    tool.querySelector('button').onclick=()=>tool.close();
    window.palette=mountPalette(document.body,[{label:'Scene tool',run:()=>tool.showModal()}]);
    document.querySelector('#opener').onclick=()=>window.palette.open();`,
  });
  await page.locator("#opener").click();
  await page.getByRole("searchbox").last().press("Enter");
  expect(await page.getByRole("dialog", { name: "Scene tool" }).isVisible()).toBe(true);
  await page.keyboard.press("Escape");
  expect(await page.locator("#opener").evaluate((node) => node === document.activeElement)).toBe(
    true,
  );
});

it("keeps a disabled exact match visible and skips it when running the first available result", async () => {
  await navigationFixture();
  await page.keyboard.press("Escape");
  await page.addScriptTag({
    type: "module",
    content: `${compiled}
    window.palette=mountPalette(document.body,[
      {label:'Actor sides PDF',category:'Export and perform',run(){window.calls.push('sides')}},
      {label:'Export PDF',category:'Export and perform',enabled:()=>false,run(){window.calls.push('pdf')}}
    ]);
    document.querySelector('#opener').onclick=()=>window.palette.open();`,
  });
  await page.locator("#opener").click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("searchbox").fill("Export PDF");
  expect(await dialog.locator(".command-list button").allTextContents()).toEqual([
    "Export PDF",
    "Actor sides PDF",
  ]);
  expect(await dialog.getByRole("button", { name: "Export PDF", exact: true }).isDisabled()).toBe(
    true,
  );
  expect(await dialog.getByRole("status").textContent()).toContain("1 unavailable");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual([
    "sides",
  ]);
});

it("opens directly in a valid task category and returns focus to its own opener", async () => {
  await navigationFixture();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const file = document.createElement("button");
    file.textContent = "File…";
    file.id = "file-menu";
    file.onclick = () =>
      (window as unknown as { palette: { open(category?: string): void } }).palette.open(
        "Files and recovery",
      );
    document.body.append(file);
  });
  await page.locator("#file-menu").click();
  expect(await page.getByLabel("Show commands").inputValue()).toBe("Files and recovery");
  expect(await page.locator(".command-list h3").allTextContents()).toEqual(["Files and recovery"]);
  expect(
    await page.getByRole("searchbox").evaluate((node) => node === document.activeElement),
  ).toBe(true);
  await page.getByRole("searchbox").fill("open");
  expect(await page.locator(".command-list button").first().textContent()).toBe(
    "Open Fountain file",
  );
  await page.keyboard.press("Escape");
  expect(await page.locator("#file-menu").evaluate((node) => node === document.activeElement)).toBe(
    true,
  );
  await page.locator("#opener").click();
  expect(await page.getByLabel("Show commands").inputValue()).toBe("");
  expect(await page.getByRole("searchbox").inputValue()).toBe("");
});

it("falls back to all tools for an unknown initial category", async () => {
  await navigationFixture();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as unknown as { palette: { open(category?: string): void } }).palette.open(
      "Missing category",
    );
  });
  expect(await page.getByLabel("Show commands").inputValue()).toBe("");
  expect(await page.locator(".command-list button").count()).toBe(10);
});

it("keeps search and close visible above scrollable results at phone width", async () => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addStyleTag({
    content: readFileSync(new URL("../src/studio/studio.css", import.meta.url), "utf8"),
  });
  await page.addStyleTag({
    content: readFileSync(new URL("../src/studio/palette.css", import.meta.url), "utf8"),
  });
  await navigationFixture();
  const dialog = page.getByRole("dialog");
  const list = page.locator(".command-list");
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.getByRole("searchbox").isVisible()).toBe(true);
  const search = await page.getByRole("searchbox").boundingBox();
  const close = await dialog.getByRole("button", { name: "Close", exact: true }).boundingBox();
  expect(search?.y).toBeGreaterThanOrEqual(0);
  expect(close?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("searchbox").fill("Export PDF");
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await dialog.getByRole("status").textContent()).toBe("2 commands.");
  await page.getByRole("searchbox").fill("Custom tool");
  expect(await dialog.getByRole("status").textContent()).toBe("1 command.");
  await page.keyboard.press("Escape");
  expect(
    await page.locator("#opener").evaluate((element) => element === document.activeElement),
  ).toBe(true);
});
