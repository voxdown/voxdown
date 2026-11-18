import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RecentDraftContext, mountRecentDrafts } from "../src/studio/recent-drafts";
import type { StudioDraft, StudioDraftMetadata } from "../src/studio/storage";
declare global {
  interface Window {
    recentUI: ReturnType<typeof mountRecentDrafts>;
    recentContext: RecentDraftContext;
    recentRows: StudioDraftMetadata[];
    recentOpened: StudioDraft[];
    recentFetches: string[];
    recentHold: boolean;
    recentRelease?: () => void;
    recentMissing: boolean;
    recentFail: boolean;
  }
}
function compile(name: string): string {
  const source = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
  )
    .outputText.replace(/import "\.\/[^"\n]+\.css";/g, "")
    .replace(/"\.\/([a-z-]+)"/g, (_, dependency: string) => JSON.stringify(compile(dependency)));
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const moduleURL = compile("recent-drafts");
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32736/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><button id='opener'>Recent</button></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32736/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountRecentDrafts} from ${JSON.stringify(moduleURL)};
window.recentContext={id:'active',revision:1};window.recentOpened=[];window.recentFetches=[];window.recentHold=false;window.recentMissing=false;window.recentFail=false;
window.recentRows=Array.from({length:45},(_,i)=>({id:'draft'+i,name:'Draft '+i+'.fountain',characters:100,updated:100-i}));
window.recentUI=mountRecentDrafts(document.body,{current:()=>({...window.recentContext}),open:async(draft,expected,current)=>{if(!current())return false;window.recentOpened.push(draft);return true;}},{listDrafts:async({limit,before})=>{if(window.recentFail)throw new Error('Recovery unavailable');const start=before?Number(before.id.slice(5))+1:0;return{items:window.recentRows.slice(start,start+limit),next:start+limit<window.recentRows.length?{id:'draft'+(start+limit-1),updated:100-(start+limit-1)}:undefined}},getDraft:async(id)=>{window.recentFetches.push(id);if(window.recentHold)await new Promise(resolve=>window.recentRelease=resolve);return window.recentMissing?undefined:{id,name:id+'.fountain',source:'INT. ROOM - DAY\\n\\n[[private]]',updated:1}}});document.querySelector('#opener').onclick=()=>window.recentUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.recentUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#opener").click();
describe("Recent drafts", () => {
  it("lists bounded metadata pages and only fetches selected source", async () => {
    await open();
    expect(await page.locator(".studio-recent-list li").count()).toBe(20);
    expect(await page.evaluate(() => window.recentFetches)).toEqual([]);
    await page.getByRole("button", { name: "Older drafts" }).click();
    expect(await page.locator(".studio-recent-list button").first().textContent()).toContain(
      "Draft 20.fountain",
    );
    await page.getByRole("button", { name: "Newer drafts" }).click();
    await page.locator(".studio-recent-list button").first().click();
    expect(await page.evaluate(() => window.recentFetches)).toEqual(["draft0"]);
    expect(await page.evaluate(() => window.recentOpened[0]?.source)).toBe(
      "INT. ROOM - DAY\n\n[[private]]",
    );
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });
  it("refuses stale async selection after the current screenplay changes", async () => {
    await open();
    await page.evaluate(() => {
      window.recentHold = true;
    });
    await page.locator(".studio-recent-list button").first().click();
    await page.evaluate(() => {
      window.recentContext.revision++;
      window.recentRelease?.();
    });
    await page.waitForFunction(() =>
      document.querySelector('[role="status"]')?.textContent?.includes("screenplay changed"),
    );
    expect(await page.evaluate(() => window.recentOpened)).toEqual([]);
  });
  it("cancels an in-flight selection when the dialog closes and reopens", async () => {
    await open();
    await page.evaluate(() => {
      window.recentHold = true;
    });
    await page.locator(".studio-recent-list button").first().click();
    await page.keyboard.press("Escape");
    await open();
    await page.evaluate(() => window.recentRelease?.());
    expect(await page.evaluate(() => window.recentOpened)).toEqual([]);
    expect(await page.locator("dialog").isVisible()).toBe(true);
  });
  it("keeps current work when a draft disappears, and permits retry after failed listing", async () => {
    await page.evaluate(() => {
      window.recentFail = true;
    });
    await open();
    expect(await page.getByRole("status").textContent()).toContain("Recovery unavailable");
    await page.evaluate(() => {
      window.recentFail = false;
      window.recentMissing = true;
    });
    await page.getByRole("button", { name: "Retry loading drafts" }).click();
    await page.locator(".studio-recent-list button").first().click();
    expect(await page.getByRole("status").textContent()).toContain("no longer available");
    expect(await page.evaluate(() => window.recentOpened)).toEqual([]);
  });
  it("renders draft names as text and marks the current draft without reopening it", async () => {
    await page.evaluate(() => {
      window.recentRows = [
        { id: "active", name: "<img src=x onerror=alert(1)>", characters: 1, updated: 1 },
      ];
    });
    await open();
    expect(await page.locator(".studio-recent-list img").count()).toBe(0);
    expect(await page.locator(".studio-recent-list button").isDisabled()).toBe(true);
    expect(await page.locator(".studio-recent-list").textContent()).toContain("Current draft");
  });
});
