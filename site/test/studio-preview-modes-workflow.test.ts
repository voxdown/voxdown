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
async function preview(pages = 6) {
  const source = Array.from(
    { length: pages },
    (_, i) => `INT. ROOM ${i + 1} - DAY\n\nPage ${i + 1} content.`,
  ).join("\n\n===\n\n");
  await start(source);
  await page.locator("#preview-toggle").click();
  await page.waitForFunction(
    (n) => document.querySelector("#page-label")?.textContent === `Page 1 · 1 of ${n}`,
    pages,
  );
}
const label = () => page.locator("#page-label").innerText();
async function wheel(delta: number) {
  await page.locator("#page-scroll").hover();
  await page.mouse.wheel(0, delta);
}
describe("Studio page preview reading modes", () => {
  it("stays put at full-size document boundaries and identifies the last page in a tall narrow panel", async () => {
    await preview(8);
    await page.locator("#zoom").click();
    await wheel(-80);
    expect(await page.locator("#page-scroll").evaluate((el) => el.scrollTop)).toBe(0);
    await page.locator("#page-scroll").focus();
    await page.keyboard.press("End");
    await page.locator("#page-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    // Zoom changes reset the wheel gesture, so test a fresh gesture at the endpoint.
    await page.waitForTimeout(220);
    const bottom = await page.locator("#page-scroll").evaluate((el) => el.scrollTop);
    await wheel(80);
    expect(await page.locator("#page-scroll").evaluate((el) => el.scrollTop)).toBe(bottom);
    await page.locator("#zoom").click();
    await page.locator("#preview-mode").selectOption("continuous");
    await page.locator("#page-scroll").evaluate((el) => {
      Object.assign((el as HTMLElement).style, { width: "230px", height: "800px", flex: "none" });
    });
    await page.waitForFunction(() => document.querySelector("#page-scroll")?.clientHeight === 800);
    await page.locator("#page-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForFunction(() =>
      document.querySelector("#page-label")?.textContent?.startsWith("Page 1"),
    );
    await page.locator("#page-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForFunction(
      () => document.querySelector("#page-label")?.textContent === "Page 8 · 8 of 8",
    );
    // An explicit previous-page choice must survive clamping at the scroll endpoint.
    await page.locator("#previous").click();
    expect(await label()).toBe("Page 7 · 7 of 8");
    await page.locator("#preview-mode").selectOption("single");
    expect(await label()).toBe("Page 7 · 7 of 8");
  });

  it("fits one whole page, turns once per wheel gesture, and supports keyboard navigation", async () => {
    await preview();
    await page.waitForFunction(() => {
      const el = document.querySelector("#page-scroll");
      return el && el.scrollHeight <= el.clientHeight + 1;
    });
    await wheel(100);
    await page.waitForFunction(() =>
      document.querySelector("#page-label")?.textContent?.startsWith("Page 2"),
    );
    await page.mouse.wheel(0, 80);
    await page.mouse.wheel(0, 40);
    expect(await label()).toBe("Page 2 · 2 of 6");
    await page.locator("#page-scroll").focus();
    await page.keyboard.press("End");
    expect(await label()).toBe("Page 6 · 6 of 6");
    expect(await page.locator("#next").isDisabled()).toBe(true);
    await page.keyboard.press("PageUp");
    expect(await label()).toBe("Page 5 · 5 of 6");
    await page.keyboard.press("Home");
    expect(await label()).toBe("Page 1 · 1 of 6");
    await page.locator("#zoom").click();
    await wheel(80);
    await page.waitForFunction(() => (document.querySelector("#page-scroll")?.scrollTop ?? 0) > 0);
    expect(await label()).toBe("Page 1 · 1 of 6");
  });
  it("scrolls a long screenplay with bounded sheets, keeps source navigation in sync, and remembers the mode", async () => {
    await preview(80);
    await page.locator("#preview-mode").selectOption("continuous");
    await page.locator("#page-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForFunction(() =>
      document.querySelector("#page-label")?.textContent?.startsWith("Page 80"),
    );
    expect(await page.locator(".preview-sheet").count()).toBeLessThan(6);
    expect(await page.locator("#page").innerText()).toContain("Page 80 content.");
    await page.locator("#preview-menu").click();
    await page.locator("#page-source").click();
    await page.waitForFunction(() =>
      document.querySelector("#position")?.textContent?.includes("475"),
    );
    await page.locator("#preview-mode").selectOption("single");
    expect(await label()).toBe("Page 80 · 80 of 80");
    expect(await page.locator(".preview-sheet").count()).toBe(1);
    await page.locator("#preview-mode").selectOption("continuous");
    await page.reload();
    await ready();
    expect(await page.locator("#preview-mode").inputValue()).toBe("continuous");
  });
  it("keeps the chosen page when resizing and switching modes, and resets for a newly opened screenplay", async () => {
    await preview();
    await page.locator("#next").click();
    await page.locator("#next").click();
    await page.locator("#preview-mode").selectOption("continuous");
    expect(await label()).toBe("Page 3 · 3 of 6");
    await page.locator("#expand-preview").click();
    await page.setViewportSize({ width: 1100, height: 760 });
    await expect.poll(label).toBe("Page 3 · 3 of 6");
    await page.locator("#preview-mode").selectOption("single");
    expect(await page.locator("#page").innerText()).toContain("Page 3 content.");
    await page.locator("#preview-mode").selectOption("continuous");
    await page.locator("#file").setInputFiles({
      name: "New.fountain",
      mimeType: "text/plain",
      buffer: Buffer.from("INT. NEW ROOM - DAY\n\nA new script."),
    });
    await expect.poll(label).toBe("Page 1 · 1 of 1");
    expect(await page.locator("#page").innerText()).toContain("A new script.");
  });
});
