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
const fixture =
  "INT. ROOM - DAY #15#\n\nAction.\n\nI/E. CAR - NIGHT #16#\n\nAction.\n\nINT/EXT. PARK - DAY\n\nAction.";
async function openNumbering() {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "Scene numbering…", exact: true }).click();
}
describe("production numbering in the editor", () => {
  it("centers both margins on wrapped headings at phone widths and keeps the lock recoverable", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(
      "INT. A VERY LONG HEADING WITH SEVERAL WORDS THAT WRAP - DAY #15AA#\n\nINT. NEXT - DAY\n\n/* VoxDown production v9\n{bad}\n*/",
    );
    await page.emulateMedia({ colorScheme: "dark" });
    const heading = page.locator(".syntax-scene").first();
    const bounds = await heading.boundingBox();
    expect(bounds?.height).toBeGreaterThan(40);
    const markers = await heading.locator(".studio-scene-number").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { middle: (box.top + box.bottom) / 2, clipped: node.scrollWidth > node.clientWidth };
      }),
    );
    for (const marker of markers) {
      expect(Math.abs(marker.middle - ((bounds?.y ?? 0) + (bounds?.height ?? 0) / 2))).toBeLessThan(
        1,
      );
      expect(marker.clipped).toBe(false);
    }
    expect(
      await heading.evaluate((node) => {
        const numbers = [...node.querySelectorAll(".studio-scene-number")].map((item) =>
          item.getBoundingClientRect(),
        );
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          if (text.parentElement?.closest(".studio-scene-numbers") || !text.textContent?.trim())
            continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          for (const box of range.getClientRects())
            if (
              box.left < (numbers[0]?.right ?? 0) + 2 ||
              box.right > (numbers[1]?.left ?? Number.POSITIVE_INFINITY) - 2
            )
              return false;
        }
        return true;
      }),
    ).toBe(true);
    await page.screenshot({ path: "/tmp/voxdown-studio-number-phone.png" });
    await openNumbering();
    await page
      .getByRole("button", { name: "Release unreadable production lock", exact: true })
      .click();
    await ready();
    expect(
      await page.getByRole("button", { name: "Accept scene number 16", exact: true }).count(),
    ).toBe(2);
    await page.locator("#editor .cm-content").focus();
    await page.keyboard.press("Control+z");
    await openNumbering();
    expect(
      await page
        .getByRole("button", { name: "Release unreadable production lock", exact: true })
        .isVisible(),
    ).toBe(true);
  });
  it("accepts the same suggestion from either margin and the shortcut, with undo", async () => {
    await start(fixture);
    const suggestion = page.getByRole("button", { name: "Accept scene number 17", exact: true });
    expect(await suggestion.count()).toBe(2);
    expect(await suggestion.first().getAttribute("title")).toContain("not included in PDF");
    expect(await suggestion.first().evaluate((node) => getComputedStyle(node).borderTopStyle)).toBe(
      "dashed",
    );
    const committed = page.locator(".studio-scene-number:not(.is-suggested)").first();
    expect(await committed.getAttribute("title")).toContain("included in PDF");
    expect(await committed.evaluate((node) => getComputedStyle(node).fontWeight)).toBe("600");
    expect(
      await page.locator(".studio-numbered-heading").evaluateAll((headings) =>
        headings.every((heading) => {
          const bounds = heading.getBoundingClientRect();
          return [...heading.querySelectorAll(".studio-scene-number")].every((number) => {
            const box = number.getBoundingClientRect();
            return Math.abs((box.top + box.bottom) / 2 - (bounds.top + bounds.bottom) / 2) < 1;
          });
        }),
      ),
    ).toBe(true);
    await page.screenshot({ path: "/tmp/voxdown-studio-number-suggestions.png" });
    const heading = page.locator(".syntax-scene").last();
    expect(await heading.textContent()).not.toContain("#17#");
    await suggestion.first().click();
    expect(await heading.textContent()).toContain("#17#");
    await page.keyboard.press("Control+z");
    expect(await suggestion.count()).toBe(2);
    await suggestion.last().hover();
    expect(await suggestion.last().locator(".scene-number-accept-icon").isVisible()).toBe(true);
    await suggestion.last().click();
    expect(await heading.textContent()).toContain("#17#");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+Alt+n");
    expect(await heading.textContent()).toContain("#17#");
    await page.keyboard.press("Control+z");
    await suggestion.last().focus();
    await page.keyboard.press("Enter");
    expect(await heading.textContent()).toContain("#17#");
    await page.screenshot({ path: "/tmp/voxdown-studio-production.png" });
  });
  it("locks numbers, blocks accidental marker edits, and survives recovery", async () => {
    await start(fixture);
    await openNumbering();
    await page.getByLabel("Lock scene numbers for production", { exact: true }).check();
    expect(await page.getByLabel("Numbering mode", { exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#editor .cm-content").focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    expect(await page.locator(".syntax-scene").first().textContent()).toContain("#15#");
    expect(await page.locator("#notice").textContent()).toContain("Scene numbers are locked");
    await page.getByRole("button", { name: "Accept scene number 17", exact: true }).last().click();
    await page.waitForFunction(
      () => document.querySelector("#recovery")?.textContent === "Draft kept in this browser",
    );
    await page.reload();
    await ready();
    expect(await page.locator("#production-status").isVisible()).toBe(true);
    await page.locator("#production-status").click();
    expect(
      await page.getByLabel("Lock scene numbers for production", { exact: true }).isChecked(),
    ).toBe(true);
    await page.getByLabel("Lock scene numbers for production", { exact: true }).uncheck();
    expect(await page.getByLabel("Numbering mode", { exact: true }).isDisabled()).toBe(false);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(await page.locator(".syntax-scene").last().textContent()).toContain("#17#");
  });
  it("previews inserted production labels and keeps shorthand explicit", async () => {
    await start(
      "INT. FIRST - DAY #15#\n\nI/E. CAR - DAY\n\nINT. LAST - NIGHT #16#\n\n.IN/EX. CAR - DAY",
    );
    expect(await page.locator(".syntax-scene").count()).toBe(4);
    expect(
      await page.getByRole("button", { name: "Accept scene number 15A", exact: true }).count(),
    ).toBe(2);
    await openNumbering();
    await page.getByLabel("Lock scene numbers for production", { exact: true }).check();
    await page.getByRole("button", { name: "Preview scene numbering", exact: true }).click();
    expect(await page.locator(".scene-numbering-preview").innerText()).toContain("#15A#");
    await page.getByRole("button", { name: "Apply scene numbering", exact: true }).click();
    expect(await page.locator(".syntax-scene").nth(1).textContent()).toContain("#15A#");
    expect(await page.locator(".syntax-scene").nth(2).textContent()).toContain("#16#");
    expect(await page.locator(".syntax-scene").last().textContent()).toContain(
      ".IN/EX. CAR - DAY #17#",
    );
  });
});
