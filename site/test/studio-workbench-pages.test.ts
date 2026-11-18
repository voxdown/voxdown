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
  it("groups statistics, handles singular copy and keeps an optional target beside its own label", async () => {
    await start("INT. ROOM - DAY\n\n@ALICE\nHello.\n");
    await inspect("statistics");
    const metrics = workbench().locator(".workbench-metrics");
    expect(await metrics.locator("dt").allTextContents()).toEqual([
      "Printable words",
      "Scene",
      "Speaking character",
    ]);
    expect(await metrics.locator("dd").allTextContents()).toEqual(["5", "1", "1"]);
    expect(await workbench().locator(".workbench-speech").textContent()).toContain("1 spoken word");
    expect(await workbench().locator(".workbench-speech").textContent()).toContain(
      "Less than 1 minute of speech",
    );
    const goal = workbench().getByLabel("Draft word target (optional)", { exact: true });
    expect(await goal.inputValue()).toBe("");
    expect(await workbench().getByRole("progressbar").count()).toBe(0);
    await goal.fill("10");
    await goal.press("Tab");
    expect(await workbench().getByRole("progressbar").getAttribute("value")).toBe("5");
    expect(await workbench().locator(".workbench-goal-progress").textContent()).toContain(
      "50% complete · 5 words to go",
    );
    await goal.fill("4");
    await goal.press("Tab");
    expect(await workbench().locator(".workbench-goal-progress").textContent()).toContain(
      "Target reached",
    );
    await goal.fill("");
    await goal.press("Tab");
    expect(await workbench().getByRole("progressbar").count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("studio-word-goal"))).toBe("0");
    const explanation = workbench().locator(".workbench-explanation");
    expect(await explanation.getAttribute("open")).toBeNull();
    await explanation.locator("summary").click();
    expect(await explanation.locator("p").isVisible()).toBe(true);
    await goal.fill("20");
    await goal.press("Tab");
    expect(await explanation.getAttribute("open")).not.toBeNull();
    expect(
      await explanation
        .locator("summary")
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await workbench().evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  });
  it("keeps the header and navigation available while a long result list scrolls", async () => {
    await start(Array.from({ length: 80 }, (_, i) => `[[Private item ${i + 1}]]\n\n`).join(""));
    await inspect("notes");
    const body = workbench().locator(".workbench-body");
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const close = await workbench()
      .getByRole("button", { name: "Close", exact: true })
      .boundingBox();
    const view = await workbench().getByLabel("Workbench view", { exact: true }).boundingBox();
    expect(close?.y).toBeGreaterThanOrEqual(0);
    expect(view?.y).toBeGreaterThanOrEqual(0);
    expect(close?.height).toBeGreaterThanOrEqual(44);
    expect(view?.height).toBeGreaterThanOrEqual(44);
    await workbench().getByLabel("Workbench view", { exact: true }).selectOption("statistics");
    expect(
      await workbench().getByRole("heading", { name: "Screenplay workbench" }).isVisible(),
    ).toBe(true);
    expect(await workbench().locator(".workbench-metrics").isVisible()).toBe(true);
  });
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
      "No private notes or omitted passages in this draft.",
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
