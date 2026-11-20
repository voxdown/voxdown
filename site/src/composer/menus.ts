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
  const close = (focusButton = false) => {
    if (!open) return;
    const { button, panel } = open;
    panel.remove();
    button.setAttribute("aria-expanded", "false");
    open = null;
    if (focusButton) button.focus();
  };
  const items = (panel: HTMLElement) => [
    ...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
  const show = (button: HTMLButtonElement, focus: "first" | "last" | "none" = "none") => {
    close();
    const name = button.dataset.menu as string;
    const panel = document.createElement("div");
    panel.className = "workspace-dropdown";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", button.textContent ?? name);
    panel.id = `${name}-dropdown`;
    for (const item of definitions[name]?.() ?? []) {
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
      const checked = item.checked?.();
      entry.setAttribute("role", checked === undefined ? "menuitem" : "menuitemcheckbox");
      if (checked !== undefined) entry.setAttribute("aria-checked", String(checked));
      const check = document.createElement("span");
      check.className = "menu-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = checked === undefined ? "" : "✓";
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = item.label;
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
      entry.addEventListener("click", () => {
        close(true);
        item.run();
      });
      panel.append(entry);
    }
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
      const entries = items(panel);
      const at = entries.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        entries[(at + step + entries.length) % entries.length]?.focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        (event.key === "Home" ? entries[0] : entries[entries.length - 1])?.focus();
      } else if (event.key === "Escape") {
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
      else if (event.key.length === 1 && /\S/.test(event.key)) {
        const letter = event.key.toLowerCase();
        const match =
          entries.find(
            (entry, index) =>
              index > at &&
              entry.querySelector(".menu-label")?.textContent?.toLowerCase().startsWith(letter),
          ) ??
          entries.find((entry) =>
            entry.querySelector(".menu-label")?.textContent?.toLowerCase().startsWith(letter),
          );
        match?.focus();
      }
    });
  };
  for (const button of buttons) {
    button.addEventListener("click", () =>
      open?.button === button ? close() : show(button, "none"),
    );
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show(button, "first");
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        show(button, "last");
      }
    });
    button.addEventListener("pointerenter", () => {
      if (open && open.button !== button) show(button, "none");
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (!open) return;
    const target = event.target as Node;
    if (!open.panel.contains(target) && !open.button.contains(target)) close();
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
