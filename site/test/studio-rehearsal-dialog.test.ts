import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { mountRehearsal } from "../src/studio/rehearsal-dialog";
declare global {
  interface Window {
    rehearsalUI: ReturnType<typeof mountRehearsal>;
    rehearsalCurrent: { source: string; name: string };
    rehearsalFailure: boolean;
  }
}
const modules = new Map<string, string>();
function compile(name: string): string {
  const existing = modules.get(name);
  if (existing) return existing;
  const source = transpileModule(
    readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
    },
  ).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dependency: string) =>
    JSON.stringify(compile(dependency)),
  );
  const result = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  modules.set(name, result);
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
  await page.route("http://localhost:32724/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body><button id='open'>Rehearse</button></body></html>",
    }),
  );
  await page.goto("http://localhost:32724/");
  await page.addScriptTag({
    type: "module",
    content: `import {mountRehearsal} from ${JSON.stringify(compile("rehearsal-dialog"))};
window.rehearsalCurrent={source:'Title: PRIVATE TITLE\\n\\nINT. ROOM\\n\\n@MARA\\nFirst answer [[PRIVATE NOTE]].\\n\\n@JON\\nA public prompt.\\n\\n@MARA\\nSecond answer.\\n\\nEXT. PARK\\n\\n@MARA\\nThird answer.',name:'Practice.fountain'};
window.rehearsalFailure=false;
window.rehearsalUI=mountRehearsal(document.body,{current:()=>{if(window.rehearsalFailure)throw Error('Read unavailable');return window.rehearsalCurrent;}});
document.querySelector('#open').onclick=()=>window.rehearsalUI.open();`,
  });
  await page.waitForFunction(() => Boolean(window.rehearsalUI));
});
afterEach(async () => context.close());
afterAll(async () => browser.close());
const open = () => page.locator("#open").click();
const reveal = () => page.getByRole("button", { name: "Reveal speech", exact: true }).click();

describe("self-paced rehearsal dialog", () => {
  it("collapses setup for focused practice and reopens it without changing the cue", async () => {
    await open();
    await page.getByRole("button", { name: "Start rehearsing", exact: true }).click();
    expect(await page.getByLabel("Rehearsal role", { exact: true }).isVisible()).toBe(false);
    expect(
      await page.locator(".rehearsal-card").evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("ArrowRight");
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("Second answer.");
    await page.locator(".rehearsal-setup summary").click();
    expect(await page.getByLabel("Rehearsal role", { exact: true }).isVisible()).toBe(true);
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("Second answer.");
  });
  it("starts hidden, reveals complete speech and hides again for navigation and restart", async () => {
    await open();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(await page.getByRole("dialog").textContent()).not.toContain("First answer");
    expect(await page.getByRole("dialog").textContent()).not.toContain("PRIVATE");
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("First answer .");
    await page.getByRole("button", { name: "Next cue", exact: true }).click();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(await page.locator(".rehearsal-context").textContent()).toBe("JON\nA public prompt.");
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("Second answer.");
    await page.getByRole("button", { name: "Restart these cues" }).click();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(await page.getByRole("dialog").textContent()).toContain("Cue 1 of 3");
    expect(await page.getByRole("button", { name: "Previous cue", exact: true }).isDisabled()).toBe(
      true,
    );
  });
  it("filters roles and selects individual scene occurrences without revealing answers", async () => {
    await open();
    await reveal();
    await page.getByLabel("Rehearsal scene", { exact: true }).selectOption("2");
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(await page.getByRole("dialog").textContent()).toContain("Cue 1 of 1");
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("Third answer.");
    await page.getByLabel("Find a rehearsal role", { exact: true }).fill("jon");
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(await page.getByLabel("Rehearsal role", { exact: true }).locator("option").count()).toBe(
      1,
    );
    await page.getByLabel("Find a rehearsal role", { exact: true }).fill("missing");
    expect(
      await page.getByRole("button", { name: "Reveal speech", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await page.getByRole("dialog").textContent()).toContain("No spoken cues");
  });
  it("keeps the captured source despite later edits and never changes storage or caller source", async () => {
    await open();
    await page.evaluate(() => {
      window.rehearsalCurrent.source = "@MARA\nNew current answer.";
    });
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("First answer .");
    expect(
      await page.evaluate(() => ({
        source: window.rehearsalCurrent.source,
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ source: "@MARA\nNew current answer.", local: 0, session: 0 });
    await page.keyboard.press("Escape");
    expect(await page.locator(".rehearsal-context").textContent()).toBe("");
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(await page.locator("#open").evaluate((node) => node === document.activeElement)).toBe(
      true,
    );
    await open();
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("New current answer.");
  });
  it("uses arrow navigation while reading but never intercepts text input, selects or composition", async () => {
    await open();
    const roleSearch = page.getByLabel("Find a rehearsal role", { exact: true });
    await roleSearch.press("ArrowRight");
    expect(await page.getByRole("dialog").textContent()).toContain("Cue 1 of 3");
    await page.locator(".rehearsal-card").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("dialog").textContent()).toContain("Cue 2 of 3");
    await page
      .locator(".rehearsal-card")
      .dispatchEvent("keydown", { key: "ArrowRight", isComposing: true });
    expect(await page.getByRole("dialog").textContent()).toContain("Cue 2 of 3");
    await page.keyboard.press("ArrowLeft");
    expect(await page.getByRole("dialog").textContent()).toContain("Cue 1 of 3");
  });
  it("closes on Escape from a populated search field without retaining the answer", async () => {
    await open();
    await page.getByLabel("Find a rehearsal role", { exact: true }).fill("MARA");
    await reveal();
    await page.getByLabel("Find a rehearsal role", { exact: true }).focus();
    await page.keyboard.press("Escape");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
    expect(
      await page.locator("#open").evaluate((element) => element === document.activeElement),
    ).toBe(true);
  });
  it("bounds option lists but reaches late roles and scenes with search", async () => {
    await page.evaluate(() => {
      window.rehearsalCurrent.source = Array.from(
        { length: 130 },
        (_, i) => `INT. ROOM ${i}\n\n@MARA\nAnswer ${i}.\n\n@PERSON ${i}\nPrompt.`,
      ).join("\n\n");
    });
    await open();
    expect(await page.getByLabel("Rehearsal role", { exact: true }).locator("option").count()).toBe(
      100,
    );
    expect(
      await page.getByLabel("Rehearsal scene", { exact: true }).locator("option").count(),
    ).toBe(101);
    expect(await page.locator(".rehearsal-card").count()).toBe(1);
    await page.getByLabel("Find a rehearsal scene", { exact: true }).fill("ROOM 129");
    await page.getByLabel("Rehearsal scene", { exact: true }).selectOption("130");
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("Answer 129.");
    await page.getByLabel("Find a rehearsal role", { exact: true }).fill("PERSON 129");
    expect(await page.getByLabel("Rehearsal role", { exact: true }).locator("option").count()).toBe(
      1,
    );
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
  });
  it("shows dual context explicitly and treats hostile cue/answer text literally", async () => {
    await page.evaluate(() => {
      window.rehearsalCurrent.source = "@MARA\n<img src=x onerror=alert(1)>\n\n@JON ^\nRight.";
    });
    await open();
    expect(await page.getByRole("dialog").textContent()).toContain("Dual dialogue");
    expect(await page.locator(".rehearsal-context").textContent()).toBe("JON\nRight.");
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(await page.locator("dialog img").count()).toBe(0);
  });
  it("blocks malformed or nested notes without printing their private text", async () => {
    for (const source of ["@MARA\n[[PRIVATE UNCLOSED", "@MARA\n/*PRIVATE /*INNER*/ TAIL*/"]) {
      await page.evaluate((source) => {
        window.rehearsalCurrent.source = source;
      }, source);
      await open();
      expect(
        await page.getByRole("button", { name: "Reveal speech", exact: true }).isDisabled(),
      ).toBe(true);
      expect(await page.getByRole("dialog").textContent()).not.toMatch(/PRIVATE|INNER|TAIL/);
      await page.keyboard.press("Escape");
    }
  });
  it("preserves queued close/reopen and recovers from source callback failure", async () => {
    await open();
    await page.evaluate(() => {
      window.rehearsalUI.close();
      window.rehearsalCurrent.source = "@NEW\nReopened.";
      window.rehearsalUI.open();
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await reveal();
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("Reopened.");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.rehearsalFailure = true;
    });
    await open();
    expect(await page.getByRole("dialog").textContent()).toContain("Read unavailable");
    expect(await page.locator(".rehearsal-answer").textContent()).toBe("");
  });
});
