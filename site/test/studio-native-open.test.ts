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

beforeEach(async () => {
  await context.addInitScript(() => {
    const state = {
      bytes: new TextEncoder().encode("\uFEFFINT. ROOM - DAY\r\n\r\nOriginal.\r\n"),
      opens: 0,
      saves: 0,
      writes: 0,
      cancel: false,
    };
    Reflect.set(window, "testDisk", state);
    const handle = {
      name: "Native.fountain",
      async getFile() {
        const snapshot = state.bytes.slice();
        return { size: snapshot.length, arrayBuffer: async () => snapshot.buffer };
      },
      async createWritable() {
        let staged = state.bytes;
        return {
          async write(bytes: Uint8Array) {
            staged = bytes.slice();
          },
          async close() {
            state.bytes = staged;
            state.writes++;
          },
          async abort() {},
        };
      },
    };
    Reflect.set(window, "showOpenFilePicker", async () => {
      state.opens++;
      if (state.cancel) throw new DOMException("cancelled", "AbortError");
      return [handle];
    });
    Reflect.set(window, "showSaveFilePicker", async () => {
      state.saves++;
      return handle;
    });
  });
});
describe("familiar native file shortcuts", () => {
  it("opens from the header and saves exact opened bytes to the same file; Save As requests a new target", async () => {
    await page.goto(`${origin}/studio/`);
    await ready();
    await page.locator("#file-menu").focus();
    await page.keyboard.press("Control+o");
    await page.waitForFunction(
      () => (document.querySelector("#name") as HTMLInputElement).value === "Native.fountain",
    );
    await ready();
    await page.locator("#view-menu").focus();
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => Reflect.get(window, "testDisk").writes === 1);
    expect(
      await page.evaluate(() => {
        const disk = Reflect.get(window, "testDisk");
        return {
          source: new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes),
          opens: disk.opens,
          saves: disk.saves,
        };
      }),
    ).toEqual({ source: "\uFEFFINT. ROOM - DAY\r\n\r\nOriginal.\r\n", opens: 1, saves: 0 });
    await page.keyboard.press("Control+Shift+s");
    await page.waitForFunction(() => Reflect.get(window, "testDisk").writes === 2);
    expect(await page.evaluate(() => Reflect.get(window, "testDisk").saves)).toBe(1);
  });
  it("retains the screenplay on picker cancellation and refuses an external overwrite", async () => {
    await page.goto(`${origin}/studio/`);
    await ready();
    await page.keyboard.press("Control+o");
    await page.waitForFunction(
      () => (document.querySelector("#name") as HTMLInputElement).value === "Native.fountain",
    );
    await ready();
    await page.evaluate(() => {
      const disk = Reflect.get(window, "testDisk");
      disk.cancel = true;
      disk.bytes = new TextEncoder().encode("External revision");
    });
    await page.keyboard.press("Control+o");
    await page.waitForFunction(() => Reflect.get(window, "testDisk").opens === 2);
    expect(await page.locator(".cm-content").innerText()).toContain("Original.");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() =>
      document.querySelector("#notice")?.textContent?.includes("changed outside Studio"),
    );
    expect(await page.evaluate(() => Reflect.get(window, "testDisk").writes)).toBe(0);
    expect(await page.locator(".cm-content").innerText()).toContain("Original.");
  });
});
