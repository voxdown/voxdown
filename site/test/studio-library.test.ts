import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Library from "../src/studio/library";
import type * as Storage from "../src/studio/storage";

declare global {
  interface Window {
    libraryStore: typeof Storage;
    libraryUI: ReturnType<typeof Library.mountLibrary>;
    libraryCurrent: { name: string; source: string; draftId: string };
    libraryReplacement?: { name: string; source: string };
    libraryAccept: boolean;
    libraryDownload?: { content: string; filename: string; type: string };
  }
}
function compile(file: string): string {
  return transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
  }).outputText;
}
function moduleURL(text: string): string {
  return `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
}
const storageURL = moduleURL(compile("../src/studio/storage.ts"));
const comparisonURL = moduleURL(compile("../src/studio/comparison.ts"));
const filenameURL = moduleURL(compile("../src/studio/filename.ts"));
const sourceURL = moduleURL(
  compile("../src/studio/source.ts").replace('"./filename"', JSON.stringify(filenameURL)),
);
const layoutURL = moduleURL(compile("../src/studio/dialog-layout.ts"));
const libraryURL = moduleURL(
  compile("../src/studio/library.ts")
    .replace('"./storage"', JSON.stringify(storageURL))
    .replace('"./comparison"', JSON.stringify(comparisonURL))
    .replace('"./filename"', JSON.stringify(filenameURL))
    .replace('"./source"', JSON.stringify(sourceURL))
    .replace('"./dialog-layout"', JSON.stringify(layoutURL)),
);
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32702/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><button id='opener'>Library</button></body></html>",
    }),
  );
  await page.goto("http://localhost:32702/");
  await page.addScriptTag({
    type: "module",
    content: `
    import * as store from ${JSON.stringify(storageURL)};
    import {mountLibrary} from ${JSON.stringify(libraryURL)};
    window.libraryStore = store;
    window.libraryCurrent = {name: 'Current', source: 'Current source', draftId: 'active'};
    window.libraryAccept = true;
    window.libraryUI = mountLibrary(document.body, {
      current: () => window.libraryCurrent,
      replace: async (source, name) => { if (!window.libraryAccept) return false; window.libraryReplacement = {source,name}; return true; },
      download: (content, filename, type) => { window.libraryDownload = { content, filename, type }; },
      notice: () => {}
    });
    document.querySelector('#opener').onclick = () => window.libraryUI.open();
  `,
  });
  await page.waitForFunction(() => Boolean(window.libraryUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());

describe("Studio recovery library", () => {
  it("saves named snapshots, compares full bounded source, and restores exact source", async () => {
    const exact = `\uFEFFINT. ROOM - DAY\r\n${"Long source. ".repeat(5000)}`;
    await page.evaluate((source) => {
      window.libraryCurrent.source = source;
    }, exact);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByLabel("Snapshot name").fill("<img src=x onerror=alert(1)>");
    await page.getByRole("button", { name: "Save snapshot of current draft" }).click();
    await page.waitForFunction(() =>
      document.querySelector('[role="status"]')?.textContent?.includes("saved."),
    );
    expect(await page.locator(".library-list img").count()).toBe(0);
    await page.getByRole("button", { name: /^Compare / }).click();
    expect(await page.getByLabel(/^Saved version:/).inputValue()).toBe(
      exact.replace(/\r\n/g, "\n"),
    );
    expect(await page.locator(".library-comparison").textContent()).toContain(
      "The texts are identical.",
    );
    await page.getByRole("button", { name: "Open saved version as a new draft" }).click();
    await page.waitForFunction(() => Boolean(window.libraryReplacement));
    expect(await page.evaluate(() => window.libraryReplacement?.source)).toBe(exact);
    expect(await page.locator("dialog").isVisible()).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("opener");
    expect(
      await page.evaluate(async () => (await window.libraryStore.listSnapshots()).items),
    ).toHaveLength(1);
  });

  it("navigates actual changes with paired selections and safely displays literal HTML", async () => {
    await page.evaluate(async () => {
      await window.libraryStore.keepDraft({
        id: "old",
        name: "Old",
        source: "A\r\nold\r\nC\r\nlast",
        updated: 1,
      });
      window.libraryCurrent.source = "A\n<img src=x onerror=alert(1)>\nC\nextra\nlast";
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Compare Old with current draft", exact: true }).click();
    await page.locator(".library-comparison").waitFor({ state: "visible" });
    expect(await page.locator(".comparison-counts").textContent()).toContain(
      "2 added, 1 removed, 3 unchanged",
    );
    expect(await page.locator(".comparison-position").textContent()).toContain("Change 1 of 2");
    expect(
      await page.getByRole("button", { name: "Previous change", exact: true }).isDisabled(),
    ).toBe(true);
    const selection = async (label: RegExp) =>
      page
        .getByLabel(label)
        .evaluate((node: HTMLTextAreaElement) =>
          node.value.slice(node.selectionStart, node.selectionEnd),
        );
    expect(await selection(/^Saved version:/)).toBe("old\n");
    expect(await selection(/^Current draft:/)).toBe("<img src=x onerror=alert(1)>\n");
    expect(await page.locator(".library-comparison img").count()).toBe(0);
    expect(await page.locator(".comparison-removed pre").textContent()).toBe("old\n");
    expect(await page.locator(".comparison-added pre").textContent()).toBe(
      "<img src=x onerror=alert(1)>\n",
    );
    expect(await page.locator(".comparison-added pre").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Next change", exact: true }).click();
    expect(await page.locator(".comparison-position").textContent()).toContain("Change 2 of 2");
    expect(await selection(/^Saved version:/)).toBe("");
    expect(await selection(/^Current draft:/)).toBe("extra\n");
    expect(await page.locator(".comparison-removed").textContent()).toContain(
      "No lines on this side",
    );
    expect(await page.locator(".comparison-added pre").textContent()).toBe("extra\n");
    expect(await page.getByRole("button", { name: "Next change", exact: true }).isDisabled()).toBe(
      true,
    );
    await page.getByRole("button", { name: "Previous change", exact: true }).click();
    expect(await selection(/^Saved version:/)).toBe("old\n");
  });

  it("selects and scrolls to a first change beyond the old 50,000-character preview limit", async () => {
    await page.evaluate(async () => {
      const prefix = Array.from({ length: 5000 }, (_, i) => `Unchanged line ${i}`).join("\n");
      await window.libraryStore.keepDraft({
        id: "long",
        name: "Long",
        source: `${prefix}\nOld ending`,
        updated: 1,
      });
      window.libraryCurrent.source = `${prefix}\nNew ending`;
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page
      .getByRole("button", { name: "Compare Long with current draft", exact: true })
      .click();
    await page.locator(".library-comparison").waitFor({ state: "visible" });
    expect(await page.locator(".comparison-removed pre").textContent()).toBe("Old ending");
    await page.locator(".comparison-sources summary").click();
    await page.waitForFunction(
      () =>
        (document.querySelector(".library-comparison textarea") as HTMLTextAreaElement).scrollTop >
        1000,
    );
    const state = await page
      .getByLabel(/^Saved version:/)
      .evaluate((node: HTMLTextAreaElement) => ({
        selected: node.value.slice(node.selectionStart, node.selectionEnd),
        scroll: node.scrollTop,
      }));
    expect(state.selected).toBe("Old ending");
    expect(state.scroll).toBeGreaterThan(1000);
  });

  it("announces budget fallback without claiming unrelated texts are identical", async () => {
    await page.evaluate(async () => {
      const lines = Array.from({ length: 5000 }, (_, i) => `Old ${i}`).join("\n");
      await window.libraryStore.keepDraft({ id: "old", name: "Old", source: lines, updated: 1 });
      window.libraryCurrent.source = lines.replace(/Old/g, "New");
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Compare Old with current draft", exact: true }).click();
    await page.locator(".library-comparison").waitFor({ state: "visible" });
    expect(await page.locator(".comparison-counts").textContent()).toContain(
      "Comparison too large",
    );
    expect(await page.getByRole("button", { name: "Next change", exact: true }).isVisible()).toBe(
      false,
    );
    expect(await page.getByLabel(/^Saved version:/).inputValue()).toContain("Old 0");
  });

  it("bounds highlighted excerpts while retaining access to a complete large change", async () => {
    const source = "Long changed passage. ".repeat(20000);
    await page.evaluate(async (value) => {
      await window.libraryStore.keepDraft({ id: "old", name: "Old", source: "", updated: 1 });
      window.libraryCurrent.source = value;
    }, source);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Compare Old with current draft", exact: true }).click();
    await page.locator(".comparison-added pre").waitFor({ state: "visible" });
    expect(await page.locator(".comparison-added pre").isVisible()).toBe(true);
    expect((await page.locator(".comparison-added pre").textContent())?.length).toBeLessThanOrEqual(
      4000,
    );
    expect(await page.locator(".comparison-added").textContent()).toContain("Excerpt shortened");
    await page.locator(".comparison-sources summary").click();
    expect(await page.getByLabel(/^Current draft:/).inputValue()).toBe(source);
  });

  it("distinguishes a removed terminal blank line from an empty insertion side", async () => {
    await page.evaluate(async () => {
      await window.libraryStore.keepDraft({ id: "old", name: "Old", source: "a\n", updated: 1 });
      window.libraryCurrent.source = "a";
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Compare Old with current draft", exact: true }).click();
    expect(await page.locator(".comparison-removed pre").textContent()).toBe("(Blank line)");
    expect(await page.locator(".comparison-added").textContent()).toContain(
      "No lines on this side",
    );
    expect(await page.locator(".comparison-position").textContent()).toContain("Saved: line 2.");
  });

  it("protects the current draft, requires explicit deletion, and reopens after canceled restoration", async () => {
    await page.evaluate(async () => {
      await window.libraryStore.keepDraft({
        id: "active",
        name: "Current",
        source: "Keep",
        updated: 2,
      });
      await window.libraryStore.keepDraft({
        id: "older",
        name: "Older",
        source: "Earlier",
        updated: 1,
      });
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".library-list li").length === 2);
    expect(
      await page.getByRole("button", { name: "Delete Current", exact: true }).isDisabled(),
    ).toBe(true);
    await page.evaluate(() => {
      window.libraryAccept = false;
    });
    await page.getByRole("button", { name: "Open Older as a new draft", exact: true }).click();
    await page.waitForFunction(
      () =>
        Boolean(document.querySelector("dialog")?.open) &&
        !document.querySelector("fieldset")?.disabled,
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Delete Older", exact: true }).click();
    expect(
      await page.evaluate(async () => Boolean(await window.libraryStore.getDraft("older"))),
    ).toBe(true);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Older", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".library-list li").length === 1);
    expect(await page.evaluate(async () => window.libraryStore.getDraft("older"))).toBeUndefined();
    await page.keyboard.press("Escape");
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });

  it("browses all metadata pages while bounding rendered rows and avoiding source reads", async () => {
    await page.evaluate(async () => {
      for (let index = 0; index < 130; index++)
        await window.libraryStore.keepDraft({
          id: `draft-${index}`,
          name: `Draft ${index}`,
          source: "Text",
          updated: index,
        });
      const original = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name === "drafts" || this.name === "snapshots")
          throw new Error("Listing must not read source");
        return original.apply(this, args);
      };
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".library-list li").length === 25);
    for (let index = 0; index < 5; index++) {
      await page.getByRole("button", { name: "Load older saved work" }).click();
      await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);
      expect(await page.locator(".library-list li").count()).toBeLessThanOrEqual(100);
    }
    expect(await page.getByRole("button", { name: "Load older saved work" }).isVisible()).toBe(
      false,
    );
    expect(
      await page
        .getByRole("button", { name: "Open Draft 0 as a new draft", exact: true })
        .isVisible(),
    ).toBe(true);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".library-list li").length === 25);
    expect(
      await page
        .getByRole("button", { name: "Open Draft 129 as a new draft", exact: true })
        .isVisible(),
    ).toBe(true);
  });
});

describe("emergency recovery of previously saved unsupported source", () => {
  it("offers exact private-inclusive JSON only after an invalid entry is chosen, without replacing or deleting it", async () => {
    const source = "\uFEFF!Original\r\n[[PRIVATE]]\rA\0B\ud800";
    await page.evaluate(async (source) => {
      await window.libraryStore.keepDraft({
        id: "invalid",
        name: "../Saved.txt",
        source,
        updated: 2,
      });
      await window.libraryStore.keepDraft({
        id: "valid",
        name: "Valid",
        source: "!Valid source",
        updated: 1,
      });
    }, source);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page
      .getByRole("button", { name: "Open ../Saved.txt as a new draft", exact: true })
      .waitFor();
    expect(
      await page.getByRole("button", { name: "Download recovery JSON", exact: true }).isVisible(),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Open ../Saved.txt as a new draft", exact: true })
      .click();
    const download = page.getByRole("button", { name: "Download recovery JSON", exact: true });
    await download.waitFor();
    expect(await page.evaluate(() => window.libraryReplacement)).toBeUndefined();
    expect(await page.locator("dialog").textContent()).toContain(
      "cannot be imported as a Studio backup",
    );
    expect(await download.evaluate((element) => document.activeElement === element)).toBe(true);
    await download.click();
    const result = await page.evaluate(() => window.libraryDownload);
    expect(result?.filename).toBe("-Saved.recovery.json");
    expect(result?.type).toBe("application/json");
    expect(JSON.parse(result?.content ?? "null")).toEqual({
      format: "voxdown-studio-raw-recovery",
      version: 1,
      name: "../Saved.txt",
      source,
    });
    expect(
      await page.evaluate(async () => (await window.libraryStore.getDraft("invalid"))?.source),
    ).toBe(source);
    expect(await page.evaluate(() => window.libraryCurrent.source)).toBe("Current source");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    expect(await download.isVisible()).toBe(false);
    await page.getByRole("button", { name: "Open Valid as a new draft", exact: true }).click();
    await page.waitForFunction(() => window.libraryReplacement?.source === "!Valid source");
  });

  it("retains invalid snapshots and clears the recovery action on close", async () => {
    await page.evaluate(async () => {
      await window.libraryStore.createSnapshot({
        name: "Unsupported snapshot",
        source: "x\0y",
        draftId: "legacy",
      });
    });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByLabel("Show").selectOption("snapshots");
    await page
      .getByRole("button", { name: "Open Unsupported snapshot as a new draft", exact: true })
      .click();
    await page.getByRole("button", { name: "Download recovery JSON", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    expect(
      await page.getByRole("button", { name: "Download recovery JSON", exact: true }).isVisible(),
    ).toBe(false);
    expect(
      await page.evaluate(async () => (await window.libraryStore.listSnapshots()).items.length),
    ).toBe(1);
  });
});
