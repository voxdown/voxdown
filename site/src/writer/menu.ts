/**
 * The menu bar: a button opens its list; arrow keys move through it and to the next menu; Escape,
 * a click outside or a choice closes it. Items run commands by their `data-command`; check items
 * (`role="menuitemcheckbox"`) flip and tell the page. The bar is one stop for Tab, the arrow keys
 * moving along it; Escape on the bar goes back to the text (`onLeave`). An item can open a menu of
 * its own (`aria-haspopup`, Open recent): the right arrow, Enter or the pointer opens it, the left
 * arrow or Escape goes back.
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
  onLeave: () => void = () => {},
): { close: () => void } {
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>(".menu-button")];
  // One stop for Tab: the button last used.
  const current = (button: HTMLButtonElement) => {
    for (const other of buttons) other.tabIndex = other === button ? 0 : -1;
  };
  if (buttons[0]) current(buttons[0]);
  for (const button of buttons) button.addEventListener("focus", () => current(button));
  const listOf = (button: HTMLButtonElement) =>
    document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
  // A menu's own items: not those of a menu inside it.
  const items = (list: HTMLElement) =>
    [...list.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (item) => !item.closest("[hidden]") && item.parentElement?.closest('[role="menu"]') === list,
    );
  let open: HTMLButtonElement | undefined;
  /** The item whose own menu is open, if one is. */
  let opened: HTMLElement | undefined;
  const subOf = (item: HTMLElement) =>
    document.getElementById(item.getAttribute("aria-controls") ?? "") as HTMLElement | null;
  const closeSub = (focus = false) => {
    if (!opened) return;
    const sub = subOf(opened);
    if (sub) sub.hidden = true;
    opened.setAttribute("aria-expanded", "false");
    if (focus) opened.focus();
    opened = undefined;
  };
  const showSub = (item: HTMLElement, focusFirst: boolean) => {
    if (opened && opened !== item) closeSub();
    const sub = subOf(item);
    if (!sub) return;
    sub.hidden = false;
    item.setAttribute("aria-expanded", "true");
    opened = item;
    // Beside its item (fixed, so the scrolling menu it is in doesn't cut it off), or on the
    // other side where the window ends; on a phone, under it, in the menu (the stylesheet's).
    sub.style.left = "";
    sub.style.top = "";
    if (getComputedStyle(sub).position === "fixed") {
      const at = item.getBoundingClientRect();
      const width = sub.offsetWidth;
      const left = at.right + width + 4 > window.innerWidth ? at.left - width - 2 : at.right + 2;
      sub.style.left = `${Math.max(4, left)}px`;
      sub.style.top = `${Math.max(4, Math.min(at.top - 4, window.innerHeight - sub.offsetHeight - 4))}px`;
    }
    if (focusFirst) items(sub)[0]?.focus();
  };
  // Items with a menu of their own, inside the menus: not the bar's own buttons, which open theirs.
  for (const item of bar.querySelectorAll<HTMLElement>(
    '.menu-list [aria-haspopup="menu"][role="menuitem"]',
  )) {
    const sub = subOf(item);
    if (!sub) continue;
    // The pointer crossing the gap between the item and its menu doesn't close it.
    let leaving: ReturnType<typeof setTimeout> | undefined;
    item.parentElement?.addEventListener("pointerenter", () => clearTimeout(leaving));
    item.addEventListener("pointerenter", () => showSub(item, false));
    item.parentElement?.addEventListener("pointerleave", () => {
      clearTimeout(leaving);
      leaving = setTimeout(() => {
        if (opened === item && !item.parentElement?.contains(document.activeElement)) closeSub();
      }, 300);
    });
    sub.addEventListener("keydown", (event) => {
      const all = items(sub);
      const at = all.indexOf(document.activeElement as HTMLElement);
      const step = (by: number) => all[(at + by + all.length) % all.length]?.focus();
      if (event.key === "ArrowDown") step(1);
      else if (event.key === "ArrowUp") step(-1);
      else if (event.key === "Home") all[0]?.focus();
      else if (event.key === "End") all.at(-1)?.focus();
      else if (event.key === "ArrowLeft" || event.key === "Escape") closeSub(true);
      else if (event.key === "Tab") {
        closeSub();
        close();
        return;
      } else return;
      // The menu it is in doesn't take the key too.
      event.preventDefault();
      event.stopPropagation();
    });
  }

  for (const kbd of bar.querySelectorAll<HTMLElement>("kbd[data-keys]")) {
    kbd.textContent = keys(kbd.dataset.keys ?? "");
  }

  const close = (focus = false) => {
    if (!open) return;
    closeSub();
    listOf(open).hidden = true;
    open.setAttribute("aria-expanded", "false");
    if (focus) open.focus();
    open = undefined;
  };
  const show = (button: HTMLButtonElement, first: "first" | "last" | null) => {
    if (open !== button) close();
    const list = listOf(button);
    // Where it opens, so that it scrolls within the window rather than running past it.
    list.style.setProperty(
      "--menu-top",
      `${Math.round(button.getBoundingClientRect().bottom + 6)}px`,
    );
    list.hidden = false;
    // Never past the window's right edge: moved left as far as it needs.
    list.style.left = "";
    const right = list.getBoundingClientRect().right;
    if (right > window.innerWidth - 4) list.style.left = `${window.innerWidth - 4 - right}px`;
    button.setAttribute("aria-expanded", "true");
    open = button;
    const all = items(list);
    if (first) (first === "first" ? all[0] : all.at(-1))?.focus({ preventScroll: false });
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
      } else if (event.key === "Escape" && !open) {
        event.preventDefault();
        onLeave();
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
      // An item with a menu of its own opens it.
      if (item.getAttribute("aria-haspopup") === "menu") {
        if (opened === item) closeSub();
        else showSub(item, event.detail === 0);
        return;
      }
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
        case "ArrowRight": {
          const here = all[at];
          if (here?.getAttribute("aria-haspopup") === "menu") showSub(here, true);
          else across(1);
          break;
        }
        case "ArrowLeft":
          across(-1);
          break;
        case "Escape":
          close(true);
          break;
        case "Enter":
        case " ": {
          const here = all[at];
          if (here?.getAttribute("aria-haspopup") !== "menu") return;
          showSub(here, true);
          break;
        }
        case "Tab":
          close();
          return;
        default: {
          // A letter goes to the next item that starts with it.
          if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
          const letter = event.key.toLowerCase();
          const starts = (item: HTMLElement) =>
            (item.textContent ?? "").trim().toLowerCase().startsWith(letter);
          const next =
            all.slice(at + 1).find(starts) ?? all.slice(0, Math.max(0, at + 1)).find(starts);
          if (!next) return;
          next.focus();
          break;
        }
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
        // From a menu inside a menu, back to the item that opened it; else the menu closes.
        if (opened) closeSub(true);
        else close(true);
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
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        (event.key === "Home" ? buttons[0] : buttons.at(-1))?.focus();
        return;
      }
      const by = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!by) return;
      event.preventDefault();
      buttons[(buttons.indexOf(button) + by + buttons.length) % buttons.length]?.focus();
    });
  }
  return { close: () => close() };
}
