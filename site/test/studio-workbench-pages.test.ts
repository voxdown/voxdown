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
  page.setDefaultTimeout(8000);
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
    .setInputFiles({ name: "Files.fountain", mimeType: "text/plain", buffer: Buffer.from(source) });
  await page.waitForFunction(
    () => (document.querySelector("#name") as HTMLInputElement)?.value === "Files.fountain",
  );
  await ready();
}
const workbench = () => page.getByRole("dialog", { name: "Screenplay workbench", exact: true });
async function inspect(section: string) {
  await page.locator("#commands").click();
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Writing statistics");
  await page.keyboard.press("Enter");
  await workbench().getByLabel("Workbench view", { exact: true }).selectOption(section);
}
async function downloaded() {
  const pending = page.waitForEvent("download");
  await page.locator("#download").click();
  return readFileSync((await (await pending).path()) as string, "utf8");
}
describe("bounded workbench result browsing", () => {
  it("reaches every private note without knowing its search text, with bounded DOM and exact source", async () => {
    const source = `\ufeffINT. ROOM - DAY\r\n\r\n${Array.from({ length: 205 }, (_, i) => `[[Private item ${i + 1}]]\r\n\r\n`).join("")}`;
    await start(source);
    await inspect("notes");
    expect(await workbench().locator("article").count()).toBe(100);
    expect(await workbench().getByRole("status").textContent()).toContain("showing 1–100");
    await workbench().getByRole("button", { name: "Next 100 results" }).click();
    expect(await workbench().locator("article").count()).toBe(100);
    expect(await workbench().locator("article pre").first().textContent()).toBe("Private item 101");
    expect(
      await workbench()
        .locator("article button")
        .first()
        .evaluate((n) => n === document.activeElement),
    ).toBe(true);
    await workbench().getByRole("button", { name: "Next 100 results" }).click();
    expect(await workbench().locator("article").count()).toBe(5);
    expect(await workbench().getByRole("button", { name: "Next 100 results" }).isDisabled()).toBe(
      true,
    );
    await workbench().getByRole("button", { name: "Previous 100 results" }).click();
    expect(await workbench().getByRole("status").textContent()).toContain("showing 101–200");
    await workbench().getByLabel("Filter workbench", { exact: true }).fill("Private item 205");
    expect(await workbench().locator("article").count()).toBe(1);
    expect(await workbench().getByRole("status").textContent()).toContain("showing 1–1");
    expect(await workbench().getByRole("button", { name: "Next 100 results" }).isVisible()).toBe(
      false,
    );
    await workbench().getByRole("button", { name: "Close", exact: true }).click();
    expect(await downloaded()).toBe(source);
  });
  it("reaches later characters and resets pagination when reopening or changing view", async () => {
    const source = `INT. ROOM - DAY\n\n${Array.from({ length: 103 }, (_, i) => `@PERSON ${i + 1}\nHello.\n\n`).join("")}`;
    await start(source);
    await inspect("characters");
    expect(await workbench().locator("details").count()).toBe(100);
    await workbench().getByRole("button", { name: "Next 100 results" }).click();
    expect(await workbench().locator("details").count()).toBe(3);
    expect(
      await workbench()
        .locator("details > summary")
        .first()
        .evaluate((n) => n === document.activeElement),
    ).toBe(true);
    expect(await workbench().locator("summary").first().textContent()).toContain("PERSON 101");
    await workbench().locator("summary").last().click();
    expect(await workbench().locator(".character-speeches pre").textContent()).toBe("Hello.");
    await workbench().getByLabel("Workbench view", { exact: true }).selectOption("notes");
    expect(await workbench().getByRole("status").textContent()).toBe(
      "No matching private passages.",
    );
    await workbench().getByLabel("Workbench view", { exact: true }).selectOption("characters");
    expect(await workbench().getByRole("status").textContent()).toContain("showing 1–100");
    await page.keyboard.press("Escape");
    await inspect("characters");
    expect(await workbench().getByRole("status").textContent()).toContain("showing 1–100");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});
