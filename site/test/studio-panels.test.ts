import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const code = transpileModule(
  readFileSync(new URL("../src/studio/panels.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
const styles = ["studio.css", "panels.css"]
  .map((file) => readFileSync(new URL(`../src/studio/${file}`, import.meta.url), "utf8"))
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
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("http://panels.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><title>Workspace panels</title><body><main id="app"><button id="outline-toggle">Scenes</button><div class="workspace"><aside id="outline"><h2>Scenes</h2><button id="outline-close">Close scenes</button><p>INT. KITCHEN — DAY</p><p>EXT. GARDEN — NIGHT</p></aside><section class="writing" id="writing"><h2>Screenplay</h2><textarea aria-label="Screenplay">INT. KITCHEN - DAY\n\nMARA\nKeep my selection.</textarea></section><section class="preview" id="preview"><h2>Page preview</h2><p>A screenplay page.</p></section></div></main></body></html>`,
    }),
  );
  await page.goto("http://panels.test/");
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${code}\nconst get=id=>document.getElementById(id); window.mount=()=>window.panels=mountWorkspacePanels({app:get('app'),workspace:document.querySelector('.workspace'),outline:get('outline'),writing:get('writing'),preview:get('preview'),outlineToggle:get('outline-toggle'),outlineClose:get('outline-close')});window.mount();get('outline-toggle').onclick=()=>window.panels.toggleOutline();const editor=document.querySelector('textarea');editor.focus();editor.setSelectionRange(5,12,'backward');`,
  });
  await page.waitForFunction(() => Reflect.get(window, "panels"));
});
const geometry = () =>
  page.evaluate(() => {
    const box = (id: string) => {
      const element = document.getElementById(id) as HTMLElement;
      const rect = element.getBoundingClientRect();
      return { width: rect.width, left: rect.left, visible: !!element.getClientRects().length };
    };
    return { outline: box("outline"), writing: box("writing"), preview: box("preview") };
  });
const source = () =>
  page
    .locator("textarea")
    .evaluate((e: HTMLTextAreaElement) => [
      e.value,
      e.selectionStart,
      e.selectionEnd,
      e.selectionDirection,
    ]);

describe("resizable workspace panels", () => {
  it("collapses desktop scenes into real writing space and preserves source/selection", async () => {
    const original = await source();
    const before = await geometry();
    expect(before.outline.width).toBe(224);
    await page.getByRole("button", { name: "Scenes", exact: true }).click();
    const collapsed = await geometry();
    expect(collapsed.outline.visible).toBe(false);
    expect(collapsed.writing.width).toBeGreaterThan(before.writing.width + 100);
    await expect(
      page.getByRole("separator", { name: "Resize Scenes panel" }).count(),
    ).resolves.toBe(0);
    await page.getByRole("button", { name: "Scenes", exact: true }).click();
    expect((await geometry()).outline.width).toBe(224);
    expect(await source()).toEqual(original);
  });
  it("supports keyboard bounds, physical divider direction and reset", async () => {
    const scenes = page.getByRole("separator", { name: "Resize Scenes panel" });
    await scenes.focus();
    await page.keyboard.press("End");
    expect((await geometry()).outline.width).toBe(360);
    await page.keyboard.press("Home");
    expect((await geometry()).outline.width).toBe(180);
    await page.keyboard.press("ArrowRight");
    expect((await geometry()).outline.width).toBe(196);
    await scenes.dblclick();
    expect((await geometry()).outline.width).toBe(224);
    const preview = page.getByRole("separator", { name: "Resize preview panel" });
    const before = (await geometry()).preview.width;
    await preview.focus();
    await page.keyboard.press("ArrowLeft");
    expect((await geometry()).preview.width).toBeCloseTo(before + 16, 0);
    await page.keyboard.press("End");
    expect((await geometry()).writing.width).toBeCloseTo(320, 0);
    await page.keyboard.press("Home");
    expect((await geometry()).preview.width).toBe(280);
  });
  it("captures a real pointer drag, reverts Escape/cancel/blur and persists only committed widths", async () => {
    const original = await source();
    const handle = page.getByRole("separator", { name: "Resize Scenes panel" });
    let box = await handle.boundingBox();
    if (!box) throw Error("missing separator");
    await page.mouse.move(box.x + 4, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 100);
    expect((await geometry()).outline.width).toBe(300);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await geometry()).outline.width).toBe(224);
    box = await handle.boundingBox();
    if (!box) throw Error("missing separator");
    await page.mouse.move(box.x + 4, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 104, box.y + 100);
    await page.mouse.up();
    expect((await geometry()).outline.width).toBe(324);
    const saved = await page.evaluate(() => localStorage.getItem("voxdown.studio.panel-widths.v1"));
    expect(JSON.parse(saved ?? "{}").outline).toBe(324);
    box = await handle.boundingBox();
    if (!box) throw Error("missing separator");
    await page.mouse.move(box.x + 4, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 100);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    expect((await geometry()).outline.width).toBe(324);
    expect(await source()).toEqual(original);
    await page.evaluate(() => {
      Reflect.get(window, "panels").dispose();
      Reflect.get(window, "mount")();
    });
    expect((await geometry()).outline.width).toBe(324);
  });
  it("provides a closeable tablet overlay and fits mobile without separators or page overflow", async () => {
    await page.setViewportSize({ width: 768, height: 900 });
    expect((await geometry()).outline.visible).toBe(false);
    await page.getByRole("button", { name: "Scenes", exact: true }).click();
    expect((await geometry()).outline.width).toBe(300);
    await page.getByRole("button", { name: "Close scenes" }).click();
    expect((await geometry()).outline.visible).toBe(false);
    await page.getByRole("button", { name: "Scenes", exact: true }).click();
    await page.keyboard.press("Escape");
    expect(await page.locator("#outline-toggle").getAttribute("aria-expanded")).toBe("false");
    for (const width of [759, 701, 700, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() =>
        [...document.querySelectorAll<HTMLElement>(".workspace-separator")].every((e) => e.hidden),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
  it("honors preview collapse/focus/expanded layouts and reclamps without destroying the preferred width", async () => {
    const preview = page.getByRole("separator", { name: "Resize preview panel" });
    await preview.focus();
    await page.keyboard.press("End");
    const preferred = (await geometry()).preview.width;
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".outline-separator")?.hidden,
    );
    expect((await geometry()).writing.width).toBeGreaterThanOrEqual(320);
    expect((await geometry()).preview.width).toBeLessThan(preferred);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(
      () => !document.querySelector<HTMLElement>(".outline-separator")?.hidden,
    );
    expect((await geometry()).preview.width).toBeCloseTo(preferred, 0);
    for (const name of ["no-preview", "focus-writing", "preview-expanded"]) {
      await page.evaluate((name) => {
        document.getElementById("app")?.classList.add(name);
        if (name === "no-preview")
          (document.getElementById("preview") as HTMLElement).hidden = true;
      }, name);
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>(".preview-separator")?.hidden,
      );
      expect(await page.getByRole("separator", { name: "Resize preview panel" }).count()).toBe(0);
      const layout = await geometry();
      expect(
        name === "preview-expanded" ? layout.preview.width : layout.writing.width,
      ).toBeGreaterThan(1000);
      await page.evaluate((name) => {
        document.getElementById("app")?.classList.remove(name);
        (document.getElementById("preview") as HTMLElement).hidden = false;
      }, name);
    }
  });
  it("guards corrupt preferences and removes listeners, separators and drag state on disposal", async () => {
    await page.evaluate(() => {
      Reflect.get(window, "panels").dispose();
      localStorage.setItem(
        "voxdown.studio.panel-widths.v1",
        '{"outline":"oops","preview":-999999}',
      );
      Reflect.get(window, "mount")();
    });
    expect((await geometry()).outline.width).toBe(224);
    expect((await geometry()).preview.width).toBe(280);
    await page.evaluate(() => Reflect.get(window, "panels").dispose());
    expect(await page.locator(".workspace-separator").count()).toBe(0);
    expect(await page.locator(".workspace").getAttribute("style")).toBe("");
    await page.setViewportSize({ width: 1000, height: 700 });
    expect(await page.locator(".workspace").getAttribute("style")).toBe("");
  });
  it("works when storage is denied and cancels pointer movement if capture is lost", async () => {
    await page.evaluate(() => {
      Reflect.get(window, "panels").dispose();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get: () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      });
      Reflect.get(window, "mount")();
    });
    const handle = page.getByRole("separator", { name: "Resize Scenes panel" });
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    expect((await geometry()).outline.width).toBe(240);
    const box = await handle.boundingBox();
    if (!box) throw Error("missing separator");
    await page.mouse.move(box.x + 4, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 74, box.y + 100);
    expect((await geometry()).outline.width).toBe(310);
    await handle.dispatchEvent("pointercancel");
    await page.mouse.up();
    expect((await geometry()).outline.width).toBe(240);
    expect(await page.locator("#app").getAttribute("class")).not.toContain("resizing-panels");
  });
  it("dismisses only overlay Scenes on outside pointer without stealing focus or changing selection", async () => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.evaluate(() => {
      const outside = document.createElement("button");
      outside.textContent = "Outside target";
      document.getElementById("preview")?.append(outside);
      const menu = document.createElement("nav");
      menu.className = "workspace-menus";
      menu.innerHTML = '<button type="button">File menu test</button>';
      document.getElementById("app")?.prepend(menu);
    });
    await page.getByRole("button", { name: "Scenes", exact: true }).click();
    const original = await source();
    await page.getByRole("button", { name: "File menu test" }).click();
    expect((await geometry()).outline.visible).toBe(true);
    await page.getByRole("button", { name: "Outside target" }).click();
    expect((await geometry()).outline.visible).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Outside target");
    expect(await source()).toEqual(original);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Outside target" }).click();
    expect((await geometry()).outline.visible).toBe(true);
  });
});
