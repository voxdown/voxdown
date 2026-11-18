import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountLearning } from "../src/studio/learning-dialog";
declare global {
  interface Window {
    learningUI: ReturnType<typeof mountLearning>;
    learningReturns: number;
    learningExamples: number;
  }
}
const modules = new Map<string, string>();
function compile(name: string): string {
  const cached = modules.get(name);
  if (cached) return cached;
  const code = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
  ).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dep: string) => JSON.stringify(compile(dep)));
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  modules.set(name, result);
  return result;
}
const moduleURL = compile("learning-dialog");
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32722/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><button id='open'>Practice</button><textarea id='real-draft'>My actual screenplay</textarea></body></html>",
    }),
  );
  await page.goto("http://localhost:32722/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountLearning} from ${JSON.stringify(moduleURL)};localStorage.setItem('real-draft','Untouched stored draft');window.learningReturns=0;window.learningExamples=0;window.learningUI=mountLearning(document.body,{returnToWriting:()=>window.learningReturns++,openExample:()=>window.learningExamples++});document.querySelector('#open').onclick=()=>window.learningUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.learningUI));
});
afterEach(async () => {
  await context.close();
});
afterAll(async () => {
  await browser.close();
});
const open = () => page.locator("#open").click();
const input = () => page.getByRole("textbox", { name: "Practice text", exact: true });
const example = () =>
  page.getByRole("button", { name: "Replace practice with example", exact: true }).click();
const next = () => page.getByRole("button", { name: "Next lesson", exact: true }).click();
async function reachDual() {
  for (let i = 0; i < 5; i++) {
    await example();
    await next();
  }
}
describe("guided practice scratchpad", () => {
  it("opens with session-only disclosure and live feedback without advancing or changing real work", async () => {
    await open();
    expect(await input().evaluate((e) => e === document.activeElement)).toBe(true);
    expect(await page.getByRole("dialog").textContent()).toContain("Closing clears the practice");
    expect(await page.getByRole("button", { name: "Next lesson", exact: true }).isDisabled()).toBe(
      true,
    );
    await input().fill("EXT. MARKET - MORNING");
    expect(await page.locator(".learning-feedback").getAttribute("data-state")).toBe("complete");
    expect(await page.getByRole("dialog").textContent()).toContain("Lesson 1 of 6");
    expect(await input().inputValue()).toBe("EXT. MARKET - MORNING");
    expect(await page.locator("#real-draft").inputValue()).toBe("My actual screenplay");
    expect(await page.evaluate(() => localStorage.getItem("real-draft"))).toBe(
      "Untouched stored draft",
    );
    expect(await page.evaluate(() => [window.learningReturns, window.learningExamples])).toEqual([
      0, 0,
    ]);
  });
  it("preserves each lesson scratchpad on back/next and resets only the selected lesson", async () => {
    await open();
    await input().fill("INT. TRAIN - DAY");
    await next();
    await input().fill("INT. TRAIN - DAY\n\nA cup tips over.");
    await page.getByRole("button", { name: "Previous lesson", exact: true }).click();
    expect(await input().inputValue()).toBe("INT. TRAIN - DAY");
    await next();
    expect(await input().inputValue()).toContain("A cup tips over.");
    await page.getByRole("button", { name: "Reset this lesson", exact: true }).click();
    expect(await input().inputValue()).toBe("INT. LIGHTHOUSE - NIGHT\n\n");
    expect(await page.getByRole("button", { name: "Next lesson", exact: true }).isDisabled()).toBe(
      true,
    );
  });
  it("shows typed hostile markup as text without creating nodes", async () => {
    await open();
    await example();
    await next();
    await input().fill("INT. ROOM\n\n!<img src=x onerror=alert(1)>");
    expect(await page.locator("dialog img").count()).toBe(0);
    expect(await page.locator(".learning-preview").textContent()).toContain("<img src=x");
  });
  it("omits private notes from preview and withholds unfinished private text", async () => {
    await open();
    for (let i = 0; i < 4; i++) {
      await example();
      await next();
    }
    await input().fill("!A lamp. [[SECRET_NOTE]]");
    expect(await page.locator(".learning-preview").textContent()).not.toContain("SECRET_NOTE");
    expect(await page.locator(".learning-feedback").textContent()).toContain("sharing that source");
    await input().fill("!A lamp. [[SECRET_NOTE");
    expect(await page.locator(".learning-preview").textContent()).toBe("");
    expect(await page.getByRole("button", { name: "Next lesson", exact: true }).isDisabled()).toBe(
      true,
    );
  });
  it("finishes only on explicit action, offers optional dual skip and returns without copying practice", async () => {
    await open();
    await reachDual();
    expect(
      await page.getByRole("button", { name: "Finish practice", exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByRole("button", { name: "Finish without dual dialogue", exact: true }).click();
    expect(await page.getByRole("dialog").textContent()).toContain("Dual dialogue can wait");
    expect(await page.evaluate(() => window.learningReturns)).toBe(0);
    await page.getByRole("button", { name: "Return to writing", exact: true }).click();
    expect(await page.evaluate(() => window.learningReturns)).toBe(1);
    expect(await page.locator("#real-draft").inputValue()).toBe("My actual screenplay");
    expect(await page.getByRole("dialog").count()).toBe(0);
  });
  it("requires explicit sample action after full completion", async () => {
    await open();
    await reachDual();
    await example();
    expect(await page.getByRole("dialog").textContent()).toContain("Lesson 6 of 6");
    await page.getByRole("button", { name: "Finish practice", exact: true }).click();
    expect(await page.evaluate(() => window.learningExamples)).toBe(0);
    await page.getByRole("button", { name: "Open a sample screenplay", exact: true }).click();
    expect(await page.evaluate(() => window.learningExamples)).toBe(1);
  });
  it("waits for IME composition to finish and keeps the caret in the text field", async () => {
    await open();
    await input().evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart"));
      (el as HTMLTextAreaElement).value = "INT. CAFÉ - DAY";
      el.dispatchEvent(new InputEvent("input", { isComposing: true }));
    });
    expect(await page.getByRole("button", { name: "Next lesson", exact: true }).isDisabled()).toBe(
      true,
    );
    await input().evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionend")));
    expect(await page.getByRole("button", { name: "Next lesson", exact: true }).isEnabled()).toBe(
      true,
    );
    expect(await input().evaluate((el) => el === document.activeElement)).toBe(true);
  });
  it("Escape clears practice, restores focus and close events cannot erase a new session", async () => {
    await open();
    await input().fill("INT. OLD - DAY");
    await page.keyboard.press("Escape");
    expect(await page.locator("#learning-input").inputValue()).toBe("");
    expect(await page.locator("#open").evaluate((el) => el === document.activeElement)).toBe(true);
    await open();
    expect(await input().inputValue()).toBe("");
    await page.evaluate(() => {
      window.learningUI.close();
      window.learningUI.open();
      const input = document.querySelector("#learning-input") as HTMLTextAreaElement;
      input.value = "INT. NEW - NIGHT";
      input.dispatchEvent(new Event("input"));
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await input().inputValue()).toBe("INT. NEW - NIGHT");
    expect(await page.getByRole("button", { name: "Next lesson", exact: true }).isEnabled()).toBe(
      true,
    );
  });
});
