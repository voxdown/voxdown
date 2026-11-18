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
    await page.setViewportSize({ width: 800, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800);
    expect((await page.locator("#writing").boundingBox())?.width).toBeGreaterThanOrEqual(320);
    await page.setViewportSize({ width: 1101, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1101);
    expect((await page.locator("#writing").boundingBox())?.width).toBeGreaterThanOrEqual(320);
  });
});
