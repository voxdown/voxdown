// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { menus } from "../src/writer/menu";

// Each test's bar closed before the next: the page has one, which listens on the document.
const bars: { close: () => void }[] = [];
afterEach(() => {
  for (const bar of bars.splice(0)) bar.close();
});

function bar() {
  document.body.innerHTML = `
    <div class="menus" role="menubar">
      <div class="menu">
        <button class="menu-button" role="menuitem" id="file-button" aria-controls="file" aria-expanded="false">File</button>
        <div class="menu-list" role="menu" id="file" hidden>
          <button role="menuitem" data-command="new">New story</button>
          <div class="submenu" role="none">
            <button role="menuitem" id="recent-button" aria-haspopup="menu" aria-expanded="false" aria-controls="recent">Open recent</button>
            <div class="menu-list submenu-list" role="menu" id="recent" hidden>
              <button role="menuitem" data-command="recent:0">One.vxd</button>
              <button role="menuitem" data-command="recent:1">Two.vxd</button>
            </div>
          </div>
          <button role="menuitem" data-command="save">Save</button>
        </div>
      </div>
    </div>`;
  const ran: string[] = [];
  bars.push(menus(document.querySelector(".menus") as HTMLElement, (command) => ran.push(command)));
  const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
  const key = (target: HTMLElement, name: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  return { ran, $, key };
}

describe("a menu inside a menu", () => {
  it("opens with the right arrow and goes back with the left, its items out of the outer menu's way", () => {
    const { $, key } = bar();
    key($("#file-button"), "ArrowDown");
    expect(document.activeElement?.textContent).toBe("New story");
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.id).toBe("recent-button");
    // Its own items aren't the outer menu's: down from it goes to Save.
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Save");
    key(document.activeElement as HTMLElement, "ArrowUp");
    key(document.activeElement as HTMLElement, "ArrowRight");
    expect($("#recent").hidden).toBe(false);
    expect($("#recent-button").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("One.vxd");
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Two.vxd");
    key(document.activeElement as HTMLElement, "ArrowLeft");
    expect($("#recent").hidden).toBe(true);
    expect(document.activeElement?.id).toBe("recent-button");
    // The outer menu is still open.
    expect($("#file").hidden).toBe(false);
  });

  it("stays open when the pointer, which opened it on the way in, clicks its item", () => {
    const { $, key } = bar();
    key($("#file-button"), "ArrowDown");
    $("#recent-button").dispatchEvent(new Event("pointerenter"));
    expect($("#recent").hidden).toBe(false);
    // A click of the pointer (detail 1): it closed the menu the pointer had just opened.
    $("#recent-button").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect($("#recent").hidden).toBe(false);
    // From the keys (detail 0), it opens and closes.
    $("#recent-button").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect($("#recent").hidden).toBe(true);
  });

  it("runs a choice in it, and closes every menu", () => {
    const { $, key, ran } = bar();
    key($("#file-button"), "ArrowDown");
    $("#recent-button").click();
    expect($("#recent").hidden).toBe(false);
    ($("#recent").lastElementChild as HTMLElement).click();
    expect(ran).toEqual(["recent:1"]);
    expect($("#file").hidden).toBe(true);
    expect($("#recent").hidden).toBe(true);
  });
});

/** The Writer's own menu bar, as the page has it. */
function realBar() {
  const page = readFileSync(join(__dirname, "..", "writer", "index.html"), "utf8");
  const bar = /<div class="menus"[\s\S]*?<\/div>\n {2}<div class="document">/.exec(page)?.[0] ?? "";
  document.body.innerHTML = bar.replace(/\n {2}<div class="document">$/, "");
  const ran: string[] = [];
  bars.push(menus(document.querySelector(".menus") as HTMLElement, (command) => ran.push(command)));
  return ran;
}

describe("the Writer's menu bar, from the keyboard", () => {
  it.each(["file", "edit", "insert", "view", "help"])(
    "reaches every item of %s once, in order, with the down arrow",
    (name) => {
      realBar();
      const button = document.getElementById(`${name}-menu-button`) as HTMLElement;
      const list = document.getElementById(`${name}-menu`) as HTMLElement;
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      // Its own items, shown: not those of the menu inside it, nor Open recent with none.
      const expected = [...list.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
        (item) =>
          !item.closest("[hidden]") && item.parentElement?.closest('[role="menu"]') === list,
      );
      expect(expected.length).toBeGreaterThan(3);
      const reached = [document.activeElement];
      for (let step = 1; step < expected.length + 1; step++) {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
        reached.push(document.activeElement);
      }
      // Each once, in order, and round to the first.
      expect(reached).toEqual([...expected, expected[0]]);
      expect(document.querySelectorAll(".menu-list:not([hidden])").length).toBe(1);
    },
  );

  it("opens no menu when the pointer only passes over the bar", () => {
    realBar();
    for (const button of document.querySelectorAll<HTMLElement>(".menu-button"))
      button.dispatchEvent(new PointerEvent("pointerenter"));
    expect(document.querySelectorAll(".menu-list:not([hidden])").length).toBe(0);
    expect(document.querySelectorAll('.menu-button[aria-expanded="true"]').length).toBe(0);
  });

  it("closes with Escape, back on its button", () => {
    realBar();
    const button = document.getElementById("view-menu-button") as HTMLElement;
    button.click();
    expect((document.getElementById("view-menu") as HTMLElement).hidden).toBe(false);
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect((document.getElementById("view-menu") as HTMLElement).hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });
});
