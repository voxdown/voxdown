import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountCompareDialog } from "../src/studio/compare-dialog";

declare global {
  interface Window {
    compareFileUI: ReturnType<typeof mountCompareDialog>;
    comparisonCurrent: { source: string; name: string };
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
const moduleURL = compile("compare-dialog");
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
    content: `import {mountCompareDialog} from ${JSON.stringify(moduleURL)};
window.comparisonCurrent={source:'INT. HOUSE\\n\\n!Mara runs home.\\n[[private current]]',name:'Current.fountain'};
window.compareFileUI=mountCompareDialog(document.body,{current:()=>window.comparisonCurrent});document.querySelector('#opener').onclick=()=>window.compareFileUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.compareFileUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#opener").click();
const choose = (
  source = "INT. HOUSE\n\n!Mara walks home.\n[[private baseline]]",
  name = "Baseline.fountain",
) =>
  page
    .getByLabel("Baseline Fountain or text file", { exact: true })
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
const compare = () => page.getByRole("button", { name: "Compare source", exact: true }).click();
describe("read-only local source comparison", () => {
  it("requires explicit comparison, includes disclosed private source and highlights changed words", async () => {
    await open();
    await choose();
    expect(await page.locator(".file-comparison-columns").isVisible()).toBe(false);
    await compare();
    expect(await page.getByLabel("Baseline source excerpt").textContent()).toContain(
      "[[private baseline]]",
    );
    expect(await page.getByLabel("Current snapshot source excerpt").textContent()).toContain(
      "[[private current]]",
    );
    expect(await page.locator(".comparison-word-removed").allTextContents()).toContain("walks");
    expect(await page.locator(".comparison-word-added").allTextContents()).toContain("runs");
    expect(await page.locator("dialog").textContent()).toContain("private notes, omitted passages");
    expect(
      await page.evaluate(() => ({
        current: window.comparisonCurrent.source,
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({
      current: "INT. HOUSE\n\n!Mara runs home.\n[[private current]]",
      local: 0,
      session: 0,
    });
  });
  it("names empty source excerpts accessibly for an unpaired removal", async () => {
    await page.evaluate(() => {
      window.comparisonCurrent.source = "";
    });
    await open();
    await choose("INT. ROOM\n\n!Changed.\n");
    await compare();
    await page.addScriptTag({
      content: readFileSync(
        new URL("../../node_modules/axe-core/axe.min.js", import.meta.url),
        "utf8",
      ),
    });
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run(root: Element, options: unknown): Promise<{ violations: { id: string }[] }> };
        }
      ).axe;
      const result = await axe.run(document.querySelector("dialog") as Element, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
      return result.violations.map((item) => item.id);
    });
    expect(violations).toEqual([]);
  });
  it("captures current source by value and distinguishes normalized equality from exact spelling", async () => {
    await page.evaluate(() => {
      window.comparisonCurrent = { source: "a\nb\n", name: "Lines.fountain" };
    });
    await open();
    await page.evaluate(() => {
      window.comparisonCurrent.source = "Later edit";
    });
    await choose("a\r\nb\r\n");
    await compare();
    expect(await page.locator("dialog").textContent()).toContain(
      "Only line-ending spelling differs",
    );
    await choose("a\nb\n");
    await compare();
    expect(await page.locator("dialog").textContent()).toContain(
      "Source text is identical, including line-ending spelling",
    );
    await choose("\uFEFFa\nb\n");
    await compare();
    expect(await page.locator("dialog").textContent()).toContain("1 added, 1 removed");
  });
  it("clears obsolete comparison honestly on invalid extension, invalid UTF-8 or oversize selection", async () => {
    await open();
    await choose();
    await compare();
    await choose("words", "wrong.pdf");
    expect(await page.locator(".file-comparison-columns").isVisible()).toBe(false);
    expect(
      await page.getByRole("button", { name: "Compare source", exact: true }).isDisabled(),
    ).toBe(true);
    await page
      .getByLabel("Baseline Fountain or text file", { exact: true })
      .setInputFiles({ name: "broken.txt", mimeType: "text/plain", buffer: Buffer.from([0xff]) });
    expect(await page.locator("dialog").textContent()).toContain("not valid UTF-8");
    await choose("x".repeat(2_000_005));
    expect(await page.locator("dialog").textContent()).toContain("2 MB input limit");
  });
  it("ignores old file reads and never steals focus after asynchronous completion or close", async () => {
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (this.name === "slow.fountain")
          return new Promise((resolve) => setTimeout(() => original.call(this).then(resolve), 250));
        return original.call(this);
      };
    });
    await open();
    await choose("Old", "slow.fountain");
    await choose("New", "new.txt");
    await page.getByRole("button", { name: "Close", exact: true }).focus();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Close");
    await compare();
    expect(await page.getByLabel("Baseline source excerpt").textContent()).toBe("New");
    await choose("Late", "slow.fountain");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await open();
    expect(await page.locator(".file-comparison-columns").isVisible()).toBe(false);
    expect(
      await page.getByRole("button", { name: "Compare source", exact: true }).isDisabled(),
    ).toBe(true);
  });
  it("bounds choice lists/excerpts and navigates filtered changes with real keys", async () => {
    const before = Array.from({ length: 120 }, (_, i) => `old ${i}\nsame ${i}`).join("\n");
    const after = before.replaceAll("old", "new");
    await page.evaluate((source) => {
      window.comparisonCurrent.source = source;
    }, after);
    await open();
    await choose(before);
    await compare();
    expect(await page.getByLabel("Source change", { exact: true }).locator("option").count()).toBe(
      50,
    );
    await page.getByLabel("Baseline source excerpt").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.locator("dialog").textContent()).toContain("change 2 of 120");
    await page.getByLabel("Source change", { exact: true }).selectOption("49");
    await page.getByRole("button", { name: "Next change", exact: true }).click();
    expect(await page.getByLabel("Source change", { exact: true }).inputValue()).toBe("50");
    expect(await page.getByLabel("Source change", { exact: true }).locator("option").count()).toBe(
      50,
    );
    await page.getByLabel("Find source changes", { exact: true }).fill("old 119");
    expect(await page.locator("dialog").textContent()).toContain("change 120 of 120");
    expect(await page.getByLabel("Baseline source excerpt").textContent()).toContain("old 119");
    await page.keyboard.press("ArrowLeft");
    expect(await page.locator("dialog").textContent()).toContain("change 120 of 120");
  });
  it("reports bounded-diff fallback and renders only inert source excerpts", async () => {
    await page.evaluate(() => {
      window.comparisonCurrent.source = Array.from({ length: 2500 }, (_, i) => `current${i}`).join(
        "\n",
      );
    });
    await open();
    await choose(
      Array.from({ length: 2500 }, (_, i) => `baseline${i} <img src=x onerror=alert(1)>`).join(
        "\n",
      ),
    );
    await compare();
    expect(await page.locator("dialog").textContent()).toContain("change-search budget");
    expect(await page.locator("dialog img").count()).toBe(0);
    expect(
      (await page.getByLabel("Baseline source excerpt").textContent())?.length,
    ).toBeLessThanOrEqual(8000);
    expect(await page.locator("dialog").textContent()).toContain("Excerpt truncated");
  });
});
