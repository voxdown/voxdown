import { readFile } from "node:fs/promises";
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
  page.setDefaultTimeout(5000);
});
afterEach(async () => context.close());
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
const ready = () =>
  page.waitForFunction(
    () =>
      !!document.querySelector(".cm-content") &&
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
describe("Studio formatting through the editor", () => {
  for (const [mark, delimiter] of [
    ["bold", "**"],
    ["italic", "*"],
    ["underline", "_"],
  ] as const) {
    it(`applies and undoes syntax-aware ${mark} through toolbar and shortcut`, async () => {
      const source = "@JOHN\n(quietly)\nSome [[private]] text\n\nLast line";
      await start(source);
      await page.locator(".cm-content").focus();
      await page.keyboard.press("Control+a");
      await page.locator(`[data-writing-mark="${mark}"]`).click();
      const download = page.waitForEvent("download");
      await page.locator("#file-menu").click();
      await page.locator("#download").click();
      const path = await (await download).path();
      expect(path).not.toBeNull();
      const formatted = await readFile(path as string, "utf8");
      expect(formatted).toBe(
        `@${delimiter}JOHN${delimiter}\n(${delimiter}quietly${delimiter})\n${delimiter}Some${delimiter} [[private]] ${delimiter}text${delimiter}\n\n${delimiter}Last line${delimiter}`,
      );
      await page.locator(".cm-content").focus();
      await page.keyboard.press("Control+a");
      await page.keyboard.press(`Control+${mark === "bold" ? "b" : mark === "italic" ? "i" : "u"}`);
      const reverted = page.waitForEvent("download");
      await page.locator("#file-menu").click();
      await page.locator("#download").click();
      expect(await readFile((await (await reverted).path()) as string, "utf8")).toBe(source);
    });
  }
});
