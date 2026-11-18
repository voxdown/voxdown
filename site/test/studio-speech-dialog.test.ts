import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountSpeechEditor } from "../src/studio/speech-dialog";
import type { SpeechEditPlan } from "../src/studio/speech-edit";

declare global {
  interface Window {
    speechUI: ReturnType<typeof mountSpeechEditor>;
    speechCurrent: { source: string; id: string };
    speechApplied: SpeechEditPlan | null;
    speechAccept: boolean;
    speechThrow: boolean;
  }
}
function compile(file: string): string {
  return transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
  }).outputText;
}
const url = (source: string) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const fountain = url(compile("../src/studio/fountain.ts"));
const filename = url(compile("../src/studio/filename.ts"));
const source = url(
  compile("../src/studio/source.ts").replace('"./filename"', JSON.stringify(filename)),
);
const edit = url(
  compile("../src/studio/speech-edit.ts")
    .replace('"./fountain"', JSON.stringify(fountain))
    .replace('"./source"', JSON.stringify(source)),
);
const dialog = url(
  compile("../src/studio/speech-dialog.ts")
    .replace('"./speech-edit"', JSON.stringify(edit))
    .replace('"./dialog-layout"', JSON.stringify(url(compile("../src/studio/dialog-layout.ts")))),
);
let browser: Browser;
let context: BrowserContext;
let page: Page;
const original = "@MARA\nHello [[private]].\n\n@JONAH\nOther.";
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32719/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><button id='open'>Edit speech</button></body></html>",
    }),
  );
  await page.goto("http://localhost:32719/");
  await page.addScriptTag({
    type: "module",
    content: `
    import {mountSpeechEditor} from ${JSON.stringify(dialog)};
    window.speechCurrent = {source: ${JSON.stringify(original)}, id: "original"};
    window.speechApplied = null; window.speechAccept = true; window.speechThrow = false;
    window.speechUI = mountSpeechEditor(document.body, {
      current: () => ({...window.speechCurrent}),
      apply: (snapshot, plan) => {
        if (window.speechThrow) throw new Error("test apply failure");
        if (!window.speechAccept || snapshot.id !== window.speechCurrent.id || snapshot.source !== window.speechCurrent.source) return false;
        window.speechApplied = plan;
        window.speechCurrent.source = plan.candidate;
        return true;
      }
    });
    document.getElementById("open").onclick = () => window.speechUI.open(1);
  `,
  });
  await page.waitForFunction(() => Boolean(window.speechUI));
});
afterEach(async () => {
  await context.close();
});
afterAll(async () => {
  await browser.close();
});
const open = () => page.locator("#open").click();
const input = () => page.getByRole("textbox", { name: "Speech source" });
const preview = () => page.getByRole("button", { name: "Preview speech edit" });
const apply = () => page.getByRole("button", { name: "Apply speech edit" });

describe("focused speech editor dialog", () => {
  it("opens exact private source with explicit disclosure, validates and applies only its speech", async () => {
    await open();
    expect(await input().inputValue()).toBe("Hello [[private]].");
    expect(await page.getByRole("dialog").textContent()).toContain("Private text appears here");
    expect(await input().evaluate((element) => element === document.activeElement)).toBe(true);
    await input().fill("Changed [[new private]].");
    expect(await apply().isDisabled()).toBe(true);
    await preview().click();
    expect(await apply().isEnabled()).toBe(true);
    await apply().click();
    expect(await page.evaluate(() => window.speechCurrent.source)).toBe(
      "@MARA\nChanged [[new private]].\n\n@JONAH\nOther.",
    );
    expect(await page.getByRole("dialog").count()).toBe(0);
  });
  it("invalidates approved previews on typing and rejects a blank line without changing source", async () => {
    await open();
    await input().fill("Changed.");
    await preview().click();
    await input().fill("One.\n\nTwo.");
    expect(await apply().isDisabled()).toBe(true);
    await preview().click();
    expect(await apply().isDisabled()).toBe(true);
    expect(await page.getByRole("status").textContent()).toContain("two spaces");
    expect(await page.evaluate(() => window.speechCurrent.source)).toBe(original);
    expect(await input().inputValue()).toBe("One.\n\nTwo.");
  });
  it.each(["id", "source"] as const)("refuses stale %s snapshots at apply", async (field) => {
    await open();
    await input().fill("Changed.");
    await preview().click();
    await page.evaluate((field) => {
      window.speechCurrent[field] = "replacement";
    }, field);
    await apply().click();
    expect(await page.evaluate(() => window.speechApplied)).toBeNull();
    expect(await page.getByRole("status").textContent()).toContain("screenplay changed");
    expect(await input().inputValue()).toBe("Changed.");
  });
  it("refuses stale previews before parsing", async () => {
    await open();
    await page.evaluate(() => {
      window.speechCurrent.id = "new";
    });
    await preview().click();
    expect(await apply().isDisabled()).toBe(true);
    expect(await page.getByRole("status").textContent()).toContain("screenplay changed");
  });
  it("preserves input if application refuses or throws", async () => {
    await open();
    await input().fill("Changed.");
    await preview().click();
    await page.evaluate(() => {
      window.speechAccept = false;
    });
    await apply().click();
    expect(await input().inputValue()).toBe("Changed.");
    expect(await page.evaluate(() => window.speechCurrent.source)).toBe(original);
    await preview().click();
    await page.evaluate(() => {
      window.speechThrow = true;
    });
    await apply().click();
    expect(await input().inputValue()).toBe("Changed.");
    expect(await page.getByRole("status").textContent()).toContain("could not be applied");
  });
  it("Escape cancels, returns focus and clears the private draft after close", async () => {
    await open();
    await input().fill("Uncommitted private rewrite.");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
    expect(await page.evaluate(() => window.speechCurrent.source)).toBe(original);
    expect(
      await page.locator("#open").evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await open();
    expect(await input().inputValue()).toBe("Hello [[private]].");
  });
  it("does not let a queued close event clear a newly opened speech", async () => {
    await open();
    await page.evaluate(() => {
      document.querySelector("dialog")?.close();
      window.speechUI.open(4);
    });
    await page.waitForFunction(() => document.querySelector("dialog")?.open === true);
    // Give the queued close event a turn before inspecting the new draft.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(await input().inputValue()).toBe("Other.");
    await input().fill("Other changed.");
    await preview().click();
    await apply().click();
    expect(await page.evaluate(() => window.speechCurrent.source)).toBe(
      "@MARA\nHello [[private]].\n\n@JONAH\nOther changed.",
    );
  });
  it("shows safe guidance for a missing or oversized speech without an apply path", async () => {
    await page.evaluate(() => {
      window.speechCurrent.source = "@MARA";
    });
    await open();
    expect(await input().isDisabled()).toBe(true);
    expect(await apply().isDisabled()).toBe(true);
    expect(await preview().isDisabled()).toBe(true);
    expect(await page.getByRole("status").textContent()).toContain("Write dialogue beneath");
    expect(
      await page
        .getByRole("button", { name: "Cancel" })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
  });
});
