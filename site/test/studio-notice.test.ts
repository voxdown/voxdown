import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

let browser: Browser;
let context: BrowserContext;
let page: Page;
const compiled = transpileModule(
  readFileSync(new URL("../src/studio/notice.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
type NoticeWindow = Window & {
  notices: {
    show(message: string, lifetime?: "important" | "success"): void;
    sourceEdited(): void;
  };
  finishSave?: () => void;
};
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.setContent('<input aria-label="Writing"><div id="notice" hidden></div>');
  await page.addScriptTag({
    type: "module",
    content: `${compiled}\nwindow.notices=createNoticePresenter(document.querySelector('#notice'));`,
  });
});
afterEach(async () => context.close());
afterAll(async () => browser.close());

it("clears completed download feedback only when the next accepted edit is reported", async () => {
  await page.evaluate(() =>
    (window as unknown as NoticeWindow).notices.show("Download started.", "success"),
  );
  await page.getByRole("textbox").focus();
  await page.keyboard.press("ArrowRight");
  expect(await page.locator("#notice").isVisible()).toBe(true);
  await page.evaluate(() => (window as unknown as NoticeWindow).notices.sourceEdited());
  expect(await page.locator("#notice").isVisible()).toBe(false);
  expect(await page.locator("#notice").textContent()).toBe("");
});

it("keeps default attention messages across edits and explicit success-to-error replacement", async () => {
  await page.evaluate(() => {
    const { notices } = window as unknown as NoticeWindow;
    notices.show("Downloaded.", "success");
    notices.show("Preview failed. Retry remains available.");
    notices.sourceEdited();
    notices.sourceEdited();
  });
  expect(await page.locator("#notice").textContent()).toBe(
    "Preview failed. Retry remains available.",
  );
  expect(await page.locator("#notice").isVisible()).toBe(true);
});

it("keeps new tool feedback after the source change that produced it", async () => {
  await page.evaluate(() => {
    const { notices } = window as unknown as NoticeWindow;
    notices.show("Downloaded.", "success");
    notices.sourceEdited();
    notices.show("Renamed two cues. Undo restores the original names.", "success");
  });
  expect(await page.locator("#notice").textContent()).toContain("Renamed two cues");
  expect(await page.locator("#notice").isVisible()).toBe(true);
  await page.evaluate(() => (window as unknown as NoticeWindow).notices.sourceEdited());
  expect(await page.locator("#notice").isVisible()).toBe(false);
});

it("does not let an earlier edit clear a later asynchronous save completion", async () => {
  await page.evaluate(() => {
    const state = window as unknown as NoticeWindow;
    void new Promise<void>((resolve) => {
      state.finishSave = resolve;
    }).then(() => state.notices.show("Saved to screenplay.fountain.", "success"));
    state.notices.sourceEdited();
  });
  await page.evaluate(() => (window as unknown as NoticeWindow).finishSave?.());
  await page.getByRole("status").filter({ hasText: "Saved to" }).waitFor();
  expect(await page.locator("#notice").isVisible()).toBe(true);
  await page.evaluate(() => (window as unknown as NoticeWindow).notices.sourceEdited());
  expect(await page.locator("#notice").isVisible()).toBe(false);
});

it("keeps an older-version save warning until explicitly replaced", async () => {
  await page.evaluate(() => {
    const { notices } = window as unknown as NoticeWindow;
    notices.show("Saved an earlier version. Save your newer edits again.", "important");
    notices.sourceEdited();
  });
  expect(await page.locator("#notice").isVisible()).toBe(true);
  await page.evaluate(() => {
    const { notices } = window as unknown as NoticeWindow;
    notices.show("Saved current version.", "success");
    notices.sourceEdited();
  });
  expect(await page.locator("#notice").isVisible()).toBe(false);
});

it("keeps literal polite status content without moving writing focus", async () => {
  await page.getByRole("textbox").focus();
  await page.evaluate(() =>
    (window as unknown as NoticeWindow).notices.show(
      'Saved <img src=x onerror="alert(1)">.',
      "success",
    ),
  );
  expect(await page.locator("#notice img").count()).toBe(0);
  expect(await page.locator("#notice").textContent()).toContain("<img");
  expect(await page.locator("#notice").getAttribute("role")).toBe("status");
  expect(await page.locator("#notice").getAttribute("aria-live")).toBe("polite");
  expect(await page.locator("#notice").getAttribute("aria-atomic")).toBe("true");
  expect(await page.getByRole("textbox").evaluate((node) => node === document.activeElement)).toBe(
    true,
  );
});

it("honors explicit clearing and does not revive earlier messages", async () => {
  await page.evaluate(() => {
    const { notices } = window as unknown as NoticeWindow;
    notices.show("Downloaded.", "success");
    notices.show("");
    notices.sourceEdited();
  });
  expect(await page.locator("#notice").textContent()).toBe("");
  expect(await page.locator("#notice").isVisible()).toBe(false);
});
