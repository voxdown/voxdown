// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { toolbar } from "../src/writer/toolbar";

function bar() {
  document.body.innerHTML = `
    <textarea id="story"></textarea>
    <div class="toolbar" role="toolbar" aria-label="Tools">
      <button type="button" data-command="undo" aria-label="Undo" data-keys="Mod+Z" aria-disabled="true">↶</button>
      <button type="button" data-command="who" aria-label="Who says this…" data-keys="Mod+K">Who</button>
      <button type="button" data-command="insert-pause" aria-label="Insert a pause">Pause</button>
    </div>`;
  const ran: string[] = [];
  let left = 0;
  toolbar(
    document.querySelector(".toolbar") as HTMLElement,
    (command) => ran.push(command),
    () => left++,
  );
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".toolbar button")];
  const key = (name: string) =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
  return { ran, buttons, key, left: () => left };
}

describe("the toolbar", () => {
  it("is one stop for Tab, the arrows going along it and round", () => {
    const { buttons, key } = bar();
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    buttons[0]?.focus();
    key("ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    key("End");
    expect(document.activeElement).toBe(buttons[2]);
    key("ArrowRight");
    expect(document.activeElement).toBe(buttons[0]);
    key("ArrowLeft");
    expect(document.activeElement).toBe(buttons[2]);
    key("Home");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("runs a button's command, but not one with nothing to do", () => {
    const { buttons, ran } = bar();
    buttons[1]?.click();
    buttons[0]?.click();
    expect(ran).toEqual(["who"]);
  });

  it("leaves the story its focus when clicked, and goes back to it with Escape", () => {
    const { buttons, key, left } = bar();
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    buttons[2]?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    buttons[2]?.focus();
    key("Escape");
    expect(left()).toBe(1);
  });

  it("says each button's keys to a screen reader", () => {
    const { buttons } = bar();
    expect(buttons[1]?.getAttribute("aria-keyshortcuts")).toMatch(/^(Control|Meta)\+K$/);
    expect(buttons[2]?.hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});
