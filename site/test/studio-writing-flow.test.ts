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
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  await context.addInitScript(() => {
    Reflect.set(window, "showSaveFilePicker", undefined);
    localStorage.setItem("studio-preferences", JSON.stringify({ screenplayKeys: true }));
  });
  await page.goto(`${origin}/studio/`);
  await page.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
});
afterEach(async () => context.close());
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
async function load(source: string) {
  await page.locator("#file").setInputFiles({
    name: "Flow.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement).value === "Flow.fountain",
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
}
async function source() {
  const downloading = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  return readFileSync((await (await downloading).path()) as string, "utf8");
}

describe("screenplay writing with a physical keyboard", () => {
  it("moves through action, natural cues, paired parenthetical and two dialogue blocks", async () => {
    await load("INT. KITCHEN - DAY");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Mara lifts the kettle.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("MARA");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("quietly");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Tea?");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("I made plenty.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("JO");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Please.");
    expect(await source()).toBe(
      "INT. KITCHEN - DAY\n\nMara lifts the kettle.\n\nMARA\n(quietly)\nTea?\nI made plenty.\n\nJO\nPlease.",
    );
    expect(
      await page.locator(".cm-content").evaluate((node) => node === document.activeElement),
    ).toBe(true);
  });

  it("accepts a suggested character with Tab and undoes just that completion", async () => {
    const original = "INT. KITCHEN - DAY\n\n@Mara\nHello.\n\n";
    await load(original);
    await page.waitForFunction(
      () => !document.querySelector("#counts")?.textContent?.includes("Updating"),
    );
    await page.keyboard.type("@Ma");
    await page.locator(".cm-tooltip-autocomplete").waitFor({ state: "visible" });
    // CodeMirror deliberately ignores completion keys during its 75ms opening guard.
    await page.waitForTimeout(100);
    await page.keyboard.press("Tab");
    expect(await source()).toBe(`${original}@Mara`);
    expect(
      await page.locator(".cm-content").evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("Control+z");
    expect(await source()).toBe(`${original}@Ma`);
  });

  it("keeps ordinary Enter when screenplay shortcuts are disabled", async () => {
    await load("Mara lifts the kettle.");
    await page.locator("#view-menu").click();
    await page
      .locator("#view-dropdown")
      .getByRole("button", { name: "Preferences…", exact: true })
      .click();
    await page.locator("#screenplay-keys").uncheck();
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    expect(await source()).toBe("Mara lifts the kettle.\n");
  });
});
