/**
 * The menu bar: a button opens its list; arrow keys move through it and to the next menu; Escape,
 * a click outside or a choice closes it. Items run commands by their `data-command`; check items
 * (`role="menuitemcheckbox"`) flip and tell the page.
 */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** `Mod+Shift+S` as this computer writes it: `Ctrl+Shift+S`, or `⇧⌘S` on a Mac. */
export function keys(spec: string): string {
  const parts = spec.split("+");
  if (!isMac) return parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
  const symbols: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
  return parts.map((part) => symbols[part] ?? part).join("");
}

export function menus(
  bar: HTMLElement,
  onCommand: (command: string, item: HTMLElement) => void,
): { close: () => void } {
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>(".menu-button")];
  const listOf = (button: HTMLButtonElement) =>
    document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
  const items = (list: HTMLElement) =>
    [...list.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (item) => !item.closest("[hidden]"),
    );
  let open: HTMLButtonElement | undefined;

  for (const kbd of bar.querySelectorAll<HTMLElement>("kbd[data-keys]")) {
    kbd.textContent = keys(kbd.dataset.keys ?? "");
  }

  const close = (focus = false) => {
    if (!open) return;
    listOf(open).hidden = true;
    open.setAttribute("aria-expanded", "false");
    if (focus) open.focus();
    open = undefined;
  };
  const show = (button: HTMLButtonElement, first: "first" | "last" | null) => {
    if (open !== button) close();
    const list = listOf(button);
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    open = button;
    const all = items(list);
    if (first) (first === "first" ? all[0] : all.at(-1))?.focus();
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (open === button) close();
      else show(button, null);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show(button, "first");
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        show(button, "last");
      }
    });
    // Moving from one open menu's button to another opens that one, as menu bars do.
    button.addEventListener("pointerenter", () => {
      if (open && open !== button) show(button, null);
    });
    const list = listOf(button);
    list.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
      if (!item || item.getAttribute("aria-disabled") === "true") return;
      // A link goes where it goes; the menu just closes behind it.
      if (item instanceof HTMLAnchorElement) {
        close();
        return;
      }
      if (item.getAttribute("role") === "menuitemcheckbox") {
        item.setAttribute("aria-checked", String(item.getAttribute("aria-checked") !== "true"));
      }
      close(true);
      onCommand(item.dataset.command ?? item.dataset.view ?? "", item);
    });
    list.addEventListener("keydown", (event) => {
      const all = items(list);
      const at = all.indexOf(document.activeElement as HTMLElement);
      const step = (by: number) => all[(at + by + all.length) % all.length]?.focus();
      const across = (by: number) => {
        const next = buttons[(buttons.indexOf(button) + by + buttons.length) % buttons.length];
        if (next) show(next, "first");
      };
      switch (event.key) {
        case "ArrowDown":
          step(1);
          break;
        case "ArrowUp":
          step(-1);
          break;
        case "Home":
          all[0]?.focus();
          break;
        case "End":
          all.at(-1)?.focus();
          break;
        case "ArrowRight":
          across(1);
          break;
        case "ArrowLeft":
          across(-1);
          break;
        case "Escape":
          close(true);
          break;
        case "Tab":
          close();
          return;
        default:
          return;
      }
      event.preventDefault();
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (open && !(event.target as HTMLElement).closest(".menu")) close();
  });
  // Escape closes a menu however it was opened; F10 goes to the menu bar, as in a desktop app.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close(true);
      } else if (event.key === "F10" && !event.shiftKey) {
        event.preventDefault();
        if (open) close(true);
        else buttons[0]?.focus();
      }
    },
    true,
  );
  // Left and right move along the bar itself, as they do inside an open menu.
  for (const button of buttons) {
    button.addEventListener("keydown", (event) => {
      const by = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!by) return;
      event.preventDefault();
      buttons[(buttons.indexOf(button) + by + buttons.length) % buttons.length]?.focus();
    });
  }
  return { close: () => close() };
}
