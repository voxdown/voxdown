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
describe("quiet printed page indicators", () => {
  it("keeps page rules in a separate right margin without moving the manuscript during refresh", async () => {
    await page.addInitScript(() => {
      localStorage.setItem("studio-preferences", JSON.stringify({ pageGuides: true }));
    });
    await start("INT. ROOM - DAY #15#\n\nAction.\n\n===\n\nEXT. PARK - NIGHT #16#\n\nRain.");
    const visibleMarkers = page.locator(".studio-page-guides .studio-page-guide:visible");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.studio-page-guide[title*="Printed page starts: 2."]').length >
        0,
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const content = document.querySelector(".cm-content")?.getBoundingClientRect();
        const gutter = document.querySelector(".studio-page-guides")?.getBoundingClientRect();
        const marker = document.querySelector<HTMLElement>(
          '.studio-page-guide[title*="Printed page starts: 2."]',
        );
        if (!content || !gutter || !marker) throw new Error("Missing page guide elements");
        const scenes = [...document.querySelectorAll(".scene-number-right")].map(
          (node) => node.getBoundingClientRect().right,
        );
        return {
          contentRight: content.right,
          gutterLeft: gutter.left,
          gutterRight: gutter.right,
          scenes,
          rule: getComputedStyle(marker).borderTopWidth,
          padding: Number.parseFloat(getComputedStyle(marker).paddingTop),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.gutterLeft).toBeGreaterThanOrEqual(geometry.contentRight - 1);
      expect(geometry.scenes.every((right) => right <= geometry.gutterLeft)).toBe(true);
      expect(geometry.gutterRight).toBeLessThanOrEqual(width);
      expect(geometry.rule).toBe("1px");
      expect(geometry.padding).toBeGreaterThan(0);
      expect(geometry.overflow).toBe(false);
    }
    expect(await visibleMarkers.allTextContents()).toEqual(["1", "2"]);
    const before = await page.locator(".cm-content").boundingBox();
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" More rain.");
    const during = await page.locator(".cm-content").boundingBox();
    await ready();
    const after = await page.locator(".cm-content").boundingBox();
    expect(during?.x).toBe(before?.x);
    expect(during?.width).toBe(before?.width);
    expect(after?.width).toBe(before?.width);
    await page.screenshot({ path: "/tmp/voxdown-studio-page-indicators.png" });
  });
});
