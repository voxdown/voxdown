import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountSceneBoard } from "../src/studio/scene-board";
import type { SceneEditPlan } from "../src/studio/scene-edits";

declare global {
  interface Window {
    sceneCardsUI: ReturnType<typeof mountSceneBoard>;
    sceneCardsCurrent: { source: string; id: string };
    sceneCardsApplied: SceneEditPlan[];
    sceneCardsJumps: number[];
    sceneCardsAccept: boolean;
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
const moduleURL = compile("scene-board");
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
      body: "<!doctype html><html lang='en'><body><button id='opener'>Scene cards</button></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32706/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountSceneBoard} from ${JSON.stringify(moduleURL)};
window.sceneCardsCurrent={id:'draft1',source:'INT. HOUSE - DAY\\n\\n!HOUSE stays in action.\\n\\nEXT. PARK - NIGHT\\n\\n!Park.'};window.sceneCardsApplied=[];window.sceneCardsJumps=[];window.sceneCardsAccept=true;
window.sceneCardsUI=mountSceneBoard(document.body,{current:()=>window.sceneCardsCurrent,apply:(snapshot,plan)=>{if(!window.sceneCardsAccept)return false;window.sceneCardsApplied.push(plan);window.sceneCardsCurrent.source=plan.candidate;return true;},jump:(snapshot,line)=>{window.sceneCardsJumps.push(line);return true;}});document.querySelector('#opener').onclick=()=>window.sceneCardsUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.sceneCardsUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#opener").click();
const preview = () => page.getByRole("button", { name: "Preview synopsis" }).click();

describe("scene card synopsis workflow", () => {
  it("previews exact source, invalidates edited plans and applies one change", async () => {
    await open();
    await page.getByRole("button", { name: "Add synopsis…" }).first().click();
    await page.getByLabel("Scene synopsis", { exact: true }).fill("Mara arrives.\nLeaves again.");
    await preview();
    expect(await page.locator(".scene-synopsis-preview pre").last().textContent()).toBe(
      "\n= Mara arrives.\n= Leaves again.",
    );
    await page.getByLabel("Scene synopsis", { exact: true }).fill("Mara stays.");
    expect(
      await page.getByRole("button", { name: "Apply synopsis", exact: true }).isDisabled(),
    ).toBe(true);
    await preview();
    await page.getByRole("button", { name: "Apply synopsis", exact: true }).click();
    const plans = await page.evaluate(() => window.sceneCardsApplied);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.kind).toBe("synopsis");
    expect(plans[0]?.changes).toHaveLength(1);
    expect(plans[0]?.candidate).toContain(
      "INT. HOUSE - DAY\n= Mara stays.\n\n!HOUSE stays in action.",
    );
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });
  it("checks current id and source before preview and apply, even with an optimistic callback", async () => {
    await open();
    await page.getByRole("button", { name: "Add synopsis…" }).first().click();
    await page.getByLabel("Scene synopsis", { exact: true }).fill("Mara arrives.");
    await preview();
    await page.evaluate(() => {
      window.sceneCardsCurrent.source += "\n!New words.";
    });
    await page.getByRole("button", { name: "Apply synopsis", exact: true }).click();
    expect(await page.evaluate(() => window.sceneCardsApplied)).toEqual([]);
    expect(await page.locator(".scene-synopsis-editor").textContent()).toContain(
      "screenplay changed",
    );
    await page.keyboard.press("Escape");
    await open();
    await page.getByRole("button", { name: "Add synopsis…" }).first().click();
    await page.evaluate(() => {
      window.sceneCardsCurrent.id = "other";
    });
    await preview();
    expect(
      await page.getByRole("button", { name: "Apply synopsis", exact: true }).isDisabled(),
    ).toBe(true);
  });
  it("never offers to overwrite private comment fragments or dispersed synopsis blocks", async () => {
    for (const block of ["= Visible [[secret]]", "= One\n[[secret]]\n= Two"]) {
      await page.evaluate((block) => {
        window.sceneCardsCurrent.source = `INT. HOUSE\n${block}\n\n!Action.`;
      }, block);
      await open();
      await page.getByRole("button", { name: "Edit synopsis…" }).click();
      expect(await page.getByLabel("Scene synopsis", { exact: true }).isDisabled()).toBe(true);
      expect(await page.getByLabel("Scene synopsis", { exact: true }).inputValue()).toBe("");
      expect(
        await page.getByRole("button", { name: "Preview synopsis", exact: true }).isDisabled(),
      ).toBe(true);
      expect(await page.locator("dialog").textContent()).not.toContain("secret");
      await page.keyboard.press("Escape");
    }
    expect(await page.evaluate(() => window.sceneCardsApplied)).toEqual([]);
  });
  it("supports no-op, clearing an existing synopsis and callback rejection", async () => {
    await page.evaluate(() => {
      window.sceneCardsCurrent.source = "INT. HOUSE\n= Old\n\n!Action.";
    });
    await open();
    await page.getByRole("button", { name: "Edit synopsis…" }).click();
    await preview();
    expect(
      await page.getByRole("button", { name: "Apply synopsis", exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByLabel("Scene synopsis", { exact: true }).fill("");
    await preview();
    expect(await page.locator(".scene-synopsis-preview pre").first().textContent()).toBe("= Old\n");
    await page.evaluate(() => {
      window.sceneCardsAccept = false;
    });
    await page.getByRole("button", { name: "Apply synopsis", exact: true }).click();
    expect(await page.evaluate(() => window.sceneCardsCurrent.source)).toContain("= Old");
    expect(await page.evaluate(() => window.sceneCardsApplied)).toEqual([]);
  });
  it("renders bounded cards and clears stale plans on close/reopen", async () => {
    await page.evaluate(() => {
      window.sceneCardsCurrent.source = Array.from(
        { length: 120 },
        (_, i) => `INT. ROOM ${i}\n\n!Action.`,
      ).join("\n\n");
    });
    await open();
    expect(await page.locator(".scene-card-grid article").count()).toBe(50);
    await page.getByRole("button", { name: "Add synopsis…" }).first().click();
    await page.getByLabel("Scene synopsis", { exact: true }).fill("Temporary");
    await preview();
    await page.keyboard.press("Escape");
    await open();
    expect(await page.locator(".scene-synopsis-editor").isVisible()).toBe(false);
    await page.getByRole("button", { name: "Add synopsis…" }).first().click();
    expect(await page.getByLabel("Scene synopsis", { exact: true }).inputValue()).toBe("");
    expect(
      await page.getByRole("button", { name: "Apply synopsis", exact: true }).isDisabled(),
    ).toBe(true);
  });
});
