import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountFdxImport } from "../src/studio/fdx-import-dialog";

declare global {
  interface Window {
    fdxImportUI: ReturnType<typeof mountFdxImport>;
    fdxImportOpened: { source: string; name: string }[];
    fdxImportAccept: boolean;
    fdxImportWait?: Promise<void>;
    fdxImportResolve?: () => void;
  }
}
const modules = new Map<string, string>();
function compile(name: string): string {
  const cached = modules.get(name);
  if (cached) return cached;
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
const moduleURL = compile("fdx-import-dialog");
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32706/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body><button id='opener'>Import FDX</button></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32706/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountFdxImport} from ${JSON.stringify(moduleURL)};
window.fdxImportOpened=[];window.fdxImportAccept=true;
window.fdxImportUI=mountFdxImport(document.body,{openScreenplay:async(value,isCurrent)=>{if(window.fdxImportWait)await window.fdxImportWait;if(!isCurrent() || !window.fdxImportAccept)return false;window.fdxImportOpened.push(value);return true;}});document.querySelector('#opener').onclick=()=>window.fdxImportUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.fdxImportUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#opener").click();
const xml = (text: string) =>
  `<FinalDraft DocumentType="Script"><Content><Paragraph Type="Action"><Text>${text}</Text></Paragraph></Content></FinalDraft>`;
const choose = (text = "Hello", name = "Film.fdx") =>
  page
    .getByLabel("FDX file", { exact: true })
    .setInputFiles({ name, mimeType: "application/xml", buffer: Buffer.from(xml(text)) });
const importButton = () =>
  page.getByRole("button", { name: "Open as new screenplay", exact: true });
describe("local FDX import dialog", () => {
  it("previews compatibility and source before explicit opening a new document", async () => {
    await open();
    await choose("Hello &amp; world", "Film.fdx");
    expect(await page.evaluate(() => window.fdxImportOpened)).toEqual([]);
    expect(
      await page.getByRole("list", { name: "FDX import compatibility report" }).textContent(),
    ).toContain("1 screenplay paragraphs");
    await page
      .getByText("Preview converted Fountain (first 5,000 characters)", { exact: true })
      .click();
    expect(await page.locator(".fdx-import-preview").textContent()).toBe("!Hello & world");
    await importButton().click();
    expect(await page.evaluate(() => window.fdxImportOpened)).toEqual([
      { source: "!Hello & world", name: "Film.fountain" },
    ]);
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });
  it("keeps rejected replacements retryable and invalidates old converted results on new selection", async () => {
    await open();
    await choose("First");
    await page.evaluate(() => {
      window.fdxImportAccept = false;
    });
    await importButton().click();
    expect(await page.locator("dialog").textContent()).toContain("Opening was canceled");
    await page.getByLabel("FDX file", { exact: true }).setInputFiles({
      name: "bad.fdx",
      mimeType: "application/xml",
      buffer: Buffer.from("not xml"),
    });
    expect(await importButton().isDisabled()).toBe(true);
    expect(await page.locator(".fdx-import-preview").textContent()).toBe("");
    await choose("Second");
    await page.evaluate(() => {
      window.fdxImportAccept = true;
    });
    await importButton().click();
    expect(await page.evaluate(() => window.fdxImportOpened.map((value) => value.source))).toEqual([
      "!Second",
    ]);
  });
  it("cancels a pending replacement on Escape and cannot open later after reopening", async () => {
    await open();
    await choose("First");
    await page.evaluate(() => {
      window.fdxImportWait = new Promise<void>((resolve) => {
        window.fdxImportResolve = resolve;
      });
    });
    await importButton().click();
    expect(await importButton().isDisabled()).toBe(true);
    expect(await page.getByLabel("FDX file", { exact: true }).isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    await open();
    await page.evaluate(() => {
      window.fdxImportResolve?.();
    });
    expect(await page.evaluate(() => window.fdxImportOpened)).toEqual([]);
    expect(await importButton().isDisabled()).toBe(true);
    await choose("Second");
    await importButton().click();
    expect(await page.evaluate(() => window.fdxImportOpened.map((value) => value.source))).toEqual([
      "!Second",
    ]);
  });
  it("suppresses late file reads after a new selection or close", async () => {
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (this.name === "slow.fdx")
          return new Promise((resolve) => setTimeout(() => original.call(this).then(resolve), 250));
        return original.call(this);
      };
    });
    await open();
    await choose("Old", "slow.fdx");
    await choose("New", "new.fdx");
    await page.waitForTimeout(300);
    await importButton().click();
    expect(await page.evaluate(() => window.fdxImportOpened)).toEqual([
      { source: "!New", name: "new.fountain" },
    ]);
    await open();
    await choose("Late", "slow.fdx");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await open();
    expect(await importButton().isDisabled()).toBe(true);
    expect(await page.locator(".fdx-import-preview").textContent()).toBe("");
  });
  it("renders filenames and screenplay markup as inert text and caps the preview", async () => {
    await open();
    await choose(`&lt;img src=x onerror=alert(1)&gt;${"x".repeat(6000)}`, "<img>.fdx");
    expect(await page.locator("dialog img").count()).toBe(0);
    expect((await page.locator(".fdx-import-preview").textContent())?.length).toBeLessThan(5200);
    await importButton().click();
    const result = await page.evaluate(() => window.fdxImportOpened[0]);
    expect(result?.source.length).toBeGreaterThan(6000);
    expect(result?.name).not.toContain("<");
  });
});
