import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountNumberingDialog } from "../src/studio/numbering-dialog";
import type { SceneNumberingPlan } from "../src/studio/scene-numbering";

declare global {
  interface Window {
    numberScenesUI: ReturnType<typeof mountNumberingDialog>;
    numberScenesCurrent: { source: string; id: string };
    numberScenesApplied: SceneNumberingPlan[];
    numberScenesJumps: number[];
    numberScenesAccept: boolean;
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
const moduleURL = compile("numbering-dialog");
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
      body: "<!doctype html><html lang='en'><body><button id='opener'>Number scenes</button></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32706/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountNumberingDialog} from ${JSON.stringify(moduleURL)};
window.numberScenesCurrent={id:'draft1',source:'INT. HOUSE - DAY\\n\\n!HOUSE stays in action.\\n\\nEXT. PARK - NIGHT\\n\\n!Park.'};window.numberScenesApplied=[];window.numberScenesJumps=[];window.numberScenesAccept=true;
window.numberScenesUI=mountNumberingDialog(document.body,{current:()=>window.numberScenesCurrent,apply:(snapshot,plan)=>{if(!window.numberScenesAccept)return false;window.numberScenesApplied.push(plan);window.numberScenesCurrent.source=plan.candidate;return true;}});document.querySelector('#opener').onclick=()=>window.numberScenesUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.numberScenesUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#opener").click();
const preview = () => page.getByRole("button", { name: "Preview scene numbering" }).click();

describe("explicit scene numbering dialog", () => {
  it("defaults after existing labels and only applies after source preview", async () => {
    await page.evaluate(() => {
      window.numberScenesCurrent.source = "INT. A #5#\n\n!Action.\n\nEXT. B\n\n!Action.";
    });
    await open();
    expect(await page.getByLabel("Starting number", { exact: true }).inputValue()).toBe("6");
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
    await preview();
    expect(await page.locator(".scene-numbering-preview").textContent()).toContain("EXT. B #6#");
    await page.getByRole("button", { name: "Apply scene numbering", exact: true }).click();
    const plans = await page.evaluate(() => window.numberScenesApplied);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.changes).toHaveLength(1);
    expect(plans[0]?.candidate).toContain("INT. A #5#");
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });
  it("requires explicit renumber acknowledgment and invalidates changed modes/numbers", async () => {
    await page.evaluate(() => {
      window.numberScenesCurrent.source = "INT. A #10#\n\n!Action.\n\nEXT. B #20#";
    });
    await open();
    await page.getByLabel("Numbering mode", { exact: true }).selectOption("renumber");
    expect(await page.getByLabel("Starting number", { exact: true }).inputValue()).toBe("1");
    await preview();
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
    await page
      .getByLabel("I understand that existing labels on eligible headings will be replaced", {
        exact: true,
      })
      .check();
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(false);
    await page.getByLabel("Starting number", { exact: true }).fill("8");
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
    await preview();
    await page.getByLabel("Numbering mode", { exact: true }).selectOption("unnumbered");
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await page.getByLabel("Starting number", { exact: true }).inputValue()).toBe("21");
  });
  it("refuses stale source/draft snapshots without trusting an optimistic apply callback", async () => {
    await open();
    await preview();
    await page.evaluate(() => {
      window.numberScenesCurrent.source += "\n!New words.";
    });
    await page.getByRole("button", { name: "Apply scene numbering", exact: true }).click();
    expect(await page.evaluate(() => window.numberScenesApplied)).toEqual([]);
    expect(await page.locator("dialog").textContent()).toContain("screenplay changed");
    await page.keyboard.press("Escape");
    await open();
    await page.evaluate(() => {
      window.numberScenesCurrent.id = "other";
    });
    await preview();
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
  });
  it("reports skipped private headings without revealing private text and caps previews", async () => {
    await page.evaluate(() => {
      window.numberScenesCurrent.source = `INT. PRIVATE [[SECRET]]\n\n!Action.\n\n${Array.from({ length: 120 }, (_, i) => `.ROOM ${i}\n\n!Action.`).join("\n\n")}`;
    });
    await open();
    await preview();
    expect(await page.locator(".scene-numbering-preview section").count()).toBe(50);
    expect(await page.locator("dialog").textContent()).toContain("120 headings will change");
    expect(await page.locator("dialog").textContent()).toContain("1 headings skipped");
    expect(await page.locator("dialog").textContent()).not.toContain("SECRET");
  });
  it("blocks nested private headings before any preview can expose them", async () => {
    await page.evaluate(() => {
      window.numberScenesCurrent.source =
        "/* outer\n/* inner */\nINT. SECRET ROOM\n*/\n\nINT. PUBLIC ROOM";
    });
    await open();
    expect(
      await page.getByRole("button", { name: "Preview scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await page.locator("dialog").textContent()).toContain("Nested private");
    expect(await page.locator("dialog").textContent()).not.toContain("SECRET ROOM");
    expect(await page.locator(".scene-numbering-preview").textContent()).toBe("");
  });
  it("keeps invalid starts and failed apply harmless and clears preview/ack on reopen", async () => {
    await open();
    await page.getByLabel("Starting number", { exact: true }).fill("0");
    await preview();
    expect(
      await page.getByRole("button", { name: "Apply scene numbering", exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByLabel("Numbering mode", { exact: true }).selectOption("renumber");
    await preview();
    await page
      .getByLabel("I understand that existing labels on eligible headings will be replaced", {
        exact: true,
      })
      .check();
    await page.evaluate(() => {
      window.numberScenesAccept = false;
    });
    await page.getByRole("button", { name: "Apply scene numbering", exact: true }).click();
    expect(await page.evaluate(() => window.numberScenesApplied)).toEqual([]);
    await page.keyboard.press("Escape");
    await open();
    expect(await page.getByLabel("Numbering mode", { exact: true }).inputValue()).toBe(
      "unnumbered",
    );
    expect(await page.locator(".scene-numbering-preview").textContent()).toBe("");
    expect(await page.locator("dialog").textContent()).toContain(
      "Default: after the highest existing integer label",
    );
  });
});
