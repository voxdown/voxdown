import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

function moduleUrl(name: string): string {
  const source = readFileSync(new URL(`../src/studio/${name}.ts`, import.meta.url), "utf8");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
  }).outputText.replace(/"\.\/([a-z-]+)"/g, (_, dependency: string) =>
    JSON.stringify(moduleUrl(dependency)),
  );
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const styles = ["studio.css", "dialog-layout.css", "help.css"]
  .map((file) => readFileSync(new URL(`../src/studio/${file}`, import.meta.url), "utf8"))
  .join("\n");
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
});
async function mount(apple = false) {
  await page.setContent(
    '<!doctype html><html lang="en"><title>Studio help</title><button id="about">About Studio</button><button id="shortcuts">Keyboard shortcuts</button></html>',
  );
  await page.addStyleTag({ content: styles });
  await page.evaluate((apple) => {
    Object.defineProperty(navigator, "platform", { value: apple ? "MacIntel" : "Linux" });
    Reflect.set(window, "__WRITER_BUILD__", { date: "2026-11-18", commit: "abc1234" });
  }, apple);
  await page.addScriptTag({
    type: "module",
    content: `import {mountStudioHelp} from ${JSON.stringify(moduleUrl("help"))};
      const help=mountStudioHelp(document.body);
      document.querySelector('#about').onclick=help.openAbout;
      document.querySelector('#shortcuts').onclick=help.openShortcuts;`,
  });
  await page.locator("#studio-about").waitFor({ state: "attached" });
}

describe("Studio application help", () => {
  it("explains experimental identity, build and local recovery limits with safe support links", async () => {
    await mount();
    await page.locator("#about").click();
    const dialog = page.getByRole("dialog", { name: "About VoxDown Studio", exact: true });
    expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.innerText()).toContain("Experimental · Built 2026-11-18 (abc1234)");
    expect(await dialog.innerText()).toContain("Clearing site data, private browsing");
    expect(await dialog.innerText()).toContain("independent copy");
    expect(await dialog.getByRole("link", { name: "MIT license" }).getAttribute("href")).toBe(
      "https://github.com/voxdown/voxdown/blob/main/LICENSE",
    );
    expect(
      await dialog
        .getByRole("link", { name: "Report a problem or suggest a feature" })
        .getAttribute("href"),
    ).toBe("https://github.com/voxdown/voxdown/issues");
    expect(
      await dialog
        .locator("a")
        .evaluateAll((links) => links.every((a) => a.getAttribute("rel")?.includes("noopener"))),
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.locator("#about").evaluate((node) => node === document.activeElement)).toBe(
      true,
    );
  });

  for (const apple of [false, true]) {
    it(`uses ${apple ? "Command" : "Control"} labels and separates optional screenplay assistance`, async () => {
      await mount(apple);
      await page.locator("#shortcuts").click();
      const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
      const labels = await dialog.locator("kbd").allTextContents();
      expect(labels.some((label) => label.startsWith(`${apple ? "⌘" : "Ctrl"}+K`))).toBe(true);
      expect(labels).toContain("Ctrl+Space");
      await dialog.getByText("Optional screenplay keys", { exact: true }).click();
      expect(await dialog.innerText()).toContain("Use screenplay Enter and Tab shortcuts");
      expect(await dialog.innerText()).toContain("Existing words are left intact");
      await dialog.getByRole("button", { name: "Close Keyboard shortcuts", exact: true }).click();
      expect(
        await page.locator("#shortcuts").evaluate((node) => node === document.activeElement),
      ).toBe(true);
    });
  }

  it("keeps phone dialogs bounded and every focused link visible below the sticky title", async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await mount();
    for (const id of ["about", "shortcuts"]) {
      await page.locator(`#${id}`).click();
      const dialog = page.locator("dialog[open]");
      expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 320 && box.height <= 536).toBe(true);
      for (let press = 0; press < 12; press++) {
        await page.keyboard.press("Tab");
        await page.evaluate(() => new Promise(requestAnimationFrame));
        // Native dialogs can yield to browser chrome, never to the page behind them.
        expect(
          await dialog.evaluate((d) => !document.hasFocus() || d.contains(document.activeElement)),
        ).toBe(true);
        const visible = await dialog.evaluate((d) => {
          if (!document.hasFocus()) return true;
          const active = document.activeElement as HTMLElement;
          const header = d.querySelector(".studio-dialog-header") as HTMLElement;
          if (header.contains(active) || active === d) return true;
          const rect = active.getBoundingClientRect();
          return (
            rect.top >= header.getBoundingClientRect().bottom &&
            rect.bottom <= d.getBoundingClientRect().bottom
          );
        });
        expect(visible).toBe(true);
      }
      await page.keyboard.press("Escape");
    }
  });
});
