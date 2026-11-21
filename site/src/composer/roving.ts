/**
 * One Tab stop for a row of controls: arrows move inside it, Home and End go to the ends, and
 * the last control used keeps the stop. Disabled and hidden controls are skipped.
 */
export function roving(
  container: HTMLElement,
  selector: string,
  options: { vertical?: boolean } = {},
) {
  const usable = () =>
    [...container.querySelectorAll<HTMLElement>(selector)].filter(
      (element) =>
        !(element as HTMLButtonElement).disabled &&
        element.getClientRects().length > 0 &&
        !element.closest("[hidden], [inert]"),
    );
  let current: HTMLElement | null = null;
  const refresh = () => {
    const list = usable();
    if (!current || !list.includes(current)) current = list[0] ?? null;
    for (const element of container.querySelectorAll<HTMLElement>(selector))
      element.tabIndex = element === current ? 0 : -1;
  };
  container.addEventListener("focusin", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(selector);
    if (target && container.contains(target)) {
      current = target;
      refresh();
    }
  });
  container.addEventListener("keydown", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(selector);
    if (!target || target !== document.activeElement) return;
    const next = options.vertical ? "ArrowDown" : "ArrowRight";
    const previous = options.vertical ? "ArrowUp" : "ArrowLeft";
    const list = usable();
    const at = list.indexOf(target);
    let to: HTMLElement | undefined;
    if (event.key === next) to = list[(at + 1) % list.length];
    else if (event.key === previous) to = list[(at - 1 + list.length) % list.length];
    else if (event.key === "Home") to = list[0];
    else if (event.key === "End") to = list[list.length - 1];
    if (!to) return;
    event.preventDefault();
    current = to;
    refresh();
    to.focus();
  });
  // Buttons are enabled and disabled as the music changes; keep a usable stop.
  new MutationObserver(refresh).observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden", "inert"],
  });
  window.addEventListener("resize", refresh);
  refresh();
  return { refresh };
}
