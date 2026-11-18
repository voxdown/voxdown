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

describe("integrated success notice lifetime", () => {
  it("clears download feedback on accepted typing, retaining it across caret and preference changes", async () => {
    await start();
    await command("Focus writing");
    expect(await downloadSource()).toBe("!Alpha beta");
    expect(await page.locator("#notice").textContent()).toContain("Fountain download started");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("ArrowLeft");
    expect(await page.locator("#notice").isVisible()).toBe(true);
    await command("Preferences");
    await page.locator("#typewriter").check();
    await page.keyboard.press("Escape");
    expect(await page.locator("#notice").isVisible()).toBe(true);
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(".");
    expect(await page.locator("#notice").isVisible()).toBe(false);
    expect(await page.locator("#notice").textContent()).toBe("");
    expect(await downloadSource()).toBe("!Alpha beta.");
  });

  it("rejects an oversized edit without losing the source-limit warning on the next accepted edit", async () => {
    await start("!Keep this.");
    await command("Focus writing");
    await downloadSource();
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText("x".repeat(500_001));
    expect(await page.locator(".cm-content").innerText()).toBe("!Keep this.");
    expect(await page.locator("#notice").textContent()).toContain("500,000-character");
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" More.");
    expect(await page.locator(".cm-content").innerText()).toBe("!Keep this. More.");
    expect(await page.locator("#notice").textContent()).toContain("500,000-character");
    expect(await page.locator("#notice").isVisible()).toBe(true);
  });

  it("shows the fresh tool result after its own edit, then clears it on a later edit", async () => {
    await start("INT. ROOM\n\nMARA\nHello.\n");
    await command("Focus writing");
    await command("Rename a character");
    const dialog = page.getByRole("dialog", { name: "Rename a character", exact: true });
    await dialog.getByLabel("Character", { exact: true }).selectOption("MARA");
    await dialog.getByLabel("New name", { exact: true }).fill("MAYA");
    await dialog.getByRole("button", { name: "Preview rename", exact: true }).click();
    await dialog.getByRole("button", { name: "Apply rename", exact: true }).click();
    expect(await page.locator("#notice").textContent()).toContain("Renamed 1 character cues");
    expect(await page.locator("#notice").isVisible()).toBe(true);
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n!A door closes.");
    expect(await page.locator("#notice").isVisible()).toBe(false);
    expect(await downloadSource()).toContain("MAYA");
  });

  it("keeps preview failure and recovery feedback while typing in focus mode", async () => {
    await context.addInitScript(() => {
      window.Worker = class {
        constructor() {
          throw Error("Preview worker unavailable");
        }
      } as unknown as typeof Worker;
    });
    await page.goto(`${origin}/studio/`);
    await page.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
    await page.locator("#retry-preview").waitFor();
    await command("Focus writing");
    expect(await page.locator("#notice").textContent()).toContain("worker");
    await page.locator(".cm-content").focus();
    await page.keyboard.insertText("INT. ROOM\n\n!Still writing.");
    expect(await page.locator("#notice").textContent()).toContain("worker");
    expect(await page.locator("#retry-preview").isVisible()).toBe(true);
    expect(await page.locator("#recovery").isVisible()).toBe(true);
  });
});
