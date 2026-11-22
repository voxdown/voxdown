import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const code = transpileModule(
  readFileSync(new URL("../src/studio/drop-files.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText;
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
  page = await browser.newPage();
  await page.setContent(
    '<div id="editor" contenteditable="true">Draft</div><input type="file"><dialog><button>Close</button></dialog>',
  );
  await page.addScriptTag({
    type: "module",
    content: `${code}
  window.opened=[]; window.notices=[]; window.locked=false;
  window.dispose=mountFileDrop(document,{open:f=>window.opened.push(f.name),notice:m=>window.notices.push(m),locked:()=>window.locked});`,
  });
  await page.waitForFunction("window.dispose");
});
async function event(
  type: "drop" | "dragover",
  names: string[],
  target = "#editor",
  text?: string,
) {
  return page.evaluate(
    ({ type, names, target, text }) => {
      const transfer = new DataTransfer();
      for (const name of names)
        transfer.items.add(new File(["INT. HOME"], name, { type: "text/plain" }));
      if (text) transfer.setData("text/plain", text);
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      document.querySelector(target)?.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        opened: Reflect.get(window, "opened"),
        notices: Reflect.get(window, "notices"),
        editor: document.querySelector("#editor")?.textContent,
      };
    },
    { type, names, target, text },
  );
}
describe("safe screenplay file drops", () => {
  it("opens one Fountain/text file and prevents navigation or editor insertion", async () => {
    expect((await event("dragover", ["Scene.fountain"])).prevented).toBe(true);
    const dropped = await event("drop", ["Scene.fountain"]);
    expect(dropped).toMatchObject({ prevented: true, opened: ["Scene.fountain"], editor: "Draft" });
    expect((await event("drop", ["SCENE.TXT"])).opened).toEqual(["Scene.fountain", "SCENE.TXT"]);
  });
  it("rejects multiple and unsupported files without opening a partial selection", async () => {
    expect((await event("drop", ["One.fountain", "Two.txt"])).opened).toEqual([]);
    const dropped = await event("drop", ["Project.json"]);
    expect(dropped.prevented).toBe(true);
    expect(dropped.opened).toEqual([]);
    expect(dropped.notices).toHaveLength(2);
  });
  it("leaves plain text dragging untouched", async () => {
    expect((await event("dragover", [], "#editor", "Text")).prevented).toBe(false);
    expect((await event("drop", [], "#editor", "Text")).prevented).toBe(false);
  });
  it("guards loading and open dialogs but preserves native file input drops", async () => {
    await page.evaluate(() => Reflect.set(window, "locked", true));
    expect((await event("drop", ["One.fountain"])).opened).toEqual([]);
    await page.evaluate(() => {
      Reflect.set(window, "locked", false);
      document.querySelector("dialog")?.showModal();
    });
    expect((await event("drop", ["One.fountain"])).opened).toEqual([]);
    expect((await event("drop", ["One.fountain"], "input")).prevented).toBe(false);
  });
  it("removes both capture listeners on disposal", async () => {
    await page.evaluate(() => Reflect.get(window, "dispose")());
    expect((await event("dragover", ["One.fountain"])).prevented).toBe(false);
    expect((await event("drop", ["One.fountain"])).prevented).toBe(false);
  });
});
