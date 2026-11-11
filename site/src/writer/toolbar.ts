/**
 * The toolbar: what a writer reaches for most, one click away. Its buttons run the menus'
 * commands by their `data-command`. A click leaves the cursor where it was in the story, as the
 * menus' keys do. The bar is one stop for Tab, the arrow keys moving along it (Home and End to its
 * ends), Escape going back to the text. Each button's name and keys show under it a moment after
 * the pointer rests on it, or at once when the keyboard comes to it.
 */
import { keys } from "./menu";

export function toolbar(
  bar: HTMLElement,
  onCommand: (command: string, button: HTMLElement) => void,
  onLeave: () => void = () => {},
): void {
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>("button[data-command]")];
  const shown = () => buttons.filter((button) => !button.closest("[hidden]"));
  const current = (button: HTMLButtonElement) => {
    for (const other of buttons) other.tabIndex = other === button ? 0 : -1;
  };
  if (buttons[0]) current(buttons[0]);

  const tip = document.createElement("div");
  tip.className = "tool-tip";
  tip.setAttribute("aria-hidden", "true");
  tip.hidden = true;
  // On the page, not in the bar: a narrow window scrolls the bar, which would cut it off.
  document.body.append(tip);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  /** When a tip last went: the next comes at once while the pointer moves along the bar. */
  let tipGone = 0;
  const showTip = (button: HTMLButtonElement) => {
    clearTimeout(tipTimer);
    const shortcut = button.dataset.keys;
    // Its name as a tip says it: without the "…" a menu puts after what asks for more.
    tip.replaceChildren((button.getAttribute("aria-label") ?? "").replace(/…$/, ""));
    if (shortcut) {
      const kbd = document.createElement("kbd");
      kbd.textContent = keys(shortcut);
      tip.append(kbd);
    }
    tip.hidden = false;
    const box = button.getBoundingClientRect();
    const width = tip.offsetWidth;
    const left = Math.min(
      Math.max(4, box.left + box.width / 2 - width / 2),
      window.innerWidth - width - 4,
    );
    tip.style.left = `${left}px`;
    tip.style.top = `${box.bottom + 6}px`;
  };
  const hideTip = () => {
    clearTimeout(tipTimer);
    if (!tip.hidden) tipGone = Date.now();
    tip.hidden = true;
  };

  for (const button of buttons) {
    const shortcut = button.dataset.keys;
    if (shortcut)
      button.setAttribute(
        "aria-keyshortcuts",
        shortcut.replace("Mod", /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"),
      );
    // The story keeps the focus, and its selection, for a click: as in any writing app.
    button.addEventListener("pointerdown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    button.addEventListener("click", () => {
      hideTip();
      if (button.getAttribute("aria-disabled") === "true") return;
      current(button);
      onCommand(button.dataset.command ?? "", button);
    });
    button.addEventListener("pointerenter", () => {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(button), Date.now() - tipGone < 600 ? 0 : 450);
    });
    button.addEventListener("pointerleave", hideTip);
    button.addEventListener("focus", () => {
      current(button);
      if (button.matches(":focus-visible")) showTip(button);
    });
    button.addEventListener("blur", hideTip);
  }

  bar.addEventListener("scroll", hideTip, { passive: true });
  bar.addEventListener("keydown", (event) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const visible = shown();
    const here = visible.indexOf(buttons[at] as HTMLButtonElement);
    const go = (index: number) => {
      const next = visible[(index + visible.length) % visible.length];
      if (!next) return;
      event.preventDefault();
      current(next);
      next.focus();
    };
    if (event.key === "ArrowRight") go(here + 1);
    else if (event.key === "ArrowLeft") go(here - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(visible.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      hideTip();
      onLeave();
    }
  });
}
