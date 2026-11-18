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
const menu = () => page.getByRole("dialog", { name: "Commands", exact: true });
const openFiles = () => page.getByRole("button", { name: "File…", exact: true }).click();
async function downloadFromMenu() {
  const pending = page.waitForEvent("download");
  await menu().getByRole("button", { name: "Download Fountain", exact: true }).click();
  return readFileSync((await (await pending).path()) as string, "utf8");
}
describe("mobile File shortcut integration", () => {
  it.each([320, 375])(
    "fits the existing file row at %ipx and reveals file tools without adding a row",
    async (width) => {
      await page.setViewportSize({ width, height: 700 });
      await start();
      const geometry = await page.evaluate(() => {
        const file = document.querySelector("#file-menu")?.getBoundingClientRect();
        const download = document.querySelector("#download")?.getBoundingClientRect();
        const pdf = document.querySelector("#pdf")?.getBoundingClientRect();
        return {
          width: document.documentElement.scrollWidth,
          fileTop: file?.top,
          downloadTop: download?.top,
          pdfTop: pdf?.top,
          height: file?.height,
          inputWidth: document.querySelector("#name")?.getBoundingClientRect().width,
        };
      });
      expect(geometry.width).toBe(width);
      expect(geometry.fileTop).toBe(geometry.downloadTop);
      expect(geometry.fileTop).toBe(geometry.pdfTop);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.inputWidth).toBeGreaterThanOrEqual(100);
      await openFiles();
      expect(await menu().getByRole("combobox").inputValue()).toBe("Files and recovery");
      expect(
        await menu()
          .getByRole("searchbox")
          .evaluate((element) => document.activeElement === element),
      ).toBe(true);
      for (const name of [
        "New screenplay",
        "Open Fountain file",
        "Recovery and snapshots",
        "Portable backup and restore",
        "Download Fountain",
        "Import Final Draft XML (FDX)",
      ])
        expect(await menu().getByRole("button", { name, exact: true }).isVisible()).toBe(true);
      expect(
        await menu().getByRole("button", { name: "Rename a character", exact: true }).count(),
      ).toBe(0);
      expect(await menu().evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.keyboard.press("Escape");
      expect(
        await page.locator("#file-menu").evaluate((element) => document.activeElement === element),
      ).toBe(true);
    },
  );
  it("resets category/search on normal Commands and keeps the focus-mode alternative usable", async () => {
    await start();
    await openFiles();
    await menu().getByRole("searchbox").fill("backup");
    await page.keyboard.press("Escape");
    await page.locator("#commands").click();
    expect(await menu().getByRole("combobox").inputValue()).toBe("");
    expect(await menu().getByRole("searchbox").inputValue()).toBe("");
    await page.keyboard.press("Escape");
    await page.locator("#mobile-focus").click();
    expect(await page.locator("#file-menu").isVisible()).toBe(false);
    await page.locator("#commands").click();
    await menu().getByRole("combobox").selectOption("Files and recovery");
    expect(await downloadFromMenu()).toBe("!Alpha beta");
    expect(await page.locator("#mobile-focus").getAttribute("aria-pressed")).toBe("true");
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.locator("#file-menu").isVisible()).toBe(false);
  });
  it("leaves IME Enter inert and uses keyboard results without altering exact source", async () => {
    const original = "\uFEFFINT. ROOM\r\n\r\n!Exact source.\r\n";
    await start(original);
    await openFiles();
    const search = menu().getByRole("searchbox");
    await search.fill("New screenplay");
    await search.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      bubbles: true,
    });
    expect(await menu().isVisible()).toBe(true);
    expect(await page.locator("#name").inputValue()).toBe("Files.fountain");
    await search.fill("download fountain");
    await page.keyboard.press("ArrowDown");
    expect(
      await menu()
        .getByRole("button", { name: "Download Fountain", exact: true })
        .evaluate((element) => document.activeElement === element),
    ).toBe(true);
    const pending = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    expect(readFileSync((await (await pending).path()) as string, "utf8")).toBe(original);
    expect(await menu().isVisible()).toBe(false);
  });
});
