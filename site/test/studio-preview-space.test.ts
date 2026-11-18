import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const code = transpileModule(
  readFileSync(new URL("../src/studio/preview-space.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
const styles = readFileSync(new URL("../src/studio/studio.css", import.meta.url), "utf8");
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
  page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await page.setContent(`<!doctype html><html lang="en"><title>Preview space test</title>
    <main id="app" class="outline-open"><aside id="outline">Scenes</aside>
    <section id="writing"><textarea aria-label="Screenplay">INT. ROOM

MARA
Keep this selection.</textarea></section>
    <section id="preview"><div id="page-panel" role="tabpanel"><button id="expand" type="button">Expand preview</button>
    <div tabindex="0" aria-label="Preview page" role="region">The page</div></div>
    <button id="reference" type="button">Text reference</button></section></main>
    <dialog><button type="button">Close</button></dialog></html>`);
  await page.addScriptTag({
    type: "module",
    content: `${code}
      const get=id=>document.getElementById(id);
      const editor=document.querySelector('textarea');
      editor.focus(); editor.setSelectionRange(10,17,'backward');
      window.focusCalls=0;
      window.previewSpace=mountPreviewSpace({app:get('app'),preview:get('preview'),writing:get('writing'),outline:get('outline'),button:get('expand')},()=>{window.focusCalls++;editor.focus()});`,
  });
  await page.waitForFunction(() => Reflect.get(window, "previewSpace"));
});
const state = () =>
  page.evaluate(() => {
    const editor = document.querySelector("textarea") as HTMLTextAreaElement;
    const button = document.getElementById("expand") as HTMLButtonElement;
    return {
      active: Reflect.get(window, "previewSpace").expanded(),
      classes: document.getElementById("app")?.className,
      inert: ["writing", "outline"].map((id) => document.getElementById(id)?.inert),
      text: editor.value,
      selection: [editor.selectionStart, editor.selectionEnd, editor.selectionDirection],
      focusedEditor: document.activeElement === editor,
      focusCalls: Reflect.get(window, "focusCalls"),
      hidden: button.hidden,
      label: button.textContent,
      pressed: button.getAttribute("aria-pressed"),
    };
  });

describe("temporary expanded page preview", () => {
  it("uses the real stylesheet to enlarge tablet page text without panning and caps desktop paper width", async () => {
    await page.addStyleTag({ content: styles });
    await page.evaluate(() => {
      const app = document.getElementById("app") as HTMLElement;
      const workspace = document.createElement("div");
      workspace.className = "workspace";
      workspace.append(...app.children);
      app.append(workspace);
      document.getElementById("writing")?.classList.add("writing");
      document.getElementById("preview")?.classList.add("preview");
      const panel = document.getElementById("page-panel") as HTMLElement;
      panel.classList.add("studio-side-panel");
      const scroll = document.createElement("div");
      scroll.id = "page-scroll";
      scroll.innerHTML =
        '<div id="page" style="--page-width:612;--full-width:816px"><span class="page-line">A readable screenplay.</span></div>';
      panel.append(scroll);
    });
    const geometry = () =>
      page.evaluate(() => {
        const paper = document.getElementById("page") as HTMLElement;
        const scroll = document.getElementById("page-scroll") as HTMLElement;
        return {
          width: paper.getBoundingClientRect().width,
          font: Number.parseFloat(
            getComputedStyle(document.querySelector(".page-line") as HTMLElement).fontSize,
          ),
          overflow: scroll.scrollWidth - scroll.clientWidth,
        };
      });
    const split = await geometry();
    await page.getByRole("button", { name: "Expand preview" }).click();
    const tablet = await geometry();
    expect(tablet.width).toBeGreaterThan(split.width * 2);
    expect(tablet.font).toBeGreaterThan(14);
    expect(tablet.overflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktop = await geometry();
    expect(desktop.width).toBe(816);
    expect(desktop.font).toBe(16);
    expect(desktop.overflow).toBeLessThanOrEqual(1);
  });

  it("restores the exact source, selection and existing outline state without editing", async () => {
    const original = await state();
    await page.getByRole("button", { name: "Expand preview" }).click();
    expect(await state()).toMatchObject({
      active: true,
      classes: "outline-open preview-expanded",
      inert: [true, true],
      label: "Return to writing",
      pressed: "true",
    });
    await page.getByRole("button", { name: "Return to writing" }).click();
    expect(await state()).toEqual({ ...original, focusCalls: 1 });
  });

  it("Escape returns to writing and is consumed only while expanded", async () => {
    await page.getByRole("button", { name: "Expand preview" }).click();
    const pressEscape = () =>
      page.evaluate(() => {
        const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await pressEscape()).toBe(true);
    expect(await state()).toMatchObject({ active: false, focusedEditor: true, focusCalls: 1 });
    expect(await pressEscape()).toBe(false);
  });

  it("leaves dialog Escape, composing and previously handled keyboard events alone", async () => {
    await page.getByRole("button", { name: "Expand preview" }).click();
    await page.evaluate(() => document.querySelector("dialog")?.showModal());
    await page.keyboard.press("Escape");
    expect(await state()).toMatchObject({ active: true, focusCalls: 0 });
    await page.evaluate(() => {
      document.querySelector("dialog")?.close();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true }));
      const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      handled.preventDefault();
      document.dispatchEvent(handled);
    });
    expect(await state()).toMatchObject({ active: true, focusCalls: 0 });
  });

  it("does not steal focus on source navigation, preserves prior inert values and restores once", async () => {
    await page.evaluate(() => {
      (document.getElementById("outline") as HTMLElement).inert = true;
      Reflect.get(window, "previewSpace").expand();
      Reflect.get(window, "previewSpace").restore(false);
      Reflect.get(window, "previewSpace").restore();
    });
    expect(await state()).toMatchObject({ active: false, inert: [false, true], focusCalls: 0 });
  });

  it("restores split layout when the reference tab hides the page controls, retaining reference focus", async () => {
    await page.getByRole("button", { name: "Expand preview" }).click();
    await page.evaluate(() => {
      (document.getElementById("page-panel") as HTMLElement).hidden = true;
      document.getElementById("reference")?.focus();
    });
    await page.waitForFunction(() => !Reflect.get(window, "previewSpace").expanded());
    expect(await state()).toMatchObject({ active: false, inert: [false, false], focusCalls: 0 });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("reference");
    expect(await page.evaluate(() => Reflect.get(window, "previewSpace").expand())).toBe(false);
  });

  it("refuses hidden preview, Focus, locked workspace and disabled controls", async () => {
    const attempts = await page.evaluate(() => {
      const app = document.getElementById("app") as HTMLElement;
      const preview = document.getElementById("preview") as HTMLElement;
      const button = document.getElementById("expand") as HTMLButtonElement;
      const controller = Reflect.get(window, "previewSpace");
      const attempts: boolean[] = [];
      preview.hidden = true;
      attempts.push(controller.expand());
      preview.hidden = false;
      app.classList.add("focus-writing");
      attempts.push(controller.expand());
      app.classList.remove("focus-writing");
      app.classList.add("no-preview");
      attempts.push(controller.expand());
      app.classList.remove("no-preview");
      app.inert = true;
      attempts.push(controller.expand());
      app.inert = false;
      button.disabled = true;
      attempts.push(controller.expand());
      button.disabled = false;
      attempts.push(controller.expand());
      attempts.push(controller.expand());
      return attempts;
    });
    expect(attempts).toEqual([false, false, false, false, false, true, false]);
  });

  it("exits at the phone breakpoint without stealing focus or reopening on a wider screen", async () => {
    await page.getByRole("button", { name: "Expand preview" }).click();
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForFunction(() => (document.getElementById("expand") as HTMLElement).hidden);
    expect(await state()).toMatchObject({ active: false, hidden: true, focusCalls: 0 });
    expect(await page.evaluate(() => Reflect.get(window, "previewSpace").expand())).toBe(false);
    await page.setViewportSize({ width: 701, height: 900 });
    await page.getByRole("button", { name: "Expand preview" }).waitFor();
    expect(await state()).toMatchObject({ active: false, hidden: false, focusCalls: 0 });
  });

  it("restores on disposal and removes all event listeners", async () => {
    await page.getByRole("button", { name: "Expand preview" }).click();
    await page.evaluate(() => Reflect.get(window, "previewSpace").dispose());
    await page.getByRole("button", { name: "Expand preview" }).click();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => Reflect.get(window, "previewSpace").expand())).toBe(false);
    expect(await state()).toMatchObject({
      active: false,
      classes: "outline-open",
      inert: [false, false],
      focusCalls: 0,
      hidden: false,
    });
  });
});
