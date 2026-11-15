/**
 * The Scraps tab: passages set aside, in the writer's order. Words dragged from the story land
 * here (moved, or copied with Ctrl or ⌥ held); a scrap dragged into the story is copied there, and
 * stays here, marked as used. Each has a note; a search finds them by their words or notes; a
 * scrap is shown whole while the pointer or the keys are on it. Alt+↑ and Alt+↓ (or its arrows)
 * move a scrap in the list; a deleted one can be brought back from the notice that says so.
 */
import { type Scrap, searchScraps } from "./scraps";

export type ScrapsHost = {
  scraps(): Scrap[];
  /** Whether the story is written in another tab: its scraps are only read here. */
  readOnly(): boolean;
  keep(scraps: Scrap[]): void;
  /** Words dropped here from the story: kept as a scrap, and taken out unless `copy`. */
  dropped(text: string, copy: boolean): void;
  /** A scrap put back at the cursor. */
  insert(scrap: Scrap): void;
  open(): void;
  save(): void;
  fileName(): string;
  /** Whether the scraps are in this browser only, changed since saved beside the story, or saved. */
  standing(): "none" | "browser" | "changed" | "saved";
  notice(message: string, action?: { label: string; run: () => void }): void;
  /** Said to a screen reader. */
  announce(message: string): void;
};

/** The search, kept while the tab is drawn again. */
let searching = "";
/** The scrap the keys were on, to be on again once the tab is drawn again. */
let focusing: string | undefined;
const SCRAP = "application/x-vxd-scrap";

const when = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function scrapsPanel(host: ScrapsHost): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "scraps";
  const scraps = host.scraps();
  // The story written in another tab: its scraps read here, changed there.
  const readOnly = host.readOnly();

  const head = document.createElement("div");
  head.className = "scraps-head";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Find in scraps";
  search.setAttribute("aria-label", "Find in scraps, by their words or notes");
  search.value = searching;
  const files = document.createElement("div");
  files.className = "scraps-files";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "button quiet";
  open.textContent = "Open…";
  open.title = `Open scraps kept in a file, such as ${host.fileName()}: they join these`;
  open.addEventListener("click", () => host.open());
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button quiet";
  save.textContent = "Save…";
  save.title = `Save these scraps in a file beside the story: ${host.fileName()}`;
  open.disabled = readOnly;
  // Nothing to save, unless the scraps saved beside the story have all been deleted since.
  save.disabled = host.standing() !== "changed" && scraps.length === 0;
  save.addEventListener("click", () => host.save());
  files.append(open, save);
  head.append(search, files);

  const list = document.createElement("ol");
  list.className = "scraps-list";
  list.setAttribute("aria-label", "Scraps");

  const draw = () => {
    const shown = searchScraps(scraps, searching);
    list.replaceChildren(...shown.map((scrap) => card(scrap)));
    if (!scraps.length) {
      const empty = document.createElement("li");
      empty.className = "scraps-empty";
      empty.textContent = `Drag words from the story here to set them aside, or select them and use Edit › Cut to Scraps. Drag a scrap back into the story when it finds its place. Scraps saved beside this story? Open ${host.fileName()}.`;
      list.append(empty);
    } else if (!shown.length) {
      const none = document.createElement("li");
      none.className = "scraps-empty";
      none.textContent = "No scrap has those words.";
      list.append(none);
    }
  };

  /** A scrap one place up or down, past the one beside it in the list as it is shown. */
  const move = (scrap: Scrap, by: -1 | 1) => {
    const shown = searchScraps(scraps, searching);
    const beside = shown[shown.indexOf(scrap) + by];
    if (!beside) {
      host.announce(`Already the ${by < 0 ? "first" : "last"} scrap.`);
      return;
    }
    scraps.splice(scraps.indexOf(scrap), 1);
    const at = scraps.indexOf(beside);
    scraps.splice(by < 0 ? at : at + 1, 0, scrap);
    focusing = scrap.id;
    host.keep(scraps);
    const place = searchScraps(scraps, searching).indexOf(scrap) + 1;
    host.announce(`Moved ${by < 0 ? "up" : "down"}: scrap ${place} of ${shown.length}.`);
  };

  const card = (scrap: Scrap): HTMLElement => {
    const item = document.createElement("li");
    item.className = "scrap";
    item.draggable = !readOnly;
    item.tabIndex = 0;
    item.dataset.id = scrap.id;
    const text = document.createElement("div");
    text.className = "scrap-text";
    text.textContent = scrap.text;
    const note = document.createElement("input");
    note.type = "text";
    note.className = "scrap-note";
    note.placeholder = "A note";
    note.value = scrap.note;
    note.setAttribute("aria-label", "A note about this scrap");
    note.readOnly = readOnly;
    note.addEventListener("change", () => {
      scrap.note = note.value.trim();
      host.keep(scraps);
    });
    // Typing in the note never drags the scrap.
    note.addEventListener("mousedown", () => {
      item.draggable = false;
    });
    note.addEventListener("blur", () => {
      item.draggable = !readOnly;
    });
    const meta = document.createElement("div");
    meta.className = "scrap-meta";
    const place = scrap.from
      ? `From ${scrap.from}, ${when(scrap.at)}`
      : `Set aside ${when(scrap.at)}`;
    meta.textContent = scrap.used ? `${place}; used ${when(scrap.used)}` : place;
    const actions = document.createElement("div");
    actions.className = "scrap-actions";
    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "button quiet";
    insert.textContent = "Put in at the cursor";
    insert.addEventListener("click", () => {
      host.insert(scrap);
      scrap.used = Date.now();
      host.keep(scraps);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button quiet";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      const at = scraps.indexOf(scrap);
      if (at < 0) return;
      scraps.splice(at, 1);
      host.keep(scraps);
      host.notice("Scrap deleted.", {
        label: "Undo",
        run: () => {
          // Back where it was, in the scraps as they are now.
          const now = host.scraps();
          if (now.some((each) => each.id === scrap.id)) return;
          now.splice(Math.min(at, now.length), 0, scrap);
          focusing = scrap.id;
          host.keep(now);
          host.announce("Scrap brought back.");
        },
      });
    });
    const up = document.createElement("button");
    up.type = "button";
    up.className = "button quiet scrap-move";
    up.textContent = "↑";
    up.title = "Move up (Alt+↑)";
    up.setAttribute("aria-label", "Move this scrap up");
    up.addEventListener("click", () => move(scrap, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "button quiet scrap-move";
    down.textContent = "↓";
    down.title = "Move down (Alt+↓)";
    down.setAttribute("aria-label", "Move this scrap down");
    down.addEventListener("click", () => move(scrap, 1));
    for (const button of [insert, remove, up, down]) button.disabled = readOnly;
    actions.append(insert, remove, up, down);
    item.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    item.addEventListener("keydown", (event) => {
      if (event.target === note || readOnly) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      move(scrap, event.key === "ArrowUp" ? -1 : 1);
    });
    item.append(text, note, meta, actions);

    item.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData("text/plain", scrap.text);
      event.dataTransfer.setData(SCRAP, scrap.id);
      event.dataTransfer.effectAllowed = "copyMove";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", (event) => {
      item.classList.remove("dragging");
      // Dropped into the story: it is there now, and stays here too, marked.
      if (
        event.dataTransfer?.dropEffect !== "none" &&
        !panel.contains(document.elementFromPoint(event.clientX, event.clientY))
      ) {
        scrap.used = Date.now();
        host.keep(scraps);
      }
    });
    return item;
  };

  search.addEventListener("input", () => {
    searching = search.value;
    draw();
  });

  // Dropped here: a scrap moved in the list, or words from the story set aside.
  const placeBefore = (event: DragEvent) =>
    [...list.querySelectorAll<HTMLElement>(".scrap")].find((each) => {
      const box = each.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
  panel.addEventListener("dragover", (event) => {
    if (readOnly) return;
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes(SCRAP) && !types.includes("text/plain")) return;
    event.preventDefault();
    // A scrap moves in the list; words from the story move here, or are copied with Ctrl or ⌥.
    if (event.dataTransfer)
      event.dataTransfer.dropEffect =
        !types.includes(SCRAP) && (event.ctrlKey || event.altKey) ? "copy" : "move";
    panel.classList.add("receiving");
    for (const each of list.querySelectorAll(".before")) each.classList.remove("before");
    if (types.includes(SCRAP)) placeBefore(event)?.classList.add("before");
  });
  panel.addEventListener("dragleave", (event) => {
    if (!panel.contains(event.relatedTarget as Node | null)) panel.classList.remove("receiving");
  });
  panel.addEventListener("drop", (event) => {
    panel.classList.remove("receiving");
    for (const each of list.querySelectorAll(".before")) each.classList.remove("before");
    const data = event.dataTransfer;
    if (!data) return;
    event.preventDefault();
    const id = data.getData(SCRAP);
    if (id) {
      const moving = scraps.find((scrap) => scrap.id === id);
      if (!moving) return;
      const before = placeBefore(event)?.dataset.id;
      scraps.splice(scraps.indexOf(moving), 1);
      const at = before ? scraps.findIndex((scrap) => scrap.id === before) : -1;
      scraps.splice(at < 0 ? scraps.length : at, 0, moving);
      host.keep(scraps);
      return;
    }
    const text = data.getData("text/plain");
    if (text.trim()) host.dropped(text, event.ctrlKey || event.altKey);
  });

  draw();
  panel.append(head);
  // Scraps only this browser has: said, with the way to keep them beside the story.
  const standing = host.standing();
  if (readOnly) {
    const elsewhere = document.createElement("p");
    elsewhere.className = "scraps-standing";
    elsewhere.textContent = "This story is being written in another tab: its scraps change there.";
    panel.append(elsewhere);
  } else if (standing === "browser" || standing === "changed") {
    const warn = document.createElement("p");
    warn.className = "scraps-standing";
    warn.textContent =
      standing === "browser"
        ? `Kept in this browser only. Save… keeps them in ${host.fileName()}, beside the story.`
        : scraps.length
          ? `Changed since they were saved in ${host.fileName()}. Save… keeps the file up to date.`
          : `All deleted since they were saved in ${host.fileName()}. Save… empties the file too.`;
    panel.append(warn);
  }
  panel.append(list);
  // The keys back on the scrap just moved or brought back, once the tab is in the page.
  if (focusing) {
    const id = focusing;
    focusing = undefined;
    requestAnimationFrame(() =>
      panel.querySelector<HTMLElement>(`.scrap[data-id="${CSS.escape(id)}"]`)?.focus(),
    );
  }
  return panel;
}
