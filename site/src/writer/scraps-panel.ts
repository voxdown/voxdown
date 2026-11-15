/**
 * The Scraps tab: passages set aside, in the writer's order. Words dragged from the story land
 * here (moved, or copied with Ctrl or ⌥ held); a scrap dragged into the story is copied there, and
 * stays here, marked as used. Each has a note; a search finds them by their words or notes; a
 * scrap is shown whole while the pointer or the keys are on it.
 */
import { type Scrap, searchScraps } from "./scraps";

export type ScrapsHost = {
  scraps(): Scrap[];
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
  notice(message: string): void;
};

/** The search, kept while the tab is drawn again. */
let searching = "";
const SCRAP = "application/x-vxd-scrap";

const when = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function scrapsPanel(host: ScrapsHost): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "scraps";
  const scraps = host.scraps();

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
  save.disabled = scraps.length === 0;
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

  const card = (scrap: Scrap): HTMLElement => {
    const item = document.createElement("li");
    item.className = "scrap";
    item.draggable = true;
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
    note.addEventListener("change", () => {
      scrap.note = note.value.trim();
      host.keep(scraps);
    });
    // Typing in the note never drags the scrap.
    note.addEventListener("mousedown", () => {
      item.draggable = false;
    });
    note.addEventListener("blur", () => {
      item.draggable = true;
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
      scraps.splice(at, 1);
      host.keep(scraps);
      host.notice("Scrap deleted.");
    });
    actions.append(insert, remove);
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
  if (standing === "browser" || standing === "changed") {
    const warn = document.createElement("p");
    warn.className = "scraps-standing";
    warn.textContent =
      standing === "browser"
        ? `Kept in this browser only. Save… keeps them in ${host.fileName()}, beside the story.`
        : `Changed since they were saved in ${host.fileName()}. Save… keeps the file up to date.`;
    panel.append(warn);
  }
  panel.append(list);
  return panel;
}
