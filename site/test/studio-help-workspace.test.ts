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
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  await page.goto(`${origin}/studio/`);
  await page.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
});
afterEach(async () => context.close());
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("Studio Help and menu integration", () => {
  it("opens the shortcut reference from editor, header and preview and returns focus", async () => {
    await page.locator("#preview-toggle").click();
    for (const selector of [".cm-content", "#file-menu", "#page-scroll"]) {
      await page.locator(selector).focus();
      await page.keyboard.press("Control+/");
      expect(
        await page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }).isVisible(),
      ).toBe(true);
      await page.keyboard.press("Escape");
      expect(await page.locator(selector).evaluate((node) => node === document.activeElement)).toBe(
        true,
      );
    }
  });

  it("keeps About discoverable from Help and blocks a shortcut from opening a second modal", async () => {
    await page.locator("#help-menu").click();
    const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts…", exact: true });
    expect(await shortcuts.locator("kbd").innerText()).toBe("Ctrl+/");
    await page.getByRole("button", { name: "About VoxDown Studio…", exact: true }).click();
    expect(
      await page.getByRole("dialog", { name: "About VoxDown Studio", exact: true }).isVisible(),
    ).toBe(true);
    await page.keyboard.press("Control+/");
    expect(await page.locator("dialog[open]").count()).toBe(1);
    expect(await page.locator("#studio-about").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#help-menu").evaluate((node) => node === document.activeElement),
    ).toBe(true);
  });

  it("tabs out of the last Help action to a visible header control when the toolbar is hidden", async () => {
    await page.locator("#view-menu").click();
    expect(
      await page.getByRole("button", { name: "Toolbar", exact: true }).getAttribute("aria-pressed"),
    ).toBe("true");
    await page.getByRole("button", { name: "Toolbar", exact: true }).click();
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    await page.locator("#view-menu").click();
    expect(
      await page.getByRole("button", { name: "Toolbar", exact: true }).getAttribute("aria-pressed"),
    ).toBe("false");
    await page.locator("#help-menu").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    expect(await page.locator("#help-dropdown").isVisible()).toBe(false);
    expect(await page.locator("#name").evaluate((node) => node === document.activeElement)).toBe(
      true,
    );
    expect(await page.locator("#name").isVisible()).toBe(true);
  });

  it("enters menus with F10 and exposes ordinary Find separately from scoped replacement", async () => {
    await page.locator(".cm-content").focus();
    await page.keyboard.press("F10");
    expect(
      await page.locator("#file-menu").evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const menu = page.locator("#edit-dropdown");
    expect(await menu.isVisible()).toBe(true);
    expect(await menu.getByRole("button", { name: "Find…", exact: true }).isVisible()).toBe(true);
    expect(
      await menu.getByRole("button", { name: "Scoped find and replace…", exact: true }).isVisible(),
    ).toBe(true);
    await menu.getByRole("button", { name: "Find…", exact: true }).click();
    expect(await page.locator(".cm-search").isVisible()).toBe(true);
  });
});
