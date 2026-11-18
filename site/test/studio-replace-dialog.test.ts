import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReplaceSnapshot, mountScopedReplace } from "../src/studio/replace-dialog";
import type { ScopedReplacePlan } from "../src/studio/scoped-replace";

declare global {
  interface Window {
    replaceUI: ReturnType<typeof mountScopedReplace>;
    replaceCurrent: ReplaceSnapshot;
    replaceApplied: ScopedReplacePlan | null;
    replaceAccept: boolean;
    replaceThrow: boolean;
  }
}
const compile = (file: string) =>
  transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
  }).outputText;
const url = (source: string) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const fountain = url(
  compile("../src/studio/fountain.ts").replace(
    '"./inline"',
    JSON.stringify(url(compile("../src/studio/inline.ts"))),
  ),
);
const filename = url(compile("../src/studio/filename.ts"));
const source = url(
  compile("../src/studio/source.ts").replace('"./filename"', JSON.stringify(filename)),
);
const replace = url(
  compile("../src/studio/scoped-replace.ts")
    .replace('"./fountain"', JSON.stringify(fountain))
    .replace('"./source"', JSON.stringify(source)),
);
const dialog = url(
  compile("../src/studio/replace-dialog.ts")
    .replace('"./scoped-replace"', JSON.stringify(replace))
    .replace('"./dialog-layout"', JSON.stringify(url(compile("../src/studio/dialog-layout.ts")))),
);
const original =
  "INT. ROOM - DAY\n\n!light [[private light]]\n\n@MARA\nLight light.\n\nEXT. ROAD - DAY\n\n!light";
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32720/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><button id='open'>Replace</button></body></html>",
    }),
  );
  await page.goto("http://localhost:32720/");
  await page.addScriptTag({
    type: "module",
    content: `
    import {mountScopedReplace} from ${JSON.stringify(dialog)};
    window.replaceCurrent = {source: ${JSON.stringify(original)}, id: "original", position: 0, selection: {from: 0, to: 0}};
    window.replaceApplied = null; window.replaceAccept = true; window.replaceThrow = false;
    window.replaceUI = mountScopedReplace(document.body, {
      current: () => window.replaceCurrent,
      apply: (snapshot, plan) => {
        if (window.replaceThrow) throw new Error("test failure");
        if (!window.replaceAccept || snapshot.id !== window.replaceCurrent.id || snapshot.source !== window.replaceCurrent.source) return false;
        window.replaceApplied = plan; window.replaceCurrent.source = plan.candidate; return true;
      }
    });
    document.getElementById("open").onclick = () => window.replaceUI.open();
  `,
  });
  await page.waitForFunction(() => Boolean(window.replaceUI));
});
afterEach(async () => {
  await context.close();
});
afterAll(async () => {
  await browser.close();
});
const open = () => page.locator("#open").click();
const query = () => page.getByRole("textbox", { name: "Find text", exact: true });
const replacement = () => page.getByRole("textbox", { name: "Replacement text", exact: true });
const preview = () => page.getByRole("button", { name: "Preview replacements" });
const apply = () => page.getByRole("button", { name: "Apply replacements" });
const prepare = async () => {
  await query().fill("light");
  await replacement().fill("lamp");
  await preview().click();
};

describe("scoped replacement dialog", () => {
  it("opens with accessible controls, computes on preview and applies exact private-safe changes", async () => {
    await open();
    expect(await query().evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await page.getByRole("checkbox", { name: "Match case" }).isChecked()).toBe(true);
    await query().fill("light");
    await replacement().fill("lamp");
    expect(await apply().isDisabled()).toBe(true);
    expect(await page.locator(".replace-preview li").count()).toBe(0);
    await preview().click();
    expect(await page.getByRole("status").textContent()).toContain("3 matches; 3 replacements");
    expect(await page.locator(".replace-preview").textContent()).not.toContain("private light");
    await apply().click();
    expect(await page.evaluate(() => window.replaceCurrent.source)).toBe(
      original
        .replace("!light [[", "!lamp [[")
        .replace("Light light.", "Light lamp.")
        .replace("!light", "!lamp"),
    );
  });
  it("invalidates preview for every search control", async () => {
    await open();
    await prepare();
    await page.getByRole("checkbox", { name: "Match case" }).uncheck();
    expect(await apply().isDisabled()).toBe(true);
    await preview().click();
    expect(await page.getByRole("status").textContent()).toContain("4 matches; 4 replacements");
    await page.getByRole("checkbox", { name: "Whole words" }).check();
    expect(await apply().isDisabled()).toBe(true);
    await preview().click();
    await page.getByRole("combobox", { name: "Search scope" }).selectOption("dialogue");
    expect(await apply().isDisabled()).toBe(true);
    await preview().click();
    expect(await page.getByRole("status").textContent()).toContain("2 matches; 2 replacements");
    await replacement().fill("other");
    expect(await apply().isDisabled()).toBe(true);
    await preview().click();
    await query().fill("missing");
    expect(await apply().isDisabled()).toBe(true);
  });
  it.each(["id", "source"] as const)("refuses a stale %s at apply", async (field) => {
    await open();
    await prepare();
    await page.evaluate((field) => {
      window.replaceCurrent[field] = "changed";
    }, field);
    await apply().click();
    expect(await page.evaluate(() => window.replaceApplied)).toBeNull();
    expect(await page.getByRole("status").textContent()).toContain("screenplay changed");
  });
  it("captures selection by value and uses its original range despite caret movement", async () => {
    await page.evaluate(() => {
      const from = window.replaceCurrent.source.indexOf("Light light.");
      window.replaceCurrent.selection = { from, to: from + 12 };
    });
    await open();
    await page.evaluate(() => {
      window.replaceCurrent.selection.from = 0;
      window.replaceCurrent.selection.to = 2;
    });
    await page.getByRole("combobox", { name: "Search scope" }).selectOption("selection");
    await prepare();
    expect(await page.getByRole("status").textContent()).toContain("1 matches; 1 replacements");
    await apply().click();
    expect(await page.evaluate(() => window.replaceCurrent.source)).toBe(
      original.replace("Light light.", "Light lamp."),
    );
  });
  it("shows actionable errors for empty selection, dangerous syntax and count limit without mutating source", async () => {
    await open();
    await page.getByRole("combobox", { name: "Search scope" }).selectOption("selection");
    await prepare();
    expect(await page.getByRole("status").textContent()).toContain("nonempty text range");
    await page.getByRole("combobox", { name: "Search scope" }).selectOption("screenplay");
    await replacement().fill("[[hidden]]");
    await preview().click();
    expect(await apply().isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.replaceCurrent.source)).toBe(original);
  });
  it("limits preview nodes, reports all changes and preserves rejected application input", async () => {
    await page.evaluate(() => {
      window.replaceCurrent.source = `!${"light ".repeat(120)}`;
    });
    await open();
    await prepare();
    expect(await page.locator(".replace-preview li").count()).toBe(50);
    expect(await page.getByRole("status").textContent()).toContain("120 matches; 120 replacements");
    await page.evaluate(() => {
      window.replaceAccept = false;
    });
    await apply().click();
    expect(await query().inputValue()).toBe("light");
    expect(await replacement().inputValue()).toBe("lamp");
    await preview().click();
    await page.evaluate(() => {
      window.replaceThrow = true;
    });
    await apply().click();
    expect(await page.getByRole("status").textContent()).toContain("not confirmed");
  });
  it("Escape cancels, restores focus and clears source-derived preview/search text", async () => {
    await open();
    await prepare();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector(".replace-preview")?.childElementCount === 0,
    );
    expect(await page.evaluate(() => window.replaceCurrent.source)).toBe(original);
    expect(
      await page.locator("#open").evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await open();
    expect(await query().inputValue()).toBe("");
    expect(await replacement().inputValue()).toBe("");
  });
  it("does not let a queued close clear newly reopened dialog state", async () => {
    await open();
    await prepare();
    await page.evaluate(() => {
      document.querySelector("dialog")?.close();
      window.replaceUI.open();
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await prepare();
    expect(await apply().isEnabled()).toBe(true);
  });
});
