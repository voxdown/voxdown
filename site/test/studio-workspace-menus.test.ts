import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { type ViteDevServer, createServer } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

let server: ViteDevServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Studio test server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
}, 30_000);
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
});
afterEach(async () => context.close());
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
const ready = () =>
  page.waitForFunction(
    () =>
      !document.querySelector<HTMLElement>("#app")?.inert &&
      !document.querySelector("#counts")?.textContent?.includes("Updating"),
  );
async function start(source = "!Alpha beta") {
  await page.goto(`${origin}/studio/`);
  await ready();
  await page
    .locator("#file")
    .setInputFiles({ name: "Files.fountain", mimeType: "text/plain", buffer: Buffer.from(source) });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement)?.value === "Files.fountain",
  );
  await ready();
}
describe("integrated workspace navigation", () => {
  it("switches an open menu bar on mouse hover without opening closed or unrelated menus", async () => {
    await start();
    await page.locator("#view-menu").hover();
    expect(await page.locator(".workspace-dropdown:visible").count()).toBe(0);
    await page.locator("#file-menu").click();
    for (const name of ["edit", "view", "tools", "help", "file"]) {
      await page.locator(`#${name}-menu`).hover();
      expect(await page.locator(".workspace-dropdown:visible").count()).toBe(1);
      expect(await page.locator(`#${name}-dropdown`).isVisible()).toBe(true);
      expect(await page.locator(`#${name}-menu`).getAttribute("aria-expanded")).toBe("true");
      expect(
        await page
          .locator(`#${name}-dropdown`)
          .evaluate((panel) => panel.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.locator("#commands").hover();
    expect(await page.locator("#file-dropdown").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.locator("#file-menu").evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    await page.locator("#view-menu").hover();
    expect(await page.locator(".workspace-dropdown:visible").count()).toBe(0);
    expect(await page.locator(".cm-content").innerText()).toBe("!Alpha beta");
  });
  it("browses menu siblings with the arrow keys without changing the screenplay", async () => {
    await start();
    await page.locator("#file-menu").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.locator("#edit-menu").evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    expect(await page.locator(".workspace-dropdown:visible").count()).toBe(0);
    await page.keyboard.press("Enter");
    for (const name of ["view", "tools", "help", "file", "edit"]) {
      await page.keyboard.press("ArrowRight");
      expect(await page.locator(`#${name}-dropdown`).isVisible()).toBe(true);
    }
    await page.keyboard.press("ArrowLeft");
    expect(await page.locator("#file-dropdown").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.locator("#file-menu").evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    expect(await page.locator(".cm-content").innerText()).toBe("!Alpha beta");
  });
  it("keeps nonblocking layout notes available without a banner and retains real warnings", async () => {
    await start("Title: Test\nNotes: Private title metadata\n\nINT. ROOM - DAY\n\nA door closes.");
    expect(await page.locator("#issues").isVisible()).toBe(false);
    await page.getByRole("button", { name: "1 layout note", exact: true }).click();
    expect(await page.locator("#layout-notes-list").textContent()).toContain("notes");
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#layout-notes").evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.locator("#file").setInputFiles({
      name: "Warning.fountain",
      mimeType: "text/plain",
      buffer: Buffer.from("INT. ROOM\n\n[[Unclosed note"),
    });
    await page.waitForFunction(
      () => (document.querySelector("#name") as HTMLInputElement)?.value === "Warning.fountain",
    );
    await ready();
    expect(await page.locator("#issues").isVisible()).toBe(true);
    expect(await page.locator("#pdf").isDisabled()).toBe(true);
  });
  it("keeps touch menu switching and dismissal on single taps", async () => {
    await context.close();
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    page = await context.newPage();
    await start();
    await page.locator("#file-menu").tap();
    expect(await page.locator("#file-dropdown").isVisible()).toBe(true);
    await page.locator("#view-menu").tap();
    expect(await page.locator("#file-dropdown").isVisible()).toBe(false);
    expect(await page.locator("#view-dropdown").isVisible()).toBe(true);
    await page.locator("#view-menu").tap();
    expect(await page.locator(".workspace-dropdown:visible").count()).toBe(0);
  });
  it("keeps preferences fields visible during backward keyboard traversal", async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await start();
    await page.locator("#view-menu").click();
    await page.locator("#preferences").click();
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let step = 0; step < 24; step++) {
        await page.keyboard.press(key);
        expect(
          await page.evaluate(async () => {
            await new Promise(requestAnimationFrame);
            const field = document.activeElement as HTMLElement;
            const dialog = document.querySelector("#preferences-dialog");
            const header = dialog?.querySelector(".dialog-heading");
            if (field === dialog || !dialog?.contains(field) || header?.contains(field))
              return true;
            const rect = field.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            return (
              rect.top >= (header?.getBoundingClientRect().bottom ?? 0) &&
              !!hit &&
              (hit === field || field.contains(hit))
            );
          }),
          `${key} step ${step}`,
        ).toBe(true);
      }
    }
  });
  it("keeps the focused preferences field on screen when the viewport shrinks", async () => {
    await start();
    await page.locator("#view-menu").click();
    await page.locator("#preferences").click();
    const field = page.locator("#preferences-dialog select").last();
    await field.focus();
    await page.setViewportSize({ width: 320, height: 300 });
    await page.waitForFunction(() => {
      const field = document.activeElement as HTMLElement;
      const dialog = field.closest("dialog");
      if (!dialog) return false;
      const rect = field.getBoundingClientRect();
      const top = dialog.querySelector(".dialog-heading")?.getBoundingClientRect().bottom ?? 0;
      const bottom = dialog.getBoundingClientRect().bottom;
      return rect.top >= top && rect.bottom <= bottom;
    });
    expect(await field.evaluate((field) => field === document.activeElement)).toBe(true);
  });
  it("exposes panel states and returns dialog focus to the visible menu trigger", async () => {
    await start();
    await page.locator("#view-menu").click();
    const scenes = page
      .locator("#view-dropdown")
      .getByRole("button", { name: "Scenes panel", exact: true });
    expect(await scenes.getAttribute("aria-pressed")).toBe("true");
    await scenes.click();
    expect(await page.locator("#outline").isVisible()).toBe(false);
    await page.locator("#view-menu").click();
    expect(await scenes.getAttribute("aria-pressed")).toBe("false");
    await page.locator("#preferences").click();
    await page.keyboard.press("Escape");
    expect(await page.locator("#view-menu").evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
  });
  it("returns Commands to a visible trigger when opened from a menu", async () => {
    await start();
    await page.locator("#file-menu").click();
    await page.keyboard.press("Control+k");
    expect(await page.getByRole("dialog", { name: "Commands", exact: true }).isVisible()).toBe(
      true,
    );
    expect(await page.locator("#file-dropdown").isVisible()).toBe(false);
    await page.keyboard.press("Escape");
    expect(await page.locator("#file-menu").evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
  });
  it("dismisses preview actions before leaving expanded preview and keeps Tab local", async () => {
    await start();
    await page.locator("#preview-toggle").click();
    await page.locator("#expand-preview").click();
    await page.locator("#preview-menu").click();
    await page.keyboard.press("Escape");
    expect(await page.locator("#preview-dropdown").isVisible()).toBe(false);
    expect(
      await page.locator("#app").evaluate((el) => el.classList.contains("preview-expanded")),
    ).toBe(true);
    expect(
      await page.locator("#preview-menu").evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.locator("#preview-menu").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    expect(await page.locator("#page-scroll").evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    expect(await page.locator("#preview-dropdown").isVisible()).toBe(false);
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#app").evaluate((el) => el.classList.contains("preview-expanded")),
    ).toBe(false);
    expect(await page.locator(".cm-content").innerText()).toBe("!Alpha beta");
  });
  it("keeps pane widths within a resized viewport before observer settlement", async () => {
    await start();
    // A breakpoint can reveal the outline before its handle's ResizeObserver
    // clears hidden. Writing must stay in its track even in that intermediate state.
    const widthWithPendingHandle = await page.evaluate(() => {
      const handle = document.querySelector<HTMLElement>(".outline-separator");
      if (!handle) throw Error("Scenes resize handle missing");
      handle.hidden = true;
      const width = document.querySelector("#writing")?.getBoundingClientRect().width;
      handle.hidden = false;
      return width;
    });
    expect(widthWithPendingHandle).toBeGreaterThanOrEqual(320);
    await page.setViewportSize({ width: 800, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800);
    expect((await page.locator("#writing").boundingBox())?.width).toBeGreaterThanOrEqual(320);
    await page.setViewportSize({ width: 1101, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1101);
    expect((await page.locator("#writing").boundingBox())?.width).toBeGreaterThanOrEqual(320);
  });
});
