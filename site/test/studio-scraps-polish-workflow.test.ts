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
async function openScraps() {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("button", { name: "Scraps", exact: true }).click();
}
async function action(name: string, index = 0) {
  await page.getByRole("button", { name: "Scrap actions", exact: true }).nth(index).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function add(text: string) {
  await page.getByRole("textbox", { name: "New scrap", exact: true }).fill(text);
  await page.getByRole("button", { name: "Add scrap", exact: true }).click();
}
describe("polished Studio scraps", () => {
  it("moves a selection safely, returns it after edits and reload, and never duplicates an intact passage", async () => {
    const before = `INT. ROOM - DAY\n\n${"An earlier scene. ".repeat(20)}\n\n`;
    const after = `\n\n${"Rain at the window. ".repeat(20)}`;
    await start(`${before}The lost ending.${after}`);
    const line = page.locator(".cm-line").filter({ hasText: /^The lost ending\.$/ });
    await line.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await openScraps();
    await page.getByRole("button", { name: "Move selection", exact: true }).click();
    expect(await page.locator(".cm-content").innerText()).not.toContain("The lost ending.");
    expect(await page.locator(".studio-scrap-text").innerText()).toContain("The lost ending.");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.insertText("New opening.\n\n");
    await page.waitForFunction(() =>
      document.querySelector("#recovery")?.textContent?.includes("kept"),
    );
    await page.reload();
    await ready();
    await openScraps();
    await action("Return to text");
    expect(await page.locator(".cm-content").innerText()).toContain("The lost ending.");
    await action("Return to text");
    expect(
      (await page.locator(".cm-content").innerText()).match(/The lost ending\./g),
    ).toHaveLength(1);
    expect(await page.locator(".studio-scraps-status").textContent()).toContain(
      "without inserting a duplicate",
    );
    await page.keyboard.press("Control+z");
    expect(await page.locator(".cm-content").innerText()).not.toContain("The lost ending.");
    expect(await page.locator(".studio-scrap").count()).toBe(1);
  });
  it("saves before cutting, refuses uncertain returns, and reports successful locked-scene moves", async () => {
    await start(
      'INT. EXTERNAL - DAY #17#\n\nRain.\n\n/* VoxDown production v1\n{"reserved":["15"]}\n*/',
    );
    await page.locator(".syntax-scene").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await openScraps();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("vxd-studio-scraps:")) {
          Storage.prototype.setItem = original;
          throw new DOMException("Full", "QuotaExceededError");
        }
        original.call(this, key, value);
      };
    });
    await page.getByRole("button", { name: "Move selection", exact: true }).click();
    expect(await page.locator(".cm-content").innerText()).toContain("INT. EXTERNAL");
    expect(await page.locator(".studio-scrap").count()).toBe(0);
    await page.getByRole("button", { name: "Move selection", exact: true }).click();
    expect(await page.locator(".cm-content").innerText()).not.toContain("INT. EXTERNAL");
    expect(await page.locator(".studio-scraps-status").innerText()).toContain("Selection moved");
    expect(await page.locator(".cm-content").innerText()).toContain('"17"');
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.insertText("Changed context.");
    await action("Return to text");
    expect(await page.locator(".studio-scraps-status").innerText()).toContain("ambiguous");
    expect(await page.locator(".cm-content").innerText()).not.toContain("INT. EXTERNAL");
  });
  it("keeps readable Fountain previews, private notes and safe literal HTML, with keyboard and mobile access", async () => {
    await start("INT. ROOM - DAY\n\nRain.");
    await openScraps();
    await add(
      "INT. ARCHIVE - NIGHT\n\nNORA\n(quietly)\n**I remember** *writing* _it_.\n\n[[Try a quieter ending.]]\n\n<img src=x onerror=alert(1)>",
    );
    const card = page.locator(".studio-scrap-text");
    await card.hover();
    await page.getByRole("region", { name: "Scrap preview", exact: true }).waitFor();
    const popup = page.locator(".studio-scrap-popover");
    expect(await popup.locator("img").count()).toBe(0);
    expect(await popup.locator('[style*="font-weight: 700"]').innerText()).toBe("I remember");
    expect(await popup.locator('[style*="font-style: italic"]').innerText()).toBe("writing");
    expect(await popup.locator(".scrap-comment").innerText()).toContain("Try a quieter ending.");
    const popupBox = await popup.boundingBox();
    await page.mouse.move((popupBox?.x ?? 0) + 20, (popupBox?.y ?? 0) + 30);
    expect(await popup.isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await popup.isVisible()).toBe(false);
    await page.getByRole("button", { name: "Scrap actions", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    expect(
      await page
        .getByRole("menuitem", { name: "Delete", exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(
      await page
        .getByRole("button", { name: "Scrap actions", exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await card.click();
    await page.screenshot({ path: "/tmp/voxdown-studio-scraps-desktop.png" });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await openScraps();
    await card.click();
    expect(await popup.isVisible()).toBe(true);
    const box = await popup.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Scrap actions", exact: true }).click();
    const targets = await page
      .getByRole("menuitem")
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect(targets.every((height) => height >= 44)).toBe(true);
    await page.keyboard.press("Escape");
    await card.click();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "/tmp/voxdown-studio-scraps-phone.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
  it("pins, reorders, copies, edits and restores scraps without losing source syntax", async () => {
    await start();
    await openScraps();
    await add("First **passage**");
    await add("Second passage");
    await add("Third passage");
    await action("Pin to top", 2);
    expect(await page.locator(".studio-scrap-text").first().innerText()).toContain("First passage");
    await action("Move to bottom", 1);
    expect(await page.locator(".studio-scrap-text").allInnerTexts()).toEqual([
      "First passage",
      "Second passage",
      "Third passage",
    ]);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.body.dataset.copiedScrap = text;
          },
        },
      }),
    );
    await action("Copy");
    expect(await page.locator("body").getAttribute("data-copied-scrap")).toBe("First **passage**");
    await action("Edit");
    await page
      .getByRole("textbox", { name: "Edit scrap text", exact: true })
      .fill("First **revised passage**");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await action("Delete");
    await page.getByRole("button", { name: "Bring back: First" }).click();
    expect(await page.locator(".studio-scrap-text").first().innerText()).toContain(
      "First revised passage",
    );
    await page.reload();
    await ready();
    await openScraps();
    expect(await page.locator(".studio-scrap-label").first().innerText()).toBe("Pinned scrap");
    expect(await page.locator(".studio-scrap-text").allInnerTexts()).toEqual([
      "First revised passage",
      "Second passage",
      "Third passage",
    ]);
  });
});
