import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountReference } from "../src/studio/reference";
declare global {
  interface Window {
    referenceUI: ReturnType<typeof mountReference>;
    referenceReads: ((bytes: ArrayBuffer) => void)[];
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
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32708/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><section id='preview'><div class='panel-heading'><h2>On the page</h2><span>Same layout as PDF</span></div><div id='page'>Original preview</div></section></body></html>",
    }),
  );
  await page.goto("http://localhost:32708/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountReference} from ${JSON.stringify(compile("reference"))};window.referenceUI=mountReference(document.querySelector('#preview'),()=>{});window.referenceUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.referenceUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const choose = (name: string, bytes: string | Buffer) =>
  page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: typeof bytes === "string" ? Buffer.from(bytes) : bytes,
  });
describe("session-only literal text reference", () => {
  it("shows private text literally without interpreting HTML or changing the page preview", async () => {
    const source = "<img src=x onerror=alert(1)>\n[[private]]\nCafé 龍";
    await choose("notes.md", source);
    await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Café"));
    expect(
      await page.getByRole("textbox", { name: "Reference text (read only)" }).inputValue(),
    ).toBe(source);
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.locator("#page").textContent()).toBe("Original preview");
    expect(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
    await page.getByRole("tab", { name: "Page preview", exact: true }).click();
    expect(await page.locator("#page").isVisible()).toBe(true);
    await page.keyboard.press("ArrowRight");
    expect(
      await page.getByRole("tab", { name: "Text reference" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(await page.getByRole("textbox").getAttribute("readonly")).not.toBeNull();
  });
  it("keeps the previous reference after invalid UTF-8, binary, unsupported or oversized input", async () => {
    await choose("notes.txt", "Keep me");
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "Keep me");
    for (const [name, value] of [
      ["bad.txt", Buffer.from([0xff])],
      ["binary.txt", Buffer.from("\0")],
      ["image.png", Buffer.from("text")],
      ["huge.txt", Buffer.alloc(2_000_001, 65)],
    ] as const) {
      await choose(name, value);
      await page.waitForFunction(() =>
        document
          .querySelector('[role="status"]')
          ?.textContent?.startsWith("Could not open reference"),
      );
      expect(await page.getByRole("textbox").inputValue()).toBe("Keep me");
    }
  });
  it("ignores a late file read after Clear and keeps reference state empty", async () => {
    await choose("notes.txt", "Original");
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "Original");
    await page.evaluate(() => {
      window.referenceReads = [];
      File.prototype.arrayBuffer = () =>
        new Promise((resolve) => window.referenceReads.push(resolve));
    });
    await choose("pending.txt", "Late");
    await page.waitForFunction(() => window.referenceReads.length === 1);
    await page.getByRole("button", { name: "Clear reference" }).click();
    await page.evaluate(() => window.referenceReads[0]?.(new TextEncoder().encode("Late").buffer));
    expect(await page.getByRole("textbox").inputValue()).toBe("");
    expect(await page.getByRole("button", { name: "Clear reference" }).isDisabled()).toBe(true);
  });
  it("allows Clear to cancel the first pending reference before any file has opened", async () => {
    await page.evaluate(() => {
      window.referenceReads = [];
      File.prototype.arrayBuffer = () =>
        new Promise((resolve) => window.referenceReads.push(resolve));
    });
    await choose("first-pending.txt", "Late private content");
    await page.waitForFunction(() => window.referenceReads.length === 1);
    expect(await page.getByRole("button", { name: "Clear reference" }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "Clear reference" }).click();
    await page.evaluate(() =>
      window.referenceReads[0]?.(new TextEncoder().encode("Late private content").buffer),
    );
    expect(await page.getByRole("textbox").inputValue()).toBe("");
    expect(await page.locator(".reference-name").textContent()).toBe("No reference open");
    expect(await page.getByRole("button", { name: "Clear reference" }).isDisabled()).toBe(true);
  });
  it("keeps the newest selected file when earlier reads complete later", async () => {
    await page.evaluate(() => {
      window.referenceReads = [];
      File.prototype.arrayBuffer = () =>
        new Promise((resolve) => window.referenceReads.push(resolve));
    });
    await choose("first.txt", "First");
    await choose("second.txt", "Second");
    await page.waitForFunction(() => window.referenceReads.length === 2);
    await page.evaluate(() =>
      window.referenceReads[1]?.(new TextEncoder().encode("Second").buffer),
    );
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "Second");
    await page.evaluate(() => window.referenceReads[0]?.(new TextEncoder().encode("First").buffer));
    expect(await page.getByRole("textbox").inputValue()).toBe("Second");
    expect(await page.locator(".reference-name").textContent()).toBe("second.txt");
  });
});
