import { readFileSync } from "node:fs";
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
  context = await browser.newContext({ viewport: { width: 320, height: 700 } });
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
const menu = () => page.locator("#file-dropdown");
const openFiles = () => page.locator("#file-menu").click();
async function downloadFromMenu() {
  const pending = page.waitForEvent("download");
  await menu().getByRole("button", { name: "Download Fountain", exact: true }).click();
  return readFileSync((await (await pending).path()) as string, "utf8");
}
describe("mobile File menu integration", () => {
  it.each([320, 375])(
    "fits at %ipx and groups file actions in a real disclosure",
    async (width) => {
      await page.setViewportSize({ width, height: 700 });
      await start();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect((await page.locator("#file-menu").boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect((await page.locator("#name").boundingBox())?.width).toBeGreaterThanOrEqual(100);
      await openFiles();
      expect(await page.locator("#file-menu").getAttribute("aria-expanded")).toBe("true");
      expect(await page.getByRole("dialog", { name: "Commands", exact: true }).isVisible()).toBe(
        false,
      );
      for (const name of [
        "New screenplay",
        "Open Fountain…",
        "Import Final Draft…",
        "Download Fountain",
        "Recovery and snapshots…",
        "Backup and restore…",
      ])
        expect(await menu().getByRole("button", { name, exact: true }).isVisible()).toBe(true);
      expect(
        await menu().getByRole("button", { name: "Rename character…", exact: true }).count(),
      ).toBe(0);
      expect(await menu().evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await menu().locator("hr").count()).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("Escape");
      expect(await menu().isVisible()).toBe(false);
      expect(
        await page.locator("#file-menu").evaluate((element) => document.activeElement === element),
      ).toBe(true);
      await page.keyboard.press("ArrowDown");
      expect(
        await menu()
          .getByRole("button", { name: "New screenplay", exact: true })
          .evaluate((element) => document.activeElement === element),
      ).toBe(true);
      await page.keyboard.press("End");
      expect(
        await menu()
          .getByRole("button")
          .last()
          .evaluate((element) => document.activeElement === element),
      ).toBe(true);
      await page.keyboard.press("Home");
      expect(
        await menu()
          .getByRole("button", { name: "New screenplay", exact: true })
          .evaluate((element) => document.activeElement === element),
      ).toBe(true);
      await page.keyboard.press("Escape");
    },
  );
  it("keeps File and keyboard Commands available in Focus on phone and desktop", async () => {
    await start();
    await openFiles();
    await page.keyboard.press("Escape");
    await page.locator("#view-menu").click();
    await page
      .locator("#view-dropdown")
      .getByRole("button", { name: "Focus writing", exact: true })
      .click();
    expect(await page.locator("#file-menu").isVisible()).toBe(true);
    expect(await page.locator("#commands").isVisible()).toBe(false);
    await page.keyboard.press("Control+k");
    const commands = page.getByRole("dialog", { name: "Commands", exact: true });
    await commands.getByRole("combobox").selectOption("Files and recovery");
    const pending = page.waitForEvent("download");
    await commands.getByRole("button", { name: "Download Fountain", exact: true }).click();
    expect(readFileSync((await (await pending).path()) as string, "utf8")).toBe("!Alpha beta");
    expect(await page.locator("#mobile-focus").getAttribute("aria-pressed")).toBe("true");
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.locator("#file-menu").isVisible()).toBe(true);
    await openFiles();
    expect(await downloadFromMenu()).toBe("!Alpha beta");
  });
  it("downloads exact source through the File menu and restores focus after recovery", async () => {
    const original = "\uFEFFINT. ROOM\r\n\r\n!Exact source.\r\n";
    await start(original);
    await openFiles();
    expect(await downloadFromMenu()).toBe(original);
    expect(await menu().isVisible()).toBe(false);
    await openFiles();
    await menu().getByRole("button", { name: "Recovery and snapshots…", exact: true }).click();
    expect(await page.getByRole("dialog").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#file-menu").evaluate((element) => document.activeElement === element),
    ).toBe(true);
    expect(await page.locator("#name").inputValue()).toBe("Files.fountain");
  });
});
