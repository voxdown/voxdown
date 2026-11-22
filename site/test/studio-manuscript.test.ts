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
const lighthouse = readFileSync(
  new URL("../../examples/the-lighthouse.fountain", import.meta.url),
  "utf8",
);
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
async function ready() {
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLElement>("#app")?.inert &&
      !document.querySelector("#counts")?.textContent?.includes("Updating"),
  );
}
async function start(source = lighthouse) {
  await page.goto(`${origin}/studio/`);
  await ready();
  await page.locator("#file").setInputFiles({
    name: "Manuscript.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement).value === "Manuscript.fountain",
  );
  await ready();
  await page.evaluate(() => document.fonts.ready);
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
describe("Studio editable manuscript", () => {
  it("keeps a bounded paper surface and screenplay indents across responsive sizes", async () => {
    await start();
    for (const [width, height] of [
      [1440, 900],
      [1280, 900],
      [768, 900],
      [390, 844],
      [320, 700],
      [667, 375],
    ] as const) {
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => {
        const paper = document.querySelector<HTMLElement>("#editor");
        if (!paper) throw new Error("Editable manuscript is missing");
        const box = paper.getBoundingClientRect();
        const left = (selector: string) => {
          const line = paper.querySelector(selector);
          if (!line) throw new Error(`Screenplay element ${selector} is missing`);
          return Number.parseFloat(getComputedStyle(line).paddingLeft);
        };
        return {
          x: box.x,
          right: box.right,
          width: box.width,
          bottom: box.bottom,
          height: box.height,
          overflow: document.documentElement.scrollWidth > innerWidth,
          scene: left(".f-scene"),
          character: left(".f-character"),
          dialogue: left(".f-dialogue"),
          parenthetical: left(".f-parenthetical"),
        };
      });
      expect(layout.overflow).toBe(false);
      expect(layout.width).toBeLessThanOrEqual(816);
      expect(layout.x).toBeGreaterThanOrEqual(8);
      expect(layout.right).toBeLessThanOrEqual(width - 8);
      expect(layout.bottom).toBeLessThanOrEqual(height);
      expect(layout.height).toBeGreaterThan(100);
      expect(layout.character).toBeGreaterThan(layout.parenthetical);
      expect(layout.parenthetical).toBeGreaterThan(layout.dialogue);
      expect(layout.dialogue).toBeGreaterThan(layout.scene);
    }
    expect(await downloadSource()).toBe(lighthouse);
  });
  it("keeps virtual scrolling, selection, page guides and undo attached to the original source", async () => {
    const source = `${lighthouse}\n\n${Array.from({ length: 100 }, (_, i) => `INT. ROOM ${i} - DAY\n\nA long day passes.\n\nMARA\nWe keep writing.\n`).join("\n")}\n!Last line`;
    await start(source);
    await command("Preferences");
    await page.locator("#page-guides").check();
    await page.locator("#typewriter").check();
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.waitForFunction(
      () => (document.querySelector(".cm-scroller")?.scrollTop ?? 0) > 1000,
    );
    await page.keyboard.type("!");
    await ready();
    expect(await page.locator(".cm-content").innerText()).toContain("!Last line!");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("!Last line");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("!Last line");
    expect(
      await page.locator(".cm-content").evaluate((node) => document.activeElement === node),
    ).toBe(true);
    expect(await downloadSource()).toBe(source);
  });
});
