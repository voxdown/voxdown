// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { menus } from "../src/writer/menu";

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
  menus(document.querySelector(".menus") as HTMLElement, (command) => ran.push(command));
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
