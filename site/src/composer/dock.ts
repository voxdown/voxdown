/**
 * Where Composer's side panels (Find melody, MIDI keyboard) sit: docked in the rail's column,
 * which widens while one is open, so they never cover the text or the score. On a phone they sit
 * above the transport as a sheet. Tab stays inside a panel while it has focus; Escape closes it
 * and gives focus back to where it was.
 */
import "./dock.css";

function dock(): HTMLElement {
  let found = document.getElementById("dock");
  if (!found) {
    found = document.createElement("div");
    found.id = "dock";
    found.className = "dock";
    (document.getElementById("workspace") ?? document.body).append(found);
  }
  return found;
}

function update() {
  const holder = dock();
  const workspace = document.getElementById("workspace");
  const open = holder.children.length > 0;
  if (open) workspace?.setAttribute("data-dock", "open");
  else workspace?.removeAttribute("data-dock");
  holder.hidden = !open;
  // On a phone the dock sits just above the transport.
  const transport = document.getElementById("transport");
  if (open && transport)
    holder.style.setProperty(
      "--dock-bottom",
      `${Math.max(8, window.innerHeight - transport.getBoundingClientRect().top + 8)}px`,
    );
}

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [href], [tabindex]:not([tabindex='-1'])";

/** Puts a panel in the dock, with Tab kept inside it and Escape closing it. */
export function dockPanel(panel: HTMLElement, close: () => void) {
  panel.classList.add("dock-panel");
  // The newest panel first.
  dock().prepend(panel);
  update();
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.getClientRects().length > 0,
    );
    if (!stops.length) return;
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

/** Takes a panel out of the dock. */
export function undockPanel(panel: HTMLElement) {
  panel.remove();
  update();
}
