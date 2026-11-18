import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ActorSidesSnapshot, mountActorSides } from "../src/studio/sides-dialog";

declare global {
  interface Window {
    sidesUI: ReturnType<typeof mountActorSides>;
    sidesCurrent: ActorSidesSnapshot;
    sidesDownloads: { name: string; type: string; bytes: number }[];
    sidesPdfCalls: { title: string; text: string }[];
    sidesPdfMode: "immediate" | "defer" | "fail";
    sidesResolve?: (value: Uint8Array) => void;
    sidesBuildCalls: number;
  }
}
const url = (source: string) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const pdfURL = url(`export async function screenplayPdf(layout,title) {
window.sidesPdfCalls.push({title,text:layout.pages.flatMap(p=>p.lines).map(l=>l.text).join("\\n")});
if(window.sidesPdfMode==='fail')throw Error('Test export failed');
if(window.sidesPdfMode==='defer')return new Promise(resolve=>window.sidesResolve=resolve);
return new Uint8Array([37,80,68,70]);
}`);
const modules = new Map<string, string>([["pdf", pdfURL]]);
function compile(name: string): string {
  const cached = modules.get(name);
  if (cached) return cached;
  const source = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
    },
  ).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dependency: string) =>
    JSON.stringify(compile(dependency)),
  );
  const result = url(
    name === "sides"
      ? source.replaceAll("layoutScreenplay(", "(window.sidesBuildCalls++, layoutScreenplay)(")
      : source,
  );
  modules.set(name, result);
  return result;
}
const dialogURL = compile("sides-dialog");
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("http://localhost:32704/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body><button id='opener'>Actor sides</button></body></html>",
    }),
  );
  await page.goto("http://localhost:32704/");
  await page.addScriptTag({
    type: "module",
    content: `
import {mountActorSides} from ${JSON.stringify(dialogURL)};
window.sidesCurrent={name:'Draft.fountain',paper:'letter',source:'INT. ROOM\\n\\n@MARA\\nOld snapshot speech. [[private]]'};
window.sidesDownloads=[];window.sidesPdfCalls=[];window.sidesPdfMode='immediate';window.sidesBuildCalls=0;
window.sidesUI=mountActorSides(document.body,{current:()=>window.sidesCurrent,download:(bytes,name,type)=>window.sidesDownloads.push({name,type,bytes:bytes.byteLength})});
document.querySelector('#opener').onclick=()=>window.sidesUI.open();
`,
  });
  await page.waitForFunction(() => Boolean(window.sidesUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());

describe("actor sides snapshot dialog", () => {
  it("reuses the selected packet while filtering and rebuilds when its inputs change", async () => {
    await page.evaluate(() => {
      window.sidesCurrent.source =
        "Title: Private title\n\nINT. ROOM\n\n@MARA\nHello.\n\n@JONAH\nOther.";
    });
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    expect(await page.evaluate(() => window.sidesBuildCalls)).toBe(1);
    for (const query of ["m", "ma", "mar", "mara"])
      await page.getByLabel("Find a character").fill(query);
    expect(await page.evaluate(() => window.sidesBuildCalls)).toBe(1);
    await page.getByLabel("Include original script title").check();
    expect(await page.evaluate(() => window.sidesBuildCalls)).toBe(2);
    await page.getByLabel("Find a character").fill("jonah");
    expect(await page.evaluate(() => window.sidesBuildCalls)).toBe(3);
    await page.getByLabel("Find a character").fill("no matches");
    expect(await page.getByRole("button", { name: "Download actor sides PDF" }).isDisabled()).toBe(
      true,
    );
    await page.getByLabel("Find a character").fill("jonah");
    expect(await page.evaluate(() => window.sidesBuildCalls)).toBe(4);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => {
      window.sidesCurrent.source = "@MARA\nChanged packet.";
    });
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    expect(await page.evaluate(() => window.sidesBuildCalls)).toBe(5);
    await page.getByRole("button", { name: "Download actor sides PDF" }).click();
    await page.waitForFunction(() => window.sidesDownloads.length === 1);
    expect(await page.evaluate(() => window.sidesPdfCalls[0]?.text)).toContain("Changed packet.");
  });

  it("exports the chosen opening snapshot while later edits remain untouched", async () => {
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    await page.evaluate(() => {
      window.sidesCurrent.source = "INT. NEW\n\n@BOB\nNew current speech.";
    });
    await page.getByRole("button", { name: "Download actor sides PDF" }).click();
    await page.waitForFunction(() => window.sidesDownloads.length === 1);
    const result = await page.evaluate(() => ({
      calls: window.sidesPdfCalls,
      current: window.sidesCurrent.source,
      download: window.sidesDownloads[0],
    }));
    expect(result.calls[0]?.text).toContain("Old snapshot speech.");
    expect(result.calls[0]?.text).not.toContain("private");
    expect(result.calls[0]?.title).toBe("MARA — actor sides");
    expect(result.current).toContain("New current speech.");
    expect(result.download?.type).toBe("application/pdf");
    expect(result.download?.name).toMatch(/actor-sides\.pdf$/);
  });

  it("cancels a pending download on Escape and does not corrupt a reopened dialog", async () => {
    await page.evaluate(() => {
      window.sidesPdfMode = "defer";
    });
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    await page.getByRole("button", { name: "Download actor sides PDF" }).click();
    await page.waitForFunction(() => Boolean(window.sidesResolve));
    await page.keyboard.press("Escape");
    expect(
      await page.locator("#opener").evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await page.evaluate(() => {
      window.sidesCurrent.source = "@BOB\nNew packet.";
      window.sidesPdfMode = "immediate";
    });
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    await page.getByRole("button", { name: "Download actor sides PDF" }).click();
    await page.waitForFunction(() => window.sidesDownloads.length === 1);
    await page.evaluate(() => window.sidesResolve?.(new Uint8Array([1, 2, 3])));
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => window.sidesDownloads.length)).toBe(1);
    expect(await page.getByLabel("Character", { exact: true }).inputValue()).toBe("0");
    expect(await page.locator("dialog").textContent()).toContain("download started");
  });

  it("bounds character options and segment previews while exporting the entire selection", async () => {
    await page.evaluate(() => {
      window.sidesCurrent.source = Array.from(
        { length: 120 },
        (_, i) => `INT. ROOM ${i}\n\n@CAST${i}\nHello.\n\n@MARA\nAll scenes.`,
      ).join("\n\n");
    });
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    expect(await page.locator("select option").count()).toBe(100);
    await page.getByLabel("Find a character").fill("CAST119");
    expect(await page.locator("select option").count()).toBe(1);
    expect(await page.locator("select").textContent()).toContain("CAST119");
    await page.getByLabel("Find a character").fill("MARA");
    expect(await page.locator(".actor-sides-scenes li").count()).toBe(100);
    expect(await page.locator("dialog").textContent()).toContain("120 segments");
    await page.getByRole("button", { name: "Download actor sides PDF" }).click();
    await page.waitForFunction(() => window.sidesDownloads.length === 1);
    expect(await page.evaluate(() => window.sidesPdfCalls[0]?.text)).toContain("INT. ROOM 119");
  });

  it("renders hostile names/headings as text and preserves source on export errors", async () => {
    const source = "INT. <img src=x onerror=alert(1)>\n\n@MARA\nHello.";
    await page.evaluate((source) => {
      window.sidesCurrent.source = source;
      window.sidesPdfMode = "fail";
    }, source);
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    expect(await page.locator("dialog img").count()).toBe(0);
    await page.getByRole("button", { name: "Download actor sides PDF" }).click();
    await page.waitForFunction(() =>
      document.querySelector("dialog")?.textContent?.includes("Test export failed"),
    );
    expect(await page.evaluate(() => window.sidesCurrent.source)).toBe(source);
    expect(await page.evaluate(() => window.sidesDownloads)).toEqual([]);
    expect(await page.getByRole("button", { name: "Download actor sides PDF" }).isEnabled()).toBe(
      true,
    );
  });

  it("blocks malformed omissions and retains an accessible close control", async () => {
    await page.evaluate(() => {
      window.sidesCurrent.source += "\n[[unclosed";
    });
    await page.getByRole("button", { name: "Actor sides", exact: true }).click();
    expect(await page.getByRole("button", { name: "Download actor sides PDF" }).isDisabled()).toBe(
      true,
    );
    expect(await page.locator("dialog").textContent()).toContain("incomplete private");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(await page.locator("dialog").isVisible()).toBe(false);
  });
});
