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
    .setInputFiles({ name: "Focus.fountain", mimeType: "text/plain", buffer: Buffer.from(source) });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement)?.value === "Focus.fountain",
  );
  await ready();
}
async function command(name: string) {
  await page.locator("#commands").click();
  await page
    .getByRole("dialog", { name: "Commands", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function downloadSource() {
  const pending = page.waitForEvent("download");
  await command("Download Fountain");
  return readFileSync((await (await pending).path()) as string, "utf8");
}
const geometry = () =>
  page.evaluate(() => ({
    top: document.querySelector("#editor")?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    height: document.querySelector("#editor")?.getBoundingClientRect().height ?? 0,
    width: document.documentElement.scrollWidth,
    overflow: getComputedStyle(document.body).overflowY,
  }));
describe("explicit mobile focus writing", () => {
  it("recovers substantial writing space with a visible exit and all formatting/recovery controls", async () => {
    await start();
    const normal = await geometry();
    await page.getByRole("button", { name: "Focus writing", exact: true }).click();
    const focused = await geometry();
    expect(normal.top - focused.top).toBeGreaterThanOrEqual(140);
    expect(focused.top).toBeLessThanOrEqual(110);
    expect(focused.height).toBeGreaterThan(normal.height + 140);
    expect(focused.width).toBe(320);
    expect(await page.locator(".filebar").isVisible()).toBe(false);
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    for (const name of [
      "Commands",
      "Exit focus writing",
      "Bold",
      "Italic",
      "Underline",
      "Line help",
      "Note",
    ]) {
      const button = page.getByRole("button", { name, exact: true });
      expect(await button.isVisible()).toBe(true);
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator("#recovery").isVisible()).toBe(true);
    expect(await page.locator("#help").isVisible()).toBe(false);
    await command("Fountain guide");
    expect(await page.locator("#guide").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Exit focus writing", exact: true }).click();
    expect(await page.locator(".filebar").isVisible()).toBe(true);
    expect((await geometry()).top).toBe(normal.top);
  });
  it("preserves selection and source, returns focus to writing, and adds no undo step", async () => {
    const source = "!Alpha beta";
    await start(source);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("Alpha");
    await page.locator("#mobile-focus").click();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("Alpha");
    expect(
      await page.locator(".cm-content").evaluate((element) => document.activeElement === element),
    ).toBe(true);
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    expect(await downloadSource()).toBe("!**Alpha** beta");
    await page.locator("#mobile-focus").click();
    await page.locator("#mobile-focus").click();
    await page.keyboard.press("Control+z");
    expect(await downloadSource()).toBe(source);
  });
  it("shares persisted focus with Commands and restores desktop controls across width changes", async () => {
    await start();
    await command("Focus writing");
    expect(await page.locator("#mobile-focus").getAttribute("aria-pressed")).toBe("true");
    await page.reload();
    await ready();
    expect(await page.locator("#mobile-focus").getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator(".filebar").isVisible()).toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.locator("#mobile-focus").isVisible()).toBe(false);
    expect(await page.locator("#help").isVisible()).toBe(true);
    expect(await page.locator(".filebar").isVisible()).toBe(true);
    expect(await page.locator(".toolbar").isVisible()).toBe(true);
    expect(await page.locator("#focus-mode").getAttribute("aria-pressed")).toBe("true");
    await page.locator("#focus-mode").click();
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.locator("#mobile-focus").getAttribute("aria-pressed")).toBe("false");
    expect(await page.locator(".filebar").isVisible()).toBe(true);
    expect(
      JSON.parse((await page.evaluate(() => localStorage.getItem("studio-preferences"))) as string)
        .focus,
    ).toBe(false);
  });
  it("keeps short viewports scrollable with a usable editor and an operable exit", async () => {
    await start();
    await page.locator("#mobile-focus").click();
    await page.setViewportSize({ width: 320, height: 280 });
    const current = await geometry();
    expect(current.width).toBe(320);
    expect(current.height).toBeGreaterThanOrEqual(200);
    expect(current.overflow).toBe("auto");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Exit focus writing", exact: true }).click();
    expect(await page.locator(".filebar").isVisible()).toBe(true);
  });
  it("keeps malformed-source diagnostics visible and the exact source downloadable", async () => {
    const source = "INT. ROOM\n\n[[Unclosed private note";
    await start(source);
    await page.locator("#mobile-focus").click();
    expect(await page.locator("#issues").isVisible()).toBe(true);
    expect(await page.locator("#issues").textContent()).toMatch(/unclosed|unfinished|close/i);
    expect(await page.locator("#pdf").isDisabled()).toBe(true);
    expect(await downloadSource()).toBe(source);
    expect(
      await page.getByRole("button", { name: "Exit focus writing", exact: true }).isVisible(),
    ).toBe(true);
  });
  it("retains actual diagnostics and preview retry controls in focus mode", async () => {
    await context.addInitScript(() => {
      const original = window.Worker;
      window.Worker = class extends original {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (String(url).includes("/worker.ts")) throw Error("Preview worker unavailable");
          super(url, options);
        }
      };
    });
    await page.goto(`${origin}/studio/`);
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
    await page.locator("#retry-preview").waitFor();
    await page.locator("#mobile-focus").click();
    expect(await page.locator("#retry-preview").isVisible()).toBe(true);
    expect(await page.locator("#notice").isVisible()).toBe(true);
    expect(await page.locator("#notice").textContent()).toContain("worker");
    expect(await page.locator("#element-action").isVisible()).toBe(false);
    expect(await page.locator("#recovery").isVisible()).toBe(true);
    await page.locator("#retry-preview").click();
    expect(await page.locator("#mobile-focus").isVisible()).toBe(true);
  });
});
