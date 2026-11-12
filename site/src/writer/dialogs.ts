/**
 * How the Writer's dialogs close, all the same way: Escape (the browser's own), a × at the top
 * right, and, where closing can lose nothing, a click outside. Each closes as Cancel does: what
 * the dialog would have changed stays as it was.
 */

/** The × at the top right: last in the order of the keys, so it is never what a dialog opens on. */
export function addCloseButton(dialog: HTMLDialogElement): HTMLButtonElement {
  const close = document.createElement("button");
  close.type = "button";
  close.className = "dialog-close";
  close.setAttribute("aria-label", "Close");
  close.title = "Close (Esc)";
  close.textContent = "×";
  close.addEventListener("click", () => dialog.close("cancel"));
  dialog.append(close);
  return close;
}

/**
 * A click outside the dialog closes it, where `may` says closing loses nothing now. Pressed and
 * let go outside, both: a selection dragged out of a field and let go beyond it doesn't close it.
 */
export function closeOnClickOutside(dialog: HTMLDialogElement, may: () => boolean = () => true) {
  // A modal dialog's backdrop is the dialog itself, beyond its box.
  const outside = (event: MouseEvent) => {
    if (event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };
  let pressed = false;
  dialog.addEventListener("pointerdown", (event) => {
    pressed = outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (pressed && outside(event) && dialog.open && may()) dialog.close("cancel");
    pressed = false;
  });
}
