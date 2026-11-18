import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const modules = new Map<string, string>();
function compile(name: string): string {
  const previous = modules.get(name);
  if (previous) return previous;
  const code = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
    },
  ).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dependency: string) =>
    JSON.stringify(compile(dependency)),
  );
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  modules.set(name, url);
  return url;
}
const tools = [
  ["fdx", "fdx-dialog", "mountFdxExport"],
  ["fdxImport", "fdx-import-dialog", "mountFdxImport"],
  ["replace", "replace-dialog", "mountScopedReplace"],
  ["backup", "backup", "mountBackup"],
  ["scenes", "scene-board", "mountSceneBoard"],
  ["library", "library", "mountLibrary"],
  ["health", "storage-health", "mountStorageHealth"],
  ["rename", "rename-dialog", "mountRename"],
  ["numbering", "numbering-dialog", "mountNumberingDialog"],
  ["rehearsal", "rehearsal-dialog", "mountRehearsal"],
  ["learning", "learning-dialog", "mountLearning"],
  ["compare", "compare-dialog", "mountCompareDialog"],
  ["adaptation", "adaptation-dialog", "mountAdaptation"],
  ["sides", "sides-dialog", "mountActorSides"],
  ["breakdown", "breakdown-dialog", "mountBreakdown"],
  ["locations", "location-dialog", "mountLocations"],
  ["coach", "coach", "mountCoach"],
  ["speech", "speech-dialog", "mountSpeechEditor"],
] as const;
const styles = ["studio.css", "dialog-layout.css"]
  .map((name) => readFileSync(new URL(`../src/studio/${name}`, import.meta.url), "utf8"))
  .join("\n");
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.route("http://localhost:32739/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><title>Dialog layout</title><button id="opener">Open</button></html>',
    }),
  );
  await page.goto("http://localhost:32739/");
  await page.addStyleTag({ content: styles });
  const imports = tools
    .map(([id, module, fn]) => `import {${fn} as ${id}} from ${JSON.stringify(compile(module))};`)
    .join("\n");
  await page.addScriptTag({
    type: "module",
    content: `${imports}
    const source='INT. KITCHEN - DAY\\n\\nMARA\\nA good place to start.\\n\\nEXT. GARDEN - NIGHT\\n\\nELI\\nKeep writing.';
    const actions={current:()=>({source,name:'A screenplay.fountain',id:'one',draftId:'one',paper:'letter',position:0,selection:{from:0,to:0}}),apply:()=>false,jump:()=>false,replace:async()=>false,openScreenplay:()=>false,download:()=>{},notice:()=>{}};
    window.dialogs={${tools.map(([id]) => `${id}:${id}(document.body, ${id === "coach" ? "actions.current, ()=>{}" : "actions"})`).join(",")}};`,
  });
  await page.waitForFunction(() => Reflect.get(window, "dialogs"));
});

describe("shared Studio dialog layout", () => {
  for (const width of [320, 768, 1440]) {
    it(`keeps headers, fields and actions inside ${width}px dialogs`, async () => {
      await page.setViewportSize({ width, height: 900 });
      for (const [id] of tools) {
        await page.evaluate(
          (id) => Reflect.get(window, "dialogs")[id].open(id === "speech" ? 3 : undefined),
          id,
        );
        const geometry = await page.locator("dialog[open]").evaluate((dialog) => {
          const header = dialog.querySelector(".studio-dialog-header") as HTMLElement;
          const title = header.querySelector("h2") as HTMLElement;
          const close = header.querySelector("button") as HTMLElement;
          const rect = dialog.getBoundingClientRect();
          return {
            overflow: dialog.scrollWidth - dialog.clientWidth,
            inside: rect.left >= 0 && rect.right <= innerWidth,
            aligned:
              Math.abs(title.getBoundingClientRect().top - close.getBoundingClientRect().top) <= 6,
            separate: title.getBoundingClientRect().right <= close.getBoundingClientRect().left,
            closeWidth: close.getBoundingClientRect().width,
            controls: [
              ...dialog.querySelectorAll<HTMLElement>(
                'input:not([type="checkbox"]), select, textarea',
              ),
            ]
              .filter((e) => !!e.getClientRects().length)
              .every(
                (e) =>
                  e.getBoundingClientRect().right <= rect.right - 12 &&
                  e.getBoundingClientRect().left >= rect.left,
              ),
          };
        });
        expect(geometry, id).toMatchObject({
          overflow: 0,
          inside: true,
          aligned: true,
          separate: true,
          controls: true,
        });
        expect(geometry.closeWidth).toBeGreaterThan(44);
        await page.locator("dialog[open]").evaluate((dialog) => {
          dialog.scrollTop = dialog.scrollHeight;
        });
        const sticky = await page.locator("dialog[open]").evaluate((dialog) => {
          const bounds = dialog.getBoundingClientRect();
          const close = dialog.querySelector(".studio-dialog-close")?.getBoundingClientRect();
          return !!close && close.top >= bounds.top && close.bottom <= bounds.bottom;
        });
        expect(sticky, `${id} keeps dismissal visible after scrolling`).toBe(true);
        await page.locator("dialog[open] .studio-dialog-close").click();
        expect(await page.locator("dialog[open]").count()).toBe(0);
      }
    });
  }
  it("groups portable backup saving and opening without changing action names", async () => {
    await page.evaluate(() => Reflect.get(window, "dialogs").backup.open());
    const sections = page.locator("dialog[open] .studio-dialog-section");
    expect(await sections.count()).toBe(2);
    expect(await sections.nth(0).getByRole("heading").textContent()).toBe("Save a backup");
    expect(await sections.nth(0).getByRole("button", { name: "Download backup" }).count()).toBe(1);
    expect(await sections.nth(1).getByLabel("Open Studio backup file").count()).toBe(1);
    expect(await page.locator("dialog[open]").textContent()).toContain("It includes private notes");
  });
  it("puts numbering and comparison choices before secondary explanations and uses singular counts", async () => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => Reflect.get(window, "dialogs").numbering.open());
    const preview = await page
      .getByRole("button", { name: "Preview scene numbering" })
      .boundingBox();
    expect(preview?.y).toBeLessThan(600);
    expect(await page.getByText("How numbering works", { exact: true }).count()).toBe(1);
    expect(await page.locator("dialog[open] details").getAttribute("open")).toBeNull();
    await page.locator("dialog[open] .studio-dialog-close").click();
    await page.evaluate(() => Reflect.get(window, "dialogs").compare.open());
    expect(await page.getByLabel("Baseline Fountain or text file").isVisible()).toBe(true);
    expect(await page.locator("dialog[open]").innerText()).not.toContain("8,000");
    expect(await page.locator("dialog[open]").innerText()).toContain("private notes");
    await page.locator("dialog[open] .studio-dialog-close").click();
    for (const id of ["breakdown", "rehearsal", "sides"]) {
      await page.evaluate((id) => Reflect.get(window, "dialogs")[id].open(), id);
      const text = await page.locator("dialog[open]").textContent();
      expect(text).not.toMatch(/\b1 (speeches|speech blocks|cues|segments)\b/);
      await page.locator("dialog[open] .studio-dialog-close").click();
    }
  });
});
