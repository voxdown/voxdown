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

describe("toolbar choices during Focus", () => {
  for (const app of ["writer", "studio"] as const) {
    for (const visible of [true, false]) {
      it(`${app} preserves toolbar ${visible ? "on" : "off"} while Focus disables the choice`, async () => {
        const writer = app === "writer";
        const key = writer ? "vxd-writer-view" : "studio-preferences";
        await page.goto(`${origin}/${app}/`);
        if (writer) {
          await page.getByRole("button", { name: "Start a new story", exact: true }).click();
          await page.waitForFunction(() => !document.body.hasAttribute("data-welcome"));
        } else {
          await page.locator("#file").setInputFiles({
            name: "Sample.fountain",
            mimeType: "text/plain",
            buffer: Buffer.from("Sample words."),
          });
        }
        await page.locator(".cm-content").waitFor();
        const toolbar = page.locator(writer ? "#toolbar" : ".toolbar");
        const menu = page.locator(writer ? "#view-menu-button" : "#view-menu");
        const choice = writer
          ? page.locator('[data-view="toolbar"]')
          : page.locator("#view-dropdown").getByRole("button", { name: "Toolbar", exact: true });
        const stateAttribute = writer ? "aria-checked" : "aria-pressed";
        if (!visible) {
          await menu.click();
          await choice.click();
        }
        expect(await toolbar.isVisible()).toBe(visible);
        await page.keyboard.press("Control+Shift+f");
        await menu.click();
        expect(await choice.isDisabled()).toBe(true);
        expect(await choice.getAttribute(stateAttribute)).toBe("false");
        expect(await page.locator("#toolbar-focus-hint").isVisible()).toBe(true);
        // A disabled choice cannot silently change the preference, even through a dispatched click.
        await choice.evaluate((button: HTMLButtonElement) => button.click());
        expect(
          await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").toolbar, key),
        ).toBe(visible);
        expect(await toolbar.isVisible()).toBe(false);
        await page.keyboard.press("Escape");
        if (!writer) {
          await page.keyboard.press("Control+k");
          expect(
            await page
              .getByRole("dialog", { name: "Commands", exact: true })
              .getByRole("button", { name: "Toolbar", exact: true })
              .isDisabled(),
          ).toBe(true);
          await page.keyboard.press("Escape");
        }
        await page.keyboard.press("Control+Shift+f");
        expect(await toolbar.isVisible()).toBe(visible);
        await menu.click();
        expect(await choice.isEnabled()).toBe(true);
        expect(await choice.getAttribute(stateAttribute)).toBe(String(visible));
        expect(await page.locator("#toolbar-focus-hint").isVisible()).toBe(false);
        await choice.click();
        expect(await toolbar.isVisible()).toBe(!visible);
      });
    }
  }
});
