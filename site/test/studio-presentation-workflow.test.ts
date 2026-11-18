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
describe("Studio speech, comments and scraps", () => {
  it("layers character colours above the current line and remembers all three display modes", async () => {
    await start("INT. ROOM - DAY\n\nNORA\nHello.\n\nJORDAN\nH");
    const editor = page.locator("#editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    const colors = () =>
      page
        .locator(".syntax-character")
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundImage));
    const hues = await colors();
    expect(hues[0]).not.toBe(hues[1]);
    expect(
      await page
        .locator(".cm-activeLine")
        .evaluate((node) => getComputedStyle(node).backgroundImage),
    ).toBe(hues[1]);
    await page.locator("#preferences").evaluate((node: HTMLButtonElement) => node.click());
    await page.getByLabel("Speech boxes", { exact: true }).selectOption("uniform");
    expect((await colors())[0]).toBe((await colors())[1]);
    await page.getByLabel("Speech boxes", { exact: true }).selectOption("off");
    expect(await colors()).toEqual(["none", "none"]);
    await page.reload();
    await ready();
    expect(await colors()).toEqual(["none", "none"]);
    await page.locator("#preferences").evaluate((node: HTMLButtonElement) => node.click());
    await page.getByLabel("Speech boxes", { exact: true }).selectOption("character");
    await page.getByRole("button", { name: "Close preferences", exact: true }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    expect(
      await page
        .locator(".syntax-character")
        .first()
        .evaluate((node) =>
          getComputedStyle(node).getPropertyValue("--studio-speech-lightness").trim(),
        ),
    ).toBe("23%");
  });
  it("groups green comments under scenes and preserves scraps-only edits across recovery", async () => {
    await start("INT. ROOM - DAY\n\nAction [[Check the window.]]\n\nNORA\nHello.");
    const note = page.locator("#editor .studio-comment");
    expect(await note.textContent()).toBe("[[Check the window.]]");
    expect(await note.evaluate((node) => getComputedStyle(node).color)).toBe("rgb(38, 114, 73)");
    const disclosure = page.locator(".outline-comment-toggle");
    expect(await disclosure.getAttribute("aria-expanded")).toBe("false");
    await disclosure.click();
    await page.locator(".outline-comment-link").click();
    expect(await page.locator("#position").textContent()).toBe("Line 3");
    await page.reload();
    await ready();
    const oldId = await page.evaluate(() => sessionStorage.getItem("studio-recovery-id"));
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Scraps", exact: true }).click();
    await page.getByLabel("New scrap", { exact: true }).fill("An alternate ending.");
    await page.getByRole("button", { name: "Add scrap", exact: true }).click();
    await page.waitForFunction(
      (old) => sessionStorage.getItem("studio-recovery-id") !== old,
      oldId,
    );
    await page.reload();
    await ready();
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Scraps", exact: true }).click();
    expect(await page.locator(".studio-scraps-list").innerText()).toContain("An alternate ending.");
    expect(await page.locator("#editor .cm-content").innerText()).not.toContain("alternate ending");
  });
});
