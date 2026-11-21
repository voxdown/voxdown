/** Menu bar: disclosure buttons with arrow-key navigation, checkmarks and shortcut labels. */
export type MenuItem =
  | {
      label: string;
      run: () => void;
      shortcut?: string;
      checked?: () => boolean;
      enabled?: () => boolean;
      id?: string;
    }
  | {
      label: string;
      /** A submenu, opened with →, Enter or a click, closed with ← or Escape. */
      submenu: () => MenuItem[];
      id?: string;
    }
  | "-"
  | { heading: string };

const apple =
  typeof navigator !== "undefined" &&
  /Mac|iPad|iPhone|iPod/.test(`${navigator.platform} ${navigator.userAgent}`);

/** "Mod Shift Enter" → "Ctrl+Shift+Enter" or "⌘⇧↩". */
export function shortcutLabel(value: string): string {
  if (apple)
    return value
      .replace(/Mod\s*/g, "⌘")
      .replace(/Alt\s*/g, "⌥")
      .replace(/Shift\s*/g, "⇧")
      .replace(/Enter/g, "↩")
      .replace(/\s+/g, "");
  return value.replace(/Mod/g, "Ctrl").trim().replace(/\s+/g, "+");
}

export function mountMenus(
  buttons: HTMLButtonElement[],
  definitions: Record<string, () => MenuItem[]>,
) {
  let open: { button: HTMLButtonElement; panel: HTMLElement } | null = null;
  let child: { entry: HTMLButtonElement; panel: HTMLElement } | null = null;
  const closeChild = (focusEntry = false) => {
    if (!child) return;
    const { entry, panel } = child;
    panel.remove();
    entry.setAttribute("aria-expanded", "false");
    child = null;
    if (focusEntry) entry.focus();
  };
  const close = (focusButton = false) => {
    closeChild();
    if (!open) return;
    const { button, panel } = open;
    panel.remove();
    button.setAttribute("aria-expanded", "false");
    open = null;
    if (focusButton) button.focus();
  };
  const items = (panel: HTMLElement) => [
    ...panel.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)"),
  ];
  const navigate = (event: KeyboardEvent, panel: HTMLElement): boolean => {
    const entries = items(panel);
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      (event.key === "Home" ? entries[0] : entries[entries.length - 1])?.focus();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const starts = (entry: HTMLButtonElement) =>
        entry.querySelector(".menu-label")?.textContent?.toLowerCase().startsWith(letter);
      (
        entries.find((entry, index) => index > at && starts(entry)) ?? entries.find(starts)
      )?.focus();
      return true;
    } else return false;
    event.preventDefault();
    return true;
  };
  /** Fills a panel with entries; returns the submenu openers. */
  const fill = (panel: HTMLElement, list: MenuItem[], focusButton: () => void) => {
    for (const item of list) {
      if (item === "-") {
        panel.append(document.createElement("hr"));
        continue;
      }
      if ("heading" in item) {
        const heading = document.createElement("p");
        heading.className = "menu-heading";
        heading.textContent = item.heading;
        panel.append(heading);
        continue;
      }
      const entry = document.createElement("button");
      entry.type = "button";
      entry.tabIndex = -1;
      if (item.id) entry.dataset.item = item.id;
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = item.label;
      const check = document.createElement("span");
      check.className = "menu-check";
      check.setAttribute("aria-hidden", "true");
      if ("submenu" in item) {
        entry.setAttribute("role", "menuitem");
        entry.setAttribute("aria-haspopup", "menu");
        entry.setAttribute("aria-expanded", "false");
        const more = document.createElement("span");
        more.className = "menu-shortcut";
        more.setAttribute("aria-hidden", "true");
        more.textContent = "▸";
        entry.append(check, label, more);
        const openChild = (focusFirst: boolean) => {
          if (child?.entry === entry) {
            if (focusFirst) items(child.panel)[0]?.focus();
            return;
          }
          closeChild();
          const sub = document.createElement("div");
          sub.className = "workspace-dropdown workspace-submenu";
          sub.setAttribute("role", "menu");
          sub.setAttribute("aria-label", item.label);
          fill(sub, item.submenu(), focusButton);
          document.body.append(sub);
          const rect = entry.getBoundingClientRect();
          const right = rect.right + 2;
          sub.style.left = `${right + sub.offsetWidth > window.innerWidth - 8 ? Math.max(8, rect.left - sub.offsetWidth - 2) : right}px`;
          sub.style.top = `${Math.max(8, Math.min(rect.top - 5, window.innerHeight - sub.offsetHeight - 8))}px`;
          entry.setAttribute("aria-expanded", "true");
          child = { entry, panel: sub };
          sub.addEventListener("keydown", (event) => {
            if (navigate(event, sub)) return;
            if (event.key === "ArrowLeft" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeChild(true);
            } else if (event.key === "Tab") close();
          });
          if (focusFirst) items(sub)[0]?.focus();
        };
        entry.addEventListener("click", () => openChild(true));
        entry.addEventListener("pointerenter", () => openChild(false));
        entry.addEventListener("keydown", (event) => {
          if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            openChild(true);
          }
        });
        panel.append(entry);
        continue;
      }
      const checked = item.checked?.();
      entry.setAttribute("role", checked === undefined ? "menuitem" : "menuitemcheckbox");
      if (checked !== undefined) entry.setAttribute("aria-checked", String(checked));
      check.textContent = checked === undefined ? "" : "✓";
      entry.append(check, label);
      if (item.shortcut) {
        const shortcut = document.createElement("span");
        shortcut.className = "menu-shortcut";
        shortcut.textContent = shortcutLabel(item.shortcut);
        entry.append(shortcut);
        entry.setAttribute(
          "aria-keyshortcuts",
          item.shortcut.replace(/Mod/g, apple ? "Meta" : "Control").replace(/\s+/g, "+"),
        );
      }
      entry.disabled = item.enabled ? !item.enabled() : false;
      entry.addEventListener("pointerenter", () => {
        if (child && child.panel !== panel) closeChild();
      });
      entry.addEventListener("click", () => {
        close();
        focusButton();
        item.run();
      });
      panel.append(entry);
    }
  };
  const show = (button: HTMLButtonElement, focus: "first" | "last" | "none" = "none") => {
    close();
    const name = button.dataset.menu as string;
    const panel = document.createElement("div");
    panel.className = "workspace-dropdown";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", button.textContent ?? name);
    panel.id = `${name}-dropdown`;
    fill(panel, definitions[name]?.() ?? [], () => button.focus());
    document.body.append(panel);
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${rect.bottom + 4}px`;
    button.setAttribute("aria-expanded", "true");
    open = { button, panel };
    const list = items(panel);
    if (focus === "first") list[0]?.focus();
    if (focus === "last") list[list.length - 1]?.focus();
    panel.addEventListener("keydown", (event) => {
      if (navigate(event, panel)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const visible = buttons.filter((each) => each.offsetParent !== null);
        const index = visible.indexOf(button);
        const next =
          visible[
            (index + (event.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length
          ];
        if (next) show(next, "first");
        next?.focus();
        (open as { panel: HTMLElement } | null)?.panel
          .querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus();
      } else if (event.key === "Tab") close();
    });
  };
  // How the open menu was opened: a click on its title closes it only if a click opened it.
  let openedBy: "hover" | "click" | "key" = "click";
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (open?.button === button && openedBy !== "hover") close();
      else if (open?.button !== button) show(button, "none");
      openedBy = "click";
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show(button, "first");
        openedBy = "key";
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        show(button, "last");
        openedBy = "key";
      }
    });
    button.addEventListener("pointerenter", () => {
      if (open && open.button !== button) {
        show(button, "none");
        openedBy = "hover";
      }
    });
  }
  // Escape closes a menu opened with the mouse too (focus is then on its title, not in it).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    if (child) closeChild(true);
    else close(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!open) return;
    const target = event.target as Node;
    if (
      !open.panel.contains(target) &&
      !open.button.contains(target) &&
      !child?.panel.contains(target)
    )
      close();
  });
  window.addEventListener("resize", () => close());
  return { close, isOpen: () => open !== null };
}

/** A small dropdown anchored to a button (decorations, instrument), using the same look. */
export function popupMenu(anchor: HTMLElement, items: MenuItem[], onClose?: () => void) {
  const panel = document.createElement("div");
  panel.className = "workspace-dropdown";
  panel.setAttribute("role", "menu");
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    if (item === "-") {
      panel.append(document.createElement("hr"));
      continue;
    }
    if ("heading" in item) {
      const heading = document.createElement("p");
      heading.className = "menu-heading";
      heading.textContent = item.heading;
      panel.append(heading);
      continue;
    }
    if ("submenu" in item) continue;
    const entry = document.createElement("button");
    entry.type = "button";
    entry.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = item.label;
    entry.append(label);
    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "menu-shortcut";
      shortcut.textContent = item.shortcut;
      entry.append(shortcut);
    }
    entry.addEventListener("click", () => {
      finish();
      item.run();
    });
    buttons.push(entry);
    panel.append(entry);
  }
  document.body.append(panel);
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
  const below = rect.bottom + 4 + panel.offsetHeight < window.innerHeight;
  panel.style.top = below
    ? `${rect.bottom + 4}px`
    : `${Math.max(8, rect.top - panel.offsetHeight - 4)}px`;
  buttons[0]?.focus();
  const outside = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) finish();
  };
  function finish() {
    panel.remove();
    document.removeEventListener("pointerdown", outside);
    onClose?.();
  }
  panel.addEventListener("keydown", (event) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      buttons[
        (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      finish();
      anchor.focus();
    }
  });
  setTimeout(() => document.addEventListener("pointerdown", outside), 0);
  return finish;
}
