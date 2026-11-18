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
  await page.locator("#file").setInputFiles({
    name: "Recovery.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement)?.value === "Recovery.fountain",
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
describe("input and recovery integrity", () => {
  it("rejects a NUL paste atomically, retains undo and recovers exact Unicode source", async () => {
    const source = "\uFEFF!Cafe\u0301 🌙\r\n[[PRIVATE]]\r\nOriginal.";
    await start(source);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" Good edit.");
    const expected = `${source} Good edit.`;
    await page.keyboard.press("Shift+Home");
    const selected = await page.evaluate(() => getSelection()?.toString());
    await page.keyboard.insertText("Partial\0replacement");
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
    expect(await page.locator("#notice").textContent()).toContain("NUL");
    expect(await downloadSource()).toBe(expected);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+z");
    expect(await downloadSource()).toBe(source);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Shift+z");
    expect(await downloadSource()).toBe(expected);
    await page.waitForFunction(
      () => document.querySelector("#recovery")?.textContent === "Draft kept in this browser",
    );
    await page.reload();
    await ready();
    expect(await downloadSource()).toBe(expected);
  });

  it("keeps an invalid legacy draft and provides an exact emergency recovery download", async () => {
    await page.goto(`${origin}/studio/`);
    await ready();
    const source = "\uFEFF!Original\r\n[[PRIVATE]]\0\ud800";
    // A string callback keeps this browser-only dynamic import outside Vitest's SSR transform.
    await page.evaluate(`(async () => {
      const storage = await import('/src/studio/storage.ts');
      await storage.keepDraft({ id: 'legacy-nul', name: 'Legacy.fountain', source: ${JSON.stringify(source)}, updated: Date.now() });
      sessionStorage.setItem('studio-recovery-id', 'legacy-nul');
    })()`);
    await page.reload();
    await ready();
    expect(await page.locator("#recovery").textContent()).toMatch(/Recovery|recovery/);
    await command("Recovery and snapshots");
    await page
      .getByRole("button", { name: "Open Legacy.fountain as a new draft", exact: true })
      .click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download recovery JSON", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("Legacy.recovery.json");
    const content = JSON.parse(readFileSync((await download.path()) as string, "utf8"));
    expect(content).toEqual({
      format: "voxdown-studio-raw-recovery",
      version: 1,
      name: "Legacy.fountain",
      source,
    });
    expect(
      await page.evaluate(`(async () => {
        const storage = await import('/src/studio/storage.ts');
        return (await storage.getDraft('legacy-nul'))?.source;
      })()`),
    ).toBe(source);
  });

  it("forks independently edited recovered drafts across two tabs", async () => {
    await start("!Shared original.");
    await page.waitForFunction(
      () => document.querySelector("#recovery")?.textContent === "Draft kept in this browser",
    );
    const second = await context.newPage();
    await second.goto(`${origin}/studio/`);
    await second.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
    for (const [tab, suffix] of [
      [page, " First tab."],
      [second, " Second tab."],
    ] as const) {
      await tab.locator(".cm-content").click();
      await tab.keyboard.press("Control+End");
      await tab.keyboard.insertText(suffix);
      await tab.waitForFunction(
        () => document.querySelector("#recovery")?.textContent === "Draft kept in this browser",
      );
    }
    await page.reload();
    await ready();
    expect(await downloadSource()).toBe("!Shared original. First tab.");
    await second.reload();
    await second.waitForFunction(() => !document.querySelector<HTMLElement>("#app")?.inert);
    expect(await second.locator(".cm-content").textContent()).toBe("!Shared original. Second tab.");
  });
});
