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
    Reflect.set(window, "showOpenFilePicker", undefined);
  });
  await page.goto(`${origin}/studio/`);
  await page.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
  await page.locator("#file").setInputFiles({
    name: "Keys.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from("INT. ROOM - DAY\n\nA clock ticks."),
  });
  await page.waitForFunction(() => document.querySelector("#scene-count")?.textContent === "1");
});
afterEach(async () => context.close());
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
async function menu(root: string, label: string) {
  await page.locator(`#${root}-menu`).click();
  await page.locator(`#${root}-dropdown`).getByRole("button", { name: label, exact: true }).click();
}
const focused = () =>
  page.locator("#app").evaluate((node) => node.classList.contains("focus-writing"));
const reachableFocus = () =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement;
    return (
      active !== document.body &&
      Boolean(active.getClientRects().length) &&
      !active.closest("[hidden], [inert], [aria-hidden=true]")
    );
  });

describe("familiar workspace keyboard actions", () => {
  it("preserves the toolbar choice and gives nested search/help Escape priority over Focus", async () => {
    await menu("view", "Toolbar");
    await page.keyboard.press("Control+Shift+f");
    expect(await focused()).toBe(true);
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    await page.keyboard.press("Control+f");
    expect(await page.locator(".cm-search").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await focused()).toBe(true);
    await page.keyboard.press("Control+/");
    expect(await page.locator("#studio-shortcuts").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await focused()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await focused()).toBe(false);
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    await menu("view", "Toolbar");
    await page.keyboard.press("Control+Shift+f");
    expect(await page.locator(".toolbar").isVisible()).toBe(false);
    await page.keyboard.press("Escape");
    expect(await page.locator(".toolbar").isVisible()).toBe(true);
  });

  it("shares Find and Help across the editor, menus and panels without hijacking a dialog", async () => {
    for (const selector of [".cm-content", "#file-menu", "#scene-search"]) {
      await page.locator(selector).focus();
      await page.keyboard.press("Control+f");
      expect(await page.locator(".cm-search").isVisible()).toBe(true);
      await page.keyboard.press("Escape");
      await page.locator(selector).focus();
      await page.keyboard.press("Control+/");
      expect(await page.locator("#studio-shortcuts").isVisible()).toBe(true);
      await page.keyboard.press("Escape");
      expect(await page.locator(selector).evaluate((node) => node === document.activeElement)).toBe(
        true,
      );
    }
    await menu("edit", "Find…");
    expect(await page.locator(".cm-search").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await menu("view", "Preferences…");
    await page.keyboard.press("Control+Shift+f");
    await page.keyboard.press("Control+/");
    expect(await focused()).toBe(false);
    expect(await page.locator("dialog[open]").count()).toBe(1);
    expect(await page.locator("#preferences-dialog").isVisible()).toBe(true);
  });

  it("opens from the header and downloads exact source with Save and Save as outside the editor", async () => {
    await page.locator("#file-menu").focus();
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    await (await choosing).setFiles({
      name: "Opened.fountain",
      mimeType: "text/plain",
      buffer: Buffer.from("!An exact copy.\r\n"),
    });
    await page.waitForFunction(
      () => (document.querySelector("#name") as HTMLInputElement).value === "Opened.fountain",
    );
    for (const shortcut of ["Control+s", "Control+Shift+s"]) {
      await page.locator("#file-menu").focus();
      const downloading = page.waitForEvent("download");
      await page.keyboard.press(shortcut);
      expect(readFileSync((await (await downloading).path()) as string, "utf8")).toBe(
        "!An exact copy.\r\n",
      );
    }
  });

  it("keeps menu edge Tab and F6 reachable with a hidden toolbar, and F10 enters arrow navigation", async () => {
    await menu("view", "Toolbar");
    await page.locator("#help-menu").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    expect(await reachableFocus()).toBe(true);
    await page.locator(".cm-content").focus();
    await page.keyboard.press("F10");
    expect(
      await page.locator("#file-menu").evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    expect(await page.locator("#edit-dropdown").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+Shift+Backslash");
    expect(await page.locator("#outline").isVisible()).toBe(false);
    await page.keyboard.press("Control+Shift+o");
    expect(await page.locator("#outline").isVisible()).toBe(true);
    expect(
      await page.locator("#scene-search").evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await page.locator(".cm-content").focus();
    for (const key of ["F6", "F6", "F6", "Shift+F6", "Shift+F6", "Shift+F6"]) {
      await page.keyboard.press(key);
      expect(await reachableFocus()).toBe(true);
    }
    await page.keyboard.press("Control+Shift+p");
    expect(await page.getByRole("dialog", { name: "Commands", exact: true }).isVisible()).toBe(
      true,
    );
  });
});
