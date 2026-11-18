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
describe("connected Studio writing workflow", () => {
  it("keeps scene revision, role rehearsal, source and actor sides connected", async () => {
    await start(
      "INT. CAFE - DAY\n\nMARA\nHello.\n\nJO\nHi.\n\n[[secret note]]\n\nEXT. ROAD - NIGHT\n\nMARA\nGoodbye.\n",
    );
    const inspector = page.locator(".studio-scene-context");
    await inspector.getByRole("button", { name: "Add synopsis…", exact: true }).click();
    await inspector.getByLabel("Scene synopsis").fill("Two friends meet.");
    await inspector.getByRole("button", { name: "Save synopsis", exact: true }).click();
    await ready();
    expect(await inspector.locator(".scene-context-synopsis").textContent()).toBe(
      "Two friends meet.",
    );
    await page.locator("#undo").click();
    await ready();
    expect(await inspector.locator(".scene-context-synopsis").textContent()).toBe(
      "No synopsis yet.",
    );
    await inspector
      .getByRole("combobox", { name: "In this scene", exact: true })
      .selectOption({ label: "JO" });
    await inspector.getByRole("button", { name: "Rehearse", exact: true }).click();
    const rehearsal = page.getByRole("dialog", { name: "Rehearsal cue cards", exact: true });
    expect(await rehearsal.getByLabel("Rehearsal role", { exact: true }).inputValue()).toBe("1");
    expect(await rehearsal.locator(".rehearsal-setup").getAttribute("open")).toBeNull();
    await rehearsal.getByRole("button", { name: "Reveal speech", exact: true }).click();
    expect(await rehearsal.getByLabel("Selected role speech", { exact: true }).textContent()).toBe(
      "Hi.",
    );
    expect(await rehearsal.innerText()).not.toContain("secret note");
    await rehearsal.getByRole("button", { name: "Edit this speech", exact: true }).click();
    expect(await rehearsal.isVisible()).toBe(false);
    expect(await page.locator("#position").textContent()).toBe("Line 6");
    expect(
      await page.locator("#editor .cm-content").evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await inspector.getByRole("button", { name: "Next scene in inspector", exact: true }).click();
    await inspector.getByRole("button", { name: "Rehearse", exact: true }).click();
    await rehearsal.getByRole("button", { name: "Reveal speech", exact: true }).click();
    expect(await rehearsal.getByLabel("Selected role speech", { exact: true }).textContent()).toBe(
      "Goodbye.",
    );
    await rehearsal
      .getByRole("button", { name: "Actor sides for this role…", exact: true })
      .click();
    const sides = page.getByRole("dialog", { name: "Actor sides", exact: true });
    expect(await sides.locator("#actor-sides-character option:checked").textContent()).toContain(
      "MARA",
    );
    expect(await sides.innerText()).not.toContain("secret note");
  });

  it("jumps to printed pages, zooms independently of print, and restores a reopened draft's place", async () => {
    const source = Array.from(
      { length: 20 },
      (_, n) => `INT. ROOM ${n + 1} - DAY\n\nMARA\n${"A quiet moment. ".repeat(20)}\n\n`,
    ).join("");
    await start(source);
    const counts = await page.locator("#counts").textContent();
    await page.locator("#writing-zoom").selectOption("20");
    expect(await page.locator("#counts").textContent()).toBe(counts);
    await page.locator("#manuscript-page").click();
    const jump = page.getByRole("dialog", { name: "Go to page", exact: true });
    await jump.getByRole("spinbutton", { name: "Screenplay page", exact: true }).fill("3");
    await jump.getByRole("button", { name: "Go to page", exact: true }).click();
    await page.waitForTimeout(400);
    const position = await page.locator("#position").textContent();
    expect(position).not.toBe("Line 1");
    const scroll = await page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    const visiblePassage = () =>
      page.locator(".cm-scroller").evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        const line = [...el.querySelectorAll(".cm-line")].find(
          (line) => line.getBoundingClientRect().bottom > top,
        );
        return { text: line?.textContent, offset: (line?.getBoundingClientRect().top ?? 0) - top };
      });
    const passage = await visiblePassage();
    await page.locator("#file").setInputFiles({
      name: "Other.fountain",
      mimeType: "text/plain",
      buffer: Buffer.from("!A different story."),
    });
    await page.waitForFunction(
      () => (document.querySelector("#name") as HTMLInputElement).value === "Other.fountain",
    );
    await ready();
    await page.locator("#file-menu").click();
    await page
      .locator("#file-dropdown")
      .getByRole("button", { name: "Recent drafts…", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Recent drafts", exact: true })
      .getByRole("button", { name: /Files.fountain.*Open copy/ })
      .click();
    await ready();
    await page.waitForTimeout(400);
    expect(await page.locator("#position").textContent()).toBe(position);
    // CodeMirror may refine offscreen height estimates; the visible passage must stay put.
    const restored = await visiblePassage();
    expect(restored.text).toBe(passage.text);
    expect(Math.abs(restored.offset - passage.offset)).toBeLessThan(3);
    await page.reload();
    await ready();
    await page.waitForTimeout(300);
    expect(await page.locator("#position").textContent()).toBe(position);
    expect(await page.locator("#writing-zoom").inputValue()).toBe("20");
  });
  it("keeps current-scene tools reachable with a long outline on desktop and phone", async () => {
    await start(
      Array.from({ length: 40 }, (_, n) => `INT. ROOM ${n} - DAY\n\nMARA\nHello.\n\n`).join(""),
    );
    const bounds = () =>
      page.locator("#outline").evaluate((el) => {
        const inspector = el.querySelector(".studio-scene-context") as HTMLElement;
        const list = el.querySelector("#scene-list") as HTMLElement;
        return {
          bottom: el.getBoundingClientRect().bottom,
          inspectorTop: inspector.getBoundingClientRect().top,
          inspectorBottom: inspector.getBoundingClientRect().bottom,
          listHeight: list.clientHeight,
          listScroll: list.scrollHeight,
        };
      });
    let layout = await bounds();
    expect(layout.listScroll).toBeGreaterThan(layout.listHeight);
    expect(layout.inspectorBottom).toBeLessThanOrEqual(layout.bottom);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator("#outline").isVisible()).toBe(false);
    await page.locator("#outline-toggle").click();
    layout = await bounds();
    expect(layout.inspectorTop).toBeLessThan(layout.bottom - 100);
    expect(layout.inspectorBottom).toBeLessThanOrEqual(layout.bottom);
    expect(layout.listScroll).toBeGreaterThan(layout.listHeight);
    const rehearsal = page
      .locator(".studio-scene-context")
      .getByRole("button", { name: "Rehearse", exact: true });
    expect((await rehearsal.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await rehearsal.click();
    expect(
      await page.getByRole("dialog", { name: "Rehearsal cue cards", exact: true }).isVisible(),
    ).toBe(true);
  });
});
