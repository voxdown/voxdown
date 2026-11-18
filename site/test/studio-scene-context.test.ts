import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  SceneContextSnapshot,
  SceneRoleSelection,
  mountSceneContext,
} from "../src/studio/scene-context";
import { type SceneEditPlan, listSceneCards } from "../src/studio/scene-edits";

declare global {
  interface Window {
    sceneContextUI: ReturnType<typeof mountSceneContext>;
    sceneContextCurrent: SceneContextSnapshot;
    sceneContextApplied: SceneEditPlan[];
    sceneContextJumps: number[];
    sceneContextRoles: { action: string; selection: SceneRoleSelection }[];
    sceneContextAccept: boolean;
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
const moduleURL = compile("scene-context");
const source =
  "Title: Example\n\nINT. HOUSE - DAY\n\nMAYA\nHello.\n\n[[private]]\n\nEXT. PARK - NIGHT\n\nLEO (O.S.)\nGoodbye.";
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32707/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body><aside></aside></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32707/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountSceneContext} from ${JSON.stringify(moduleURL)};
window.sceneContextCurrent={id:'draft1',source:${JSON.stringify(source)}};window.sceneContextApplied=[];window.sceneContextJumps=[];window.sceneContextRoles=[];window.sceneContextAccept=true;
window.sceneContextUI=mountSceneContext(document.querySelector('aside'),{current:()=>window.sceneContextCurrent,apply:(snapshot,plan)=>{if(!window.sceneContextAccept)return false;window.sceneContextApplied.push(plan);window.sceneContextCurrent.source=plan.candidate;return true;},jump:(snapshot,line)=>{window.sceneContextJumps.push(line);return true;},rehearse:(snapshot,selection)=>window.sceneContextRoles.push({action:'rehearse',selection}),sides:(snapshot,selection)=>window.sceneContextRoles.push({action:'sides',selection})});window.sceneContextUI.update(window.sceneContextCurrent,3);`,
  });
  await page.waitForFunction(() => Boolean(window.sceneContextUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const synopsis = () => page.getByLabel("Scene synopsis", { exact: true });
const update = async (source: string, line = 1) =>
  page.evaluate(
    ({ source, line }) => {
      window.sceneContextCurrent.source = source;
      window.sceneContextUI.update(window.sceneContextCurrent, line);
    },
    { source, line },
  );

describe("connected scene inspector", () => {
  it("follows the caret, navigates scenes, and hands off the selected scene and normalized role", async () => {
    expect(await page.locator(".scene-context-heading").textContent()).toBe("INT. HOUSE - DAY");
    await page.getByRole("button", { name: "Rehearse", exact: true }).click();
    await page.getByRole("button", { name: "Next scene in inspector" }).click();
    expect(await page.locator(".scene-context-heading").textContent()).toBe("EXT. PARK - NIGHT");
    await page.getByRole("button", { name: "Actor sides…", exact: true }).click();
    expect(await page.evaluate(() => window.sceneContextJumps)).toEqual([10]);
    expect(await page.evaluate(() => window.sceneContextRoles)).toEqual([
      { action: "rehearse", selection: { role: "MAYA", sceneLine: 3 } },
      { action: "sides", selection: { role: "LEO", sceneLine: 10 } },
    ]);
    await page.evaluate(() => window.sceneContextUI.select(1));
    expect(await page.getByRole("button", { name: "Rehearse", exact: true }).isVisible()).toBe(
      false,
    );
    expect(await page.locator(".scene-context-heading").textContent()).toContain(
      "Place the cursor",
    );
  });
  it("saves one source-preserving edit and leaves private notes untouched", async () => {
    await page.getByRole("button", { name: "Add synopsis…", exact: true }).click();
    await synopsis().fill("Maya arrives.\nShe waits.");
    await page.getByRole("button", { name: "Save synopsis", exact: true }).click();
    const applied = await page.evaluate(() => window.sceneContextApplied);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.changes).toHaveLength(1);
    expect(applied[0]?.candidate).toBe(
      source.replace("INT. HOUSE - DAY", "INT. HOUSE - DAY\n= Maya arrives.\n= She waits."),
    );
    expect(await page.getByRole("status").textContent()).toContain("Undo restores");
  });
  it("keeps an unsaved synopsis pinned when the caret moves, then follows it after cancel", async () => {
    await page.getByRole("button", { name: "Add synopsis…", exact: true }).click();
    await synopsis().fill("Unfinished thought");
    await page.evaluate(() => window.sceneContextUI.select(10));
    expect(await synopsis().inputValue()).toBe("Unfinished thought");
    expect(await page.locator(".scene-context-heading").textContent()).toBe("INT. HOUSE - DAY");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.locator(".scene-context-heading").textContent()).toBe("EXT. PARK - NIGHT");
    expect(await page.evaluate(() => window.sceneContextApplied)).toEqual([]);
  });
  it("refuses stale source or identity even if the callback would accept it", async () => {
    await page.getByRole("button", { name: "Add synopsis…", exact: true }).click();
    await synopsis().fill("Keep my words");
    await page.evaluate(() => {
      window.sceneContextCurrent.id = "other";
    });
    await page.getByRole("button", { name: "Save synopsis", exact: true }).click();
    expect(await page.evaluate(() => window.sceneContextApplied)).toEqual([]);
    expect(await synopsis().inputValue()).toBe("Keep my words");
    await update(`${source}\nNew words`, 10);
    expect(
      await page.getByRole("button", { name: "Save synopsis", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await synopsis().inputValue()).toBe("Keep my words");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => {
      window.sceneContextCurrent.source += "\nChanged again";
    });
    await page.getByRole("button", { name: "Rehearse", exact: true }).click();
    expect(await page.evaluate(() => window.sceneContextRoles)).toEqual([]);
  });
  it("refuses reconstructing private or dispersed synopsis blocks and unsafe performance roles", async () => {
    for (const block of ["= Visible [[secret]]", "= One\n[[secret]]\n= Two"]) {
      await update(`INT. HOUSE\n${block}\n\n!Action.`);
      await page.getByRole("button", { name: "Edit synopsis…", exact: true }).click();
      expect(await synopsis().isVisible()).toBe(false);
      expect(await page.locator("aside").textContent()).not.toContain("secret");
      expect(await page.getByRole("status").textContent()).toMatch(/private|separate/);
    }
    for (const privateText of ["[[unfinished", "[[outer [[inner]]\n\nLEAKED\nWords.\n\n]]"]) {
      await update(`INT. HOUSE\n\n${privateText}\n\nMAYA\nHello.`);
      expect(await page.getByRole("button", { name: "Rehearse", exact: true }).isVisible()).toBe(
        false,
      );
    }
    expect(await page.evaluate(() => window.sceneContextApplied)).toEqual([]);
  });
  it("retains text on rejected apply and allows correction after invalid synopsis text", async () => {
    await page.getByRole("button", { name: "Add synopsis…", exact: true }).click();
    await synopsis().fill("[[private]]");
    await page.getByRole("button", { name: "Save synopsis", exact: true }).click();
    expect(await page.evaluate(() => window.sceneContextApplied)).toEqual([]);
    await synopsis().fill("A new summary");
    await page.evaluate(() => {
      window.sceneContextAccept = false;
    });
    await page.getByRole("button", { name: "Save synopsis", exact: true }).click();
    expect(await synopsis().inputValue()).toBe("A new summary");
    expect(await page.getByRole("status").textContent()).toContain("could not be saved");
  });
  it("reuses a worker parse while keeping exact BOM and CRLF source for synopsis edits", async () => {
    const exact =
      "\uFEFFTitle: Example\r\n\r\n# Act one\r\n\r\nINT. HOUSE\r\n= One\r\n\r\nMAYA\r\nHello.\r\n\r\n[[private]]\r\n\r\nEXT. PARK\r\n= Two\r\n\r\nLEO\r\nGoodbye.";
    await page.addScriptTag({
      type: "module",
      content: `import {parseFountain} from ${JSON.stringify(compile("fountain"))};
window.sceneContextCurrent.source=${JSON.stringify(exact)};
window.sceneContextUI.update(window.sceneContextCurrent,5,parseFountain(window.sceneContextCurrent.source.slice(1).replace(/\\r\\n/g,'\\n')));`,
    });
    for (const scene of listSceneCards(exact)) {
      await page.evaluate((line) => window.sceneContextUI.select(line), scene.line);
      expect(await page.locator(".scene-context-heading").textContent()).toBe(scene.heading);
      expect(await page.locator(".scene-context-synopsis").textContent()).toBe(scene.synopsis);
    }
    await page.getByRole("button", { name: "Edit synopsis…", exact: true }).click();
    await synopsis().fill("Changed");
    await page.getByRole("button", { name: "Save synopsis", exact: true }).click();
    expect(await page.evaluate(() => window.sceneContextCurrent.source)).toBe(
      exact.replace("= Two", "= Changed"),
    );
  });
  it("bounds role choices while allowing search beyond the first hundred", async () => {
    await update(
      `INT. HOUSE\n\n${Array.from({ length: 150 }, (_, i) => `@PERSON ${i}\nHello.`).join("\n\n")}`,
    );
    expect(await page.locator("select option").count()).toBe(100);
    await page.getByLabel("Find a character in this scene").fill("PERSON 149");
    expect(await page.locator("select option").count()).toBe(1);
    await page.getByRole("button", { name: "Rehearse", exact: true }).click();
    expect(await page.evaluate(() => window.sceneContextRoles[0]?.selection.role)).toBe(
      "PERSON 149",
    );
  });
});
