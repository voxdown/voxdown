/** One non-modal preview/menu per shelf, positioned outside the scrolling side panel. */
export function scrapPopover() {
  const panel = document.createElement("div");
  panel.className = "studio-scrap-popover";
  panel.hidden = true;
  // Stay inside the workspace landmark, but outside its scrolling side panel.
  (document.querySelector("main") ?? document.body).append(panel);
  let anchor: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pinned = false;
  function close(focus = false) {
    clearTimeout(timer);
    panel.hidden = true;
    panel.replaceChildren();
    anchor?.setAttribute("aria-expanded", "false");
    if (focus && anchor?.isConnected) anchor.focus();
    anchor = undefined;
    pinned = false;
  }
  function place() {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(panel.classList.contains("is-menu") ? 220 : 420, innerWidth - 24);
    panel.style.width = `${width}px`;
    const left =
      rect.left >= width + 16
        ? rect.left - width - 8
        : Math.min(rect.left, innerWidth - width - 12);
    panel.style.left = `${Math.max(12, left)}px`;
    panel.style.top = `${Math.max(12, Math.min(rect.top, innerHeight - panel.offsetHeight - 12))}px`;
  }
  function deferClose() {
    if (!pinned) timer = setTimeout(() => close(), 180);
  }
  panel.onpointerenter = () => clearTimeout(timer);
  panel.onpointerleave = deferClose;
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (!panel.hidden && !panel.contains(target) && !anchor?.contains(target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (panel.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    if (
      panel.classList.contains("is-menu") &&
      ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  document.addEventListener("focusin", (event) => {
    if (
      !panel.hidden &&
      !panel.contains(event.target as Node) &&
      !anchor?.contains(event.target as Node)
    )
      close();
  });
  document.addEventListener(
    "scroll",
    (event) => {
      if (!panel.hidden && !panel.contains(event.target as Node)) close();
    },
    true,
  );
  window.addEventListener("resize", () => close());
  return {
    panel,
    close,
    deferClose,
    cancelClose: () => clearTimeout(timer),
    show(target: HTMLElement, content: Node, menu: boolean, persistent: boolean) {
      close();
      anchor = target;
      pinned = persistent;
      panel.classList.toggle("is-menu", menu);
      panel.setAttribute("role", menu ? "menu" : "region");
      panel.setAttribute("aria-label", menu ? "Scrap actions" : "Scrap preview");
      panel.replaceChildren(content);
      panel.hidden = false;
      target.setAttribute("aria-expanded", "true");
      place();
      if (persistent) (panel.querySelector<HTMLElement>("button") ?? panel).focus();
    },
  };
}
