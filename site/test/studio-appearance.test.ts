import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { type ViteDevServer, createServer } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeStudioTheme } from "../src/studio/appearance";
import { parsePreferences } from "../src/studio/preferences";

let server: ViteDevServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
const source =
  "INT. ROOM - DAY\n\n[[Private rehearsal note]]\n\nMARA\n(quietly)\nA line to keep.\n";
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
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  });
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
async function start() {
  await page.goto(`${origin}/studio/`);
  await ready();
  await page.locator("#file").setInputFiles({
    name: "Appearance.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement).value === "Appearance.fountain",
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
async function choose(label: string) {
  await page.locator("#appearance").click();
  const dialog = page.getByRole("dialog", { name: "Appearance", exact: true });
  await dialog
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: label, exact: true }) })
    .click();
  expect(await dialog.getByRole("radio", { name: label, exact: true }).isChecked()).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page.locator("#appearance").evaluate((node) => node === document.activeElement),
  ).toBe(true);
}
const paper = () =>
  page.locator("#editor").evaluate((node) => getComputedStyle(node).backgroundColor);
function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unexpected color ${color}`);
    const linear = channels.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
describe("Studio appearance", () => {
  it("migrates legacy preferences and rejects unknown values without losing other choices", () => {
    for (const [legacy, canonical] of [
      ["system", "auto"],
      ["light", "paper"],
      ["dark", "night"],
      ["sepia", "sepia"],
      ["slate", "slate"],
      ["contrast", "contrast"],
    ]) {
      const saved = parsePreferences({
        theme: legacy,
        textSize: 20,
        focus: true,
        pageGuides: true,
      });
      expect(saved.theme).toBe(canonical);
      expect(saved.textSize).toBe(20);
      expect(saved.focus).toBe(true);
      expect(saved.pageGuides).toBe(true);
    }
    for (const malformed of [null, undefined, {}, [], "unknown", "__proto__", 12])
      expect(normalizeStudioTheme(malformed)).toBe("auto");
  });
  it("applies all six looks with readable screenplay ink and persists without altering Writer or source", async () => {
    await context.addInitScript(() => {
      localStorage.setItem("vxd-theme", "dark");
      localStorage.setItem("vxd-writer-paper", "slate");
    });
    await start();
    for (const [id, label, color] of [
      ["auto", "Auto", "rgb(255, 255, 255)"],
      ["paper", "Paper", "rgb(255, 255, 255)"],
      ["sepia", "Sepia", "rgb(247, 240, 225)"],
      ["night", "Night", "rgb(27, 29, 33)"],
      ["slate", "Slate", "rgb(38, 44, 53)"],
      ["contrast", "High contrast", "rgb(255, 255, 255)"],
    ] as const) {
      await choose(label);
      expect(await page.locator("html").getAttribute("data-studio-look")).toBe(id);
      expect(await page.locator("#theme").inputValue()).toBe(id);
      expect(await paper()).toBe(color);
      for (const selector of [".f-scene", ".f-note", ".f-character", ".f-dialogue"]) {
        const ink = await page
          .locator(`#editor ${selector}`)
          .first()
          .evaluate((node) => getComputedStyle(node).color);
        expect(contrast(ink, color)).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        await page.locator("#page").evaluate((node) => getComputedStyle(node).backgroundColor),
      ).toBe("rgb(255, 255, 255)");
    }
    expect(
      await page.evaluate(() => [
        localStorage.getItem("vxd-theme"),
        localStorage.getItem("vxd-writer-paper"),
      ]),
    ).toEqual(["dark", "slate"]);
    await page.reload();
    await ready();
    expect(await page.locator("html").getAttribute("data-studio-look")).toBe("contrast");
    expect(await page.locator("#appearance").getAttribute("aria-label")).toBe(
      "Appearance: High contrast",
    );
    const pending = page.waitForEvent("download");
    await command("Download Fountain");
    expect(readFileSync((await (await pending).path()) as string, "utf8")).toBe(source);
  });
  it("follows system changes in Auto and synchronizes the Preferences selector", async () => {
    await start();
    expect(await paper()).toBe("rgb(255, 255, 255)");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await paper()).toBe("rgb(27, 29, 33)");
    expect(await page.locator("html").getAttribute("data-studio-look")).toBe("auto");
    await command("Preferences");
    await page.locator("#theme").selectOption("paper");
    expect(await paper()).toBe("rgb(255, 255, 255)");
    await page.keyboard.press("Escape");
    await choose("Night");
    await page.emulateMedia({ colorScheme: "light" });
    expect(await paper()).toBe("rgb(27, 29, 33)");
    await choose("Auto");
    expect(await paper()).toBe("rgb(255, 255, 255)");
  });
  it("keeps mobile choices, keyboard operation and editing usable when storage is denied", async () => {
    await context.addInitScript(() => {
      for (const key of ["getItem", "setItem", "removeItem"])
        Object.defineProperty(Storage.prototype, key, {
          value() {
            throw new DOMException("Storage denied", "SecurityError");
          },
        });
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await start();
    await command("Appearance");
    const dialog = page.getByRole("dialog", { name: "Appearance", exact: true });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await dialog.getByRole("radio", { name: "Auto", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.locator("html").getAttribute("data-studio-look")).toBe("paper");
    await page.keyboard.press("ArrowRight");
    expect(await paper()).toBe("rgb(247, 240, 225)");
    await page.keyboard.press("Escape");
    expect(await page.locator("#notice").textContent()).toContain("storage is unavailable");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("!");
    await page.keyboard.press("Control+z");
    const pending = page.waitForEvent("download");
    await command("Download Fountain");
    expect(readFileSync((await (await pending).path()) as string, "utf8")).toBe(source);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
});
