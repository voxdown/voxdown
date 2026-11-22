import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LocationSnapshot, mountLocations } from "../src/studio/location-dialog";
import type { LocationRenamePlan } from "../src/studio/locations";

declare global {
  interface Window {
    locationsUI: ReturnType<typeof mountLocations>;
    locationsCurrent: LocationSnapshot;
    locationsApplied: LocationRenamePlan[];
    locationsJumps: number[];
    locationsAccept: boolean;
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
const moduleURL = compile("location-dialog");
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
      body: "<!doctype html><html lang='en'><body><button id='opener'>Locations</button></body></html>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://localhost:32706/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountLocations} from ${JSON.stringify(moduleURL)};
window.locationsCurrent={id:'draft1',source:'INT. HOUSE - DAY\\n\\n!HOUSE stays in action.\\n\\nEXT. PARK - NIGHT\\n\\n!Park.'};window.locationsApplied=[];window.locationsJumps=[];window.locationsAccept=true;
window.locationsUI=mountLocations(document.body,{current:()=>window.locationsCurrent,apply:(snapshot,plan)=>{if(!window.locationsAccept)return false;window.locationsApplied.push(plan);window.locationsCurrent.source=plan.candidate;return true;},jump:(snapshot,line)=>{window.locationsJumps.push(line);return true;}});document.querySelector('#opener').onclick=()=>window.locationsUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.locationsUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#opener").click();
const preview = () => page.getByRole("button", { name: "Preview location rename" }).click();

describe("location directory dialog", () => {
  it("requires explicit collision acknowledgment and previews exact source changes", async () => {
    await open();
    await page.getByLabel("New location name").fill("PARK");
    await preview();
    expect(await page.locator(".location-rename-preview").textContent()).toContain("before:");
    expect(await page.getByRole("button", { name: "Apply location rename" }).isDisabled()).toBe(
      true,
    );
    await page.getByLabel("Merge with the existing location of this name").check();
    await page.getByRole("button", { name: "Apply location rename" }).click();
    const applied = await page.evaluate(() => window.locationsApplied);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.changes).toHaveLength(1);
    expect(applied[0]?.candidate).toContain("INT. PARK - DAY");
    expect(applied[0]?.candidate).toContain("HOUSE stays in action.");
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });

  it("rejects a preview after source changes and rejects jumps after switching drafts", async () => {
    await open();
    await page.getByLabel("New location name").fill("CABIN");
    await preview();
    await page.evaluate(() => {
      window.locationsCurrent.source += "\nNew words.";
    });
    await page.getByRole("button", { name: "Apply location rename" }).click();
    expect(await page.evaluate(() => window.locationsApplied)).toEqual([]);
    expect(await page.locator("dialog").textContent()).toContain("screenplay changed");
    await page.keyboard.press("Escape");
    await open();
    await page.evaluate(() => {
      window.locationsCurrent.id = "different-draft";
    });
    await page.locator(".location-appearances button").first().click();
    expect(await page.evaluate(() => window.locationsJumps)).toEqual([]);
    expect(await page.locator("dialog").textContent()).toContain("screenplay changed");
  });

  it("invalidates a plan when the name changes and leaves rejected source untouched", async () => {
    await open();
    await page.getByLabel("New location name").fill("CABIN");
    await preview();
    await page.getByLabel("New location name").fill("COTTAGE");
    expect(await page.getByRole("button", { name: "Apply location rename" }).isDisabled()).toBe(
      true,
    );
    await preview();
    await page.evaluate(() => {
      window.locationsAccept = false;
    });
    await page.getByRole("button", { name: "Apply location rename" }).click();
    expect(await page.evaluate(() => window.locationsCurrent.source)).toContain("INT. HOUSE - DAY");
    expect(await page.locator("dialog").textContent()).toContain("not applied");
  });

  it("caps directory, appearances and previews while keeping complete plans", async () => {
    await page.evaluate(() => {
      window.locationsCurrent.source = Array.from(
        { length: 120 },
        (_, i) => `INT. HOUSE - DAY\n\n!A.\n\nEXT. PLACE ${i} - NIGHT\n\n!B.`,
      ).join("\n\n");
    });
    await open();
    expect(await page.locator(".location-directory button").count()).toBe(50);
    expect(await page.locator(".location-appearances li").count()).toBe(50);
    await page.getByLabel("New location name").fill("CABIN");
    await preview();
    expect(await page.locator(".location-rename-preview li").count()).toBe(50);
    expect(await page.locator("dialog").textContent()).toContain("120 scene headings");
    await page.getByRole("button", { name: "Apply location rename" }).click();
    expect(await page.evaluate(() => window.locationsApplied[0]?.changes.length)).toBe(120);
    await open();
    await page.getByLabel("Find a location").fill("PLACE 119");
    expect(await page.locator(".location-directory button").count()).toBe(1);
    await page.locator(".location-directory button").click();
    await page.locator(".location-appearances button").click();
    expect(await page.evaluate(() => window.locationsJumps.length)).toBe(1);
  });

  it("discloses uncertain headings as safe text and returns keyboard focus on Escape", async () => {
    await page.evaluate(() => {
      window.locationsCurrent.source +=
        "\n\n.IMG <img src=x onerror=alert(1)>\n\n!A.\n\nINT. HOUSE - UNKNOWN TIME\n\n!B.";
    });
    await open();
    await page.locator("summary").click();
    expect(await page.locator(".location-exclusions").textContent()).toContain(
      "unrecognized final time suffix",
    );
    expect(await page.locator("dialog img").count()).toBe(0);
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#opener").evaluate((element) => element === document.activeElement),
    ).toBe(true);
  });
});
