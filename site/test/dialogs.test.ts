// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { addCloseButton, closeOnClickOutside } from "../src/writer/dialogs";

let dialog: HTMLDialogElement;
beforeEach(() => {
  document.body.innerHTML =
    '<dialog id="d"><form method="dialog"><h2>Go to</h2><input id="filter"></form></dialog>';
  dialog = document.querySelector("#d") as HTMLDialogElement;
  // The dialog's box: 100 to 300 across and down.
  dialog.getBoundingClientRect = () =>
    ({ left: 100, right: 300, top: 100, bottom: 300, width: 200, height: 200 }) as DOMRect;
  dialog.showModal();
});

const at = (type: string, x: number, y: number, target: Element = dialog) =>
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as PointerEvent,
  );

describe("a dialog's ×", () => {
  it("closes it as Cancel does, and comes last for the keys", () => {
    const close = addCloseButton(dialog);
    expect(dialog.lastElementChild).toBe(close);
    expect(close.getAttribute("aria-label")).toBe("Close");
    close.click();
    expect(dialog.open).toBe(false);
    expect(dialog.returnValue).toBe("cancel");
  });
});

describe("a click outside a dialog", () => {
  it("closes it", () => {
    closeOnClickOutside(dialog);
    at("pointerdown", 20, 20);
    at("click", 20, 20);
    expect(dialog.open).toBe(false);
    expect(dialog.returnValue).toBe("cancel");
  });

  it("never closes it from inside, or for a drag let go outside", () => {
    closeOnClickOutside(dialog);
    at("pointerdown", 150, 150);
    at("click", 150, 150);
    expect(dialog.open).toBe(true);
    // Pressed in its field, let go beyond it.
    const field = document.querySelector("#filter") as HTMLElement;
    at("pointerdown", 150, 150, field);
    at("click", 20, 20);
    expect(dialog.open).toBe(true);
  });

  it("leaves it open while closing would lose something", () => {
    let busy = true;
    closeOnClickOutside(dialog, () => !busy);
    at("pointerdown", 20, 20);
    at("click", 20, 20);
    expect(dialog.open).toBe(true);
    busy = false;
    at("pointerdown", 20, 20);
    at("click", 20, 20);
    expect(dialog.open).toBe(false);
  });
});
