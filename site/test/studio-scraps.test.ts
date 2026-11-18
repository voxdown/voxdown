import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountReference } from "../src/studio/reference";
import { STUDIO_SCRAPS_PREFIX, readScrapBook, writeScrapBook } from "../src/studio/scraps-storage";
import { type Scrap, readScrapsFile, scrapsFile } from "../src/writer/scraps";

declare global {
  interface Window {
    scrapsUI: ReturnType<typeof mountReference>;
    scrapsDraft: { id: string; name: string };
    scrapsSelection: string;
    scrapsInsert: boolean;
    scrapsInserted: string[];
    scrapsDownload: { text: string; name: string } | null;
    scrapsPending: ((bytes: ArrayBuffer) => void)[];
    scrapsChanges: number;
  }
}
const modules = new Map<string, string>();
function compile(name: string): string {
  const path = posix.normalize(name);
  const cached = modules.get(path);
  if (cached) return cached;
  const source = transpileModule(
    readFileSync(new URL(`../src/${path}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
    },
  ).outputText.replace(/"(\.{1,2}\/[^".]+)"/g, (_, dependency: string) =>
    JSON.stringify(compile(posix.join(posix.dirname(path), dependency))),
  );
  const result = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  modules.set(path, result);
  return result;
}
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32709/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html><body><section id='preview'><div class='panel-heading'><h2>On the page</h2><span>Same layout as PDF</span></div><div id='page'>Original page</div></section></body></html>",
    }),
  );
  await page.goto("http://localhost:32709/");
  await mount();
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
async function mount() {
  await page.addScriptTag({
    type: "module",
    content: `
    import {mountReference} from ${JSON.stringify(compile("studio/reference"))};
    window.scrapsDraft={id:'draft-one',name:'Dragon.fountain'};
    window.scrapsSelection='';window.scrapsInsert=true;window.scrapsInserted=[];window.scrapsDownload=null;window.scrapsChanges=0;
    window.scrapsUI=mountReference(document.querySelector('#preview'),()=>{}, {
      current:()=>window.scrapsDraft,getSelection:()=>window.scrapsSelection,
      insert:(text)=>{if(window.scrapsInsert)window.scrapsInserted.push(text);return window.scrapsInsert;},
      download:(text,name)=>{window.scrapsDownload={text,name};},changed:()=>{window.scrapsChanges++;}
    });window.scrapsUI.openScraps();`,
  });
  await page.waitForFunction(() => Boolean(window.scrapsUI));
}
const newScrap = () => page.getByRole("textbox", { name: "New scrap", exact: true });
async function add(text: string) {
  await newScrap().fill(text);
  await page.getByRole("button", { name: "Add scrap", exact: true }).click();
}
const choose = (text: string) =>
  page.locator("#studio-scraps-panel input[type=file]").setInputFiles({
    name: "other.scraps.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
const sample: Scrap = {
  id: "sample",
  text: "NORA\nHello.",
  note: "Alternate",
  at: 1_700_000_000_000,
  from: "Scene 2",
};

describe("Studio scraps workflow", () => {
  it("keeps literal passages, edits and restores deleted scraps across reload without Writer storage", async () => {
    await page.evaluate(() => localStorage.setItem("vxd-writer-scraps", "writer sentinel"));
    await add("<img src=x onerror=alert(1)>\nNORA\nHello.");
    expect(await page.locator("img").count()).toBe(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit scrap text" }).fill("NORA\nAnother ending.");
    await page.getByRole("textbox", { name: "Edit scrap note" }).fill("For act two");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    expect(await page.locator(".studio-scrap").count()).toBe(0);
    await page.reload();
    await mount();
    await page.getByText("Deleted scraps (1)", { exact: true }).click();
    await page.getByRole("button", { name: "Bring back: NORA" }).click();
    expect(await page.locator(".studio-scrap-text").textContent()).toBe("NORA\nAnother ending.");
    expect(await page.locator(".studio-scrap-note").textContent()).toBe("For act two");
    expect(await page.evaluate(() => localStorage.getItem("vxd-writer-scraps"))).toBe(
      "writer sentinel",
    );
  });
  it("copies a selection and inserts through the editor callback without consuming the scrap", async () => {
    await page.evaluate(() => {
      window.scrapsSelection = "NORA\nHello.";
    });
    await page.getByRole("button", { name: "Copy selection", exact: true }).click();
    await page.getByRole("button", { name: "Insert at cursor" }).click();
    expect(await page.evaluate(() => window.scrapsInserted)).toEqual(["NORA\nHello."]);
    expect(await page.locator(".studio-scrap").count()).toBe(1);
    await page.evaluate(() => {
      window.scrapsInsert = false;
    });
    await page.getByRole("button", { name: "Insert at cursor" }).click();
    expect(await page.locator(".studio-scraps-status").textContent()).toContain("Could not insert");
    expect(await page.evaluate(() => window.scrapsInserted.length)).toBe(1);
  });
  it("keeps unsaved words visible on quota failure and retries without a duplicate", async () => {
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Full", "QuotaExceededError");
      };
    });
    await add("Do not lose this ending.");
    expect(await newScrap().inputValue()).toBe("Do not lose this ending.");
    expect(await page.locator(".studio-scraps-status").textContent()).toContain("not saved");
    expect(await page.locator(".studio-scrap").count()).toBe(0);
    await page.getByRole("tab", { name: "Page preview", exact: true }).click();
    await page.getByRole("tab", { name: "Scraps", exact: true }).click();
    expect(await newScrap().inputValue()).toBe("Do not lose this ending.");
  });
  it("refuses a stale tab write and loads external changes while preserving unfinished text", async () => {
    await add("First version");
    await page.evaluate(
      ({ key, sample }) => {
        localStorage.setItem(key, JSON.stringify({ version: 1, scraps: [sample], deleted: [] }));
      },
      { key: `${STUDIO_SCRAPS_PREFIX}draft-one`, sample },
    );
    await add("My unfinished line");
    expect(await page.locator(".studio-scraps-status").textContent()).toContain("another tab");
    await page.getByRole("tab", { name: "Page preview", exact: true }).click();
    await page.getByRole("tab", { name: "Scraps", exact: true }).click();
    expect(await newScrap().inputValue()).toBe("My unfinished line");
    expect(await page.locator(".studio-scrap-text").textContent()).toBe(sample.text);
    await page.getByRole("button", { name: "Add scrap", exact: true }).click();
    expect(await page.locator(".studio-scrap").count()).toBe(2);
  });
  it("clones recovered drafts independently and never leaks scraps into unrelated drafts", async () => {
    await add("Original scrap");
    expect(await page.evaluate(() => window.scrapsChanges)).toBe(1);
    await page.evaluate(() => {
      window.scrapsDraft = { id: "recovered", name: "Dragon.fountain" };
      window.scrapsUI.refreshScraps("draft-one");
    });
    expect(await page.locator(".studio-scrap-text").textContent()).toBe("Original scrap");
    expect(await page.evaluate(() => window.scrapsChanges)).toBe(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), `${STUDIO_SCRAPS_PREFIX}recovered`),
    ).toBeNull();
    await page.evaluate(() => window.scrapsUI.refreshScraps());
    expect(await page.locator(".studio-scrap-text").textContent()).toBe("Original scrap");
    await add("Recovered-only scrap");
    expect(await page.evaluate(() => window.scrapsChanges)).toBe(2);
    const original = await page.evaluate(
      (key) => localStorage.getItem(key),
      `${STUDIO_SCRAPS_PREFIX}draft-one`,
    );
    expect(JSON.parse(original ?? "{}").scraps).toHaveLength(1);
    await page.evaluate(() => {
      window.scrapsDraft = { id: "unrelated", name: "Other.fountain" };
      window.scrapsUI.refreshScraps();
    });
    expect(await page.locator(".studio-scrap").count()).toBe(0);
    await page.evaluate(() => {
      window.scrapsDraft = { id: "recovered", name: "Dragon.fountain" };
      window.scrapsUI.refreshScraps();
    });
    expect(await page.locator(".studio-scrap").count()).toBe(2);
  });
  it("exports and merges Writer-compatible files without replacing existing scraps", async () => {
    await add("Existing line");
    await choose(scrapsFile([sample], "From Writer"));
    await page.waitForFunction(() => document.querySelectorAll(".studio-scrap").length === 2);
    await choose(scrapsFile([sample], "From Writer"));
    await page.waitForFunction(() =>
      document.querySelector(".studio-scraps-status")?.textContent?.startsWith("0 scraps imported"),
    );
    await page.getByRole("button", { name: "Export scraps…" }).click();
    const downloaded = await page.evaluate(() => window.scrapsDownload);
    expect(downloaded?.name).toBe("Dragon.scraps.md");
    expect(readScrapsFile(downloaded?.text ?? "").map((scrap) => scrap.text)).toEqual([
      "Existing line",
      sample.text,
    ]);
    await page.getByRole("searchbox", { name: "Find a scrap" }).fill("alternate");
    expect(await page.locator(".studio-scrap").count()).toBe(1);
  });
  it("keeps inherited scraps when source-only edits first persist the recovered draft", async () => {
    await add("Still needed after rewriting the scene");
    await page.evaluate(() => {
      window.scrapsDraft = { id: "source-edited", name: "Dragon.fountain" };
      window.scrapsUI.refreshScraps("draft-one");
      window.scrapsUI.persistScraps();
    });
    const saved = await page.evaluate(
      (key) => localStorage.getItem(key),
      `${STUDIO_SCRAPS_PREFIX}source-edited`,
    );
    expect(JSON.parse(saved ?? "{}").scraps[0].text).toBe("Still needed after rewriting the scene");
    expect(await page.evaluate(() => window.scrapsChanges)).toBe(1);
  });
  it("does not import a late file into a different draft", async () => {
    await page.evaluate(() => {
      window.scrapsPending = [];
      File.prototype.arrayBuffer = () =>
        new Promise((resolve) => window.scrapsPending.push(resolve));
    });
    await choose(scrapsFile([sample], "Late"));
    await page.waitForFunction(() => window.scrapsPending.length === 1);
    await page.evaluate(() => {
      window.scrapsDraft = { id: "other", name: "Other.fountain" };
      window.scrapsUI.refreshScraps();
    });
    await page.evaluate(
      (text) => window.scrapsPending[0]?.(new TextEncoder().encode(text).buffer),
      scrapsFile([sample], "Late"),
    );
    expect(await page.locator(".studio-scrap").count()).toBe(0);
    expect(
      await page.evaluate(
        (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
        STUDIO_SCRAPS_PREFIX,
      ),
    ).toEqual([]);
  });
  it("rotates three side-panel tabs with arrow keys and Home/End", async () => {
    await page.getByRole("tab", { name: "Scraps", exact: true }).focus();
    for (const [key, label] of [
      ["ArrowRight", "Page preview"],
      ["ArrowLeft", "Scraps"],
      ["Home", "Page preview"],
      ["ArrowRight", "Text reference"],
      ["End", "Scraps"],
    ] as const) {
      await page.keyboard.press(key ?? "");
      expect(
        await page.getByRole("tab", { name: label, exact: true }).getAttribute("aria-selected"),
      ).toBe("true");
      expect(await page.getByRole("tabpanel").count()).toBe(1);
    }
  });
});

describe("atomic Studio scrap storage", () => {
  it("leaves malformed saved data untouched and rejects duplicate IDs before writes", () => {
    const values = new Map<string, string>([[`${STUDIO_SCRAPS_PREFIX}bad`, "{bad"]]);
    const keeper = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(() => readScrapBook(keeper, "bad")).toThrow();
    expect(values.get(`${STUDIO_SCRAPS_PREFIX}bad`)).toBe("{bad");
    expect(() =>
      writeScrapBook(keeper, "new", null, { version: 1, scraps: [sample, sample], deleted: [] }),
    ).toThrow("duplicate");
    expect(values.has(`${STUDIO_SCRAPS_PREFIX}new`)).toBe(false);
  });
});
