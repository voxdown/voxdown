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
  await page.keyboard.press("Control+k");
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
  it("recovers a row of writing space with an explicit exit and accessible formatting/help", async () => {
    await start();
    const normal = await geometry();
    await command("Focus writing");
    const focused = await geometry();
    expect(normal.top - focused.top).toBeGreaterThanOrEqual(44);
    expect(focused.top).toBeLessThanOrEqual(110);
    expect(focused.height).toBeGreaterThanOrEqual(normal.height + 44);
    expect(focused.width).toBe(320);
    expect(await page.locator(".filebar").isVisible()).toBe(false);
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    for (const name of ["File", "Edit", "View", "Tools", "Help", "Exit focus writing"]) {
      const button = page.getByRole("button", { name, exact: true });
      expect(await button.isVisible()).toBe(true);
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator("#recovery").isVisible()).toBe(true);
    expect(await page.locator("#help").isVisible()).toBe(false);
    await page.keyboard.press("Control+k");
    await page.getByRole("searchbox", { name: "Find a command" }).fill("Underline");
    expect(
      await page
        .getByRole("dialog", { name: "Commands", exact: true })
        .getByRole("button", { name: "Underline", exact: true })
        .isEnabled(),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await command("Explain the current Fountain line");
    expect(await page.locator("dialog[open]").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
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
    await page.locator("#view-menu").click();
    await page
      .locator("#view-dropdown")
      .getByRole("button", { name: "Focus writing", exact: true })
      .click();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("Alpha");
    expect(
      await page.locator(".cm-content").evaluate((element) => document.activeElement === element),
    ).toBe(true);
    await page.keyboard.press("Control+b");
    expect(await downloadSource()).toBe("!**Alpha** beta");
    await page.locator("#mobile-focus").click();
    await command("Focus writing");
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
    expect(await page.locator("#mobile-focus").isVisible()).toBe(true);
    expect(await page.locator("#help-menu").isVisible()).toBe(true);
    await page.locator("#help-menu").click();
    expect(await page.locator("#help").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.locator(".filebar").isVisible()).toBe(true);
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    expect(await page.locator("#focus-mode").getAttribute("aria-pressed")).toBe("true");
    await page.locator("#mobile-focus").click();
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.locator("#mobile-focus").getAttribute("aria-pressed")).toBe("false");
    expect(await page.locator(".filebar").isVisible()).toBe(true);
    expect(
      JSON.parse((await page.evaluate(() => localStorage.getItem("studio-preferences"))) as string)
        .focus,
    ).toBe(false);
  });
  it("fits short viewports with a usable editor and an operable exit", async () => {
    await start();
    await command("Focus writing");
    await page.setViewportSize({ width: 320, height: 280 });
    const current = await geometry();
    expect(current.width).toBe(320);
    expect(current.top).toBeLessThanOrEqual(100);
    expect(current.height).toBeGreaterThanOrEqual(140);
    expect(current.overflow).toBe("hidden");
    expect(await page.evaluate(() => document.body.scrollHeight)).toBe(280);
    const exit = await page
      .getByRole("button", { name: "Exit focus writing", exact: true })
      .boundingBox();
    expect(exit?.height).toBeGreaterThanOrEqual(44);
    expect((exit?.y ?? 280) + (exit?.height ?? 0)).toBeLessThan(280);
    await page.getByRole("button", { name: "Exit focus writing", exact: true }).click();
    expect(await page.locator(".filebar").isVisible()).toBe(false);
    expect(await page.locator("#view-menu").isVisible()).toBe(true);
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.locator(".filebar").isVisible()).toBe(true);
    expect(await downloadSource()).toBe("!Alpha beta");
  });
  it.each([
    { width: 667, height: 375, minimumEditor: 200 },
    { width: 375, height: 300, minimumEditor: 125 },
  ])(
    "keeps menus, selection and writing available at $width×$height",
    async ({ width, height, minimumEditor }) => {
      const source = "!Alpha beta";
      await start(source);
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("ArrowRight");
      for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("Alpha");
      expect(
        await page.locator(".cm-content").evaluate((element) => document.activeElement === element),
      ).toBe(true);
      const current = await geometry();
      expect(current.width).toBe(width);
      expect(current.top).toBeLessThanOrEqual(145);
      expect(current.height).toBeGreaterThanOrEqual(minimumEditor);
      expect(await page.evaluate(() => document.body.scrollHeight)).toBe(height);
      expect(await page.locator("#name").isVisible()).toBe(false);
      expect(await page.locator("#name").inputValue()).toBe("Focus.fountain");
      expect(await page.locator("#element-action").isVisible()).toBe(true);
      expect(
        await page
          .locator("#app")
          .evaluate((element) => element.classList.contains("focus-writing")),
      ).toBe(false);
      for (const id of ["file-menu", "view-menu", "tools-menu", "help-menu", "commands"]) {
        const button = page.locator(`#${id}`);
        expect(await button.isVisible()).toBe(true);
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator("#view-menu").click();
      await page.getByRole("button", { name: "Preview panel", exact: true }).click();
      expect(await page.locator("#preview").isVisible()).toBe(true);
      await page.keyboard.press("Escape");
      expect(await page.locator(".cm-content").isVisible()).toBe(true);
      expect(await downloadSource()).toBe(source);
    },
  );
  it("keeps malformed-source diagnostics visible and the exact source downloadable", async () => {
    const source = "INT. ROOM\n\n[[Unclosed private note";
    await start(source);
    await command("Focus writing");
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
    await command("Focus writing");
    expect(await page.locator("#retry-preview").isVisible()).toBe(true);
    expect(await page.locator("#notice").isVisible()).toBe(true);
    expect(await page.locator("#notice").textContent()).toContain("worker");
    expect(await page.locator("#element-action").isVisible()).toBe(false);
    expect(await page.locator("#recovery").isVisible()).toBe(true);
    await page.locator("#retry-preview").click();
    expect(await page.locator("#mobile-focus").isVisible()).toBe(true);
  });
});
