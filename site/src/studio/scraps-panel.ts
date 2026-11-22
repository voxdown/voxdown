import {
  mergeScraps,
  readScrapsFile,
  scrapsFile,
  scrapsFileName,
  searchScraps,
} from "../writer/scraps";
import type { ScrapOrigin } from "./scrap-origin";
import { scrapPopover } from "./scrap-popover";
import { renderScrapPreview } from "./scrap-preview";
import {
  MAX_SCRAP_CHARS,
  type ScrapBook,
  type ScrapsKeeper,
  type StudioScrap,
  readScrapBook,
  validateScraps,
  writeScrapBook,
} from "./scraps-storage";
import { encodeUtf8Losslessly } from "./source";

export type StudioScrapsActions = {
  current(): { id: string; name: string };
  getSelection(): string;
  selectionOrigin?(): ScrapOrigin;
  removeSelection?(origin: ScrapOrigin): boolean;
  returnToText?(scrap: StudioScrap): string;
  /** Insert through the authoritative editor, with its source validation and undo. */
  insert(text: string): boolean;
  download(text: string, name: string): void;
  /** Keep this browser draft reachable when only its scraps have changed. */
  changed?(): void;
};
type DraftState = {
  book: ScrapBook;
  raw: string | null;
  error: string;
  loaded: boolean;
  composer: string;
  note: string;
  editing?: string | undefined;
  editText?: string;
  editNote?: string;
  editOriginal?: string;
  copiedFrom?: string;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Browser storage is unavailable.";
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}
function button(text: string, run: () => void) {
  const result = node("button", text);
  result.type = "button";
  result.onclick = run;
  return result;
}

const pinPath = "M16 9V3H8v6l-3 4v3h14v-3l-3-4ZM12 16v6";
function scrapIcon(d: string) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.75");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  icon.append(path);
  return icon;
}
function markPinned(label: HTMLElement, pinned: boolean) {
  if (!pinned) return;
  label.classList.add("studio-scrap-pinned-label");
  label.prepend(scrapIcon(pinPath));
}

/** Writer's portable scrap format, kept separately for each Studio browser draft. */
export function mountStudioScraps(
  host: HTMLElement,
  actions: StudioScrapsActions,
  keeper?: ScrapsKeeper,
) {
  const storage: ScrapsKeeper = keeper ?? {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  };
  const drafts = new Map<string, DraftState>();
  let current = "";
  let state: DraftState;
  let generation = 0;
  let shown = 30;
  const popup = scrapPopover();
  const composer = node("textarea");
  composer.rows = 4;
  composer.maxLength = MAX_SCRAP_CHARS;
  composer.placeholder = "A line for later, another ending…";
  composer.setAttribute("aria-label", "New scrap");
  const note = node("input");
  note.maxLength = 2_000;
  note.placeholder = "A note (optional)";
  note.setAttribute("aria-label", "Note about the new scrap");
  const status = node("p");
  status.className = "studio-scraps-status";
  status.setAttribute("role", "status");
  const form = node("form");
  form.className = "studio-scraps-composer";
  const add = button("Add scrap", () => addScrap(composer.value, note.value));
  const selection = button("Copy selection", () => {
    const selected = actions.getSelection();
    if (!selected.trim()) {
      say("Select words in your screenplay first, then choose Copy selection.");
      return;
    }
    addScrap(selected, "", actions.selectionOrigin?.());
  });
  selection.title = "Keep selected words here; leave them in the screenplay";
  const addActions = node("div");
  addActions.className = "studio-scraps-actions";
  const moveSelection = button("Move selection", () => {
    const selected = actions.getSelection();
    if (!selected.trim()) {
      say("Select words in your screenplay first, then choose Move selection.");
      return;
    }
    const origin = actions.selectionOrigin?.();
    if (!origin || !actions.removeSelection) return;
    if (addScrap(selected, "", origin)) {
      if (actions.removeSelection(origin))
        say(
          "Selection moved to scraps. Return to text puts it back; Undo also restores the source.",
        );
      else
        say("Scrap saved, but the selection could not be removed. Your screenplay is unchanged.");
    }
  });
  moveSelection.title = "Save selected words as a scrap, then remove them from the screenplay";
  addActions.append(add, selection);
  if (actions.removeSelection) addActions.append(moveSelection);
  form.append(composer, note, addActions);
  form.onsubmit = (event) => {
    event.preventDefault();
    addScrap(composer.value, note.value);
  };
  form.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      addScrap(composer.value, note.value);
    }
  });
  composer.oninput = () => {
    state.composer = composer.value;
    add.disabled = !composer.value.trim();
  };
  note.oninput = () => {
    state.note = note.value;
  };
  const search = node("input");
  search.type = "search";
  search.placeholder = "Find a scrap…";
  search.setAttribute("aria-label", "Find a scrap");
  search.oninput = () => {
    shown = 30;
    renderList();
  };
  const list = node("ol");
  list.className = "studio-scraps-list";
  list.setAttribute("aria-label", "Saved scraps");
  const empty = node("p");
  empty.className = "studio-scraps-empty";
  const more = button("Show more scraps", () => {
    shown += 30;
    renderList();
  });
  const deleted = node("details");
  deleted.className = "studio-scraps-deleted";
  const deletedSummary = node("summary");
  const deletedList = node("ol");
  deleted.append(deletedSummary, deletedList);
  const file = node("input");
  file.type = "file";
  file.accept = ".md,.markdown,text/markdown,text/plain";
  file.hidden = true;
  const exportButton = button("Export scraps…", () => {
    try {
      const text = scrapsFile(
        state.book.scraps,
        actions.current().name.replace(/\.fountain$/i, ""),
      );
      encodeUtf8Losslessly(text);
      actions.download(text, scrapsFileName(actions.current().name));
      say(
        "Scraps exported separately. They are not included in screenplay files or Studio backups.",
      );
    } catch (error) {
      say(`Could not export scraps: ${message(error)}`);
    }
  });
  const importButton = button("Import scraps…", () => file.click());
  const files = node("div");
  files.className = "studio-scraps-actions studio-scraps-files";
  files.append(importButton, exportButton);
  const hint = node(
    "p",
    "Kept with this browser draft. Export scraps to keep a separate .scraps.md file, also readable in Writer. Scraps are not included in screenplay exports or Studio backups.",
  );
  hint.className = "studio-scraps-hint";
  host.classList.add("studio-scraps");
  host.append(form, status, search, list, empty, more, deleted, files, hint, file);

  function say(text: string) {
    status.textContent = text;
  }
  function commit(book: ScrapBook, success: string): boolean {
    if (actions.current().id !== current) {
      refresh();
      say("The screenplay changed. Try again in this draft.");
      return false;
    }
    if (!state.loaded) {
      say(state.error);
      return false;
    }
    try {
      state.raw = writeScrapBook(storage, current, state.raw, book);
      state.book = book;
      state.error = "";
      say(success);
      actions.changed?.();
      return true;
    } catch (error) {
      state.error = `Scraps were not saved: ${message(error)} Your words remain here.`;
      say(state.error);
      return false;
    }
  }
  function addScrap(text: string, scrapNote: string, origin?: ScrapOrigin): boolean {
    if (!text.trim()) {
      composer.focus();
      return false;
    }
    const scrap: StudioScrap = {
      id: crypto.randomUUID(),
      text,
      note: scrapNote,
      at: Date.now(),
      from: "",
      ...(origin && origin.text === text ? { origin } : {}),
    };
    if (
      !commit(
        { ...state.book, scraps: [...state.book.scraps, scrap] },
        "Scrap kept. Your screenplay is unchanged.",
      )
    )
      return false;
    if (text === composer.value) {
      state.composer = "";
      state.note = "";
      composer.value = "";
      note.value = "";
    }
    search.value = "";
    shown = 30;
    renderList();
    add.disabled = !composer.value.trim();
    composer.focus();
    return true;
  }
  function renderList() {
    popup.close();
    list.replaceChildren();
    const matches = (searchScraps(state.book.scraps, search.value) as StudioScrap[])
      .reverse()
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    for (const scrap of matches.slice(0, shown)) {
      const item = node("li");
      item.className = "studio-scrap";
      item.dataset.scrapId = scrap.id;
      const text = node("button");
      text.type = "button";
      renderScrapPreview(text, scrap.text);
      text.className = "studio-scrap-text";
      text.tabIndex = 0;
      text.setAttribute("aria-label", `Preview scrap: ${scrap.text.slice(0, 80)}`);
      text.setAttribute("aria-expanded", "false");
      let hoverTimer: ReturnType<typeof setTimeout> | undefined;
      const showPreview = (persistent: boolean) => {
        if (!text.isConnected || host.hidden) return;
        const body = node("div");
        const heading = node("div");
        heading.className = "studio-scrap-preview-heading";
        const close = button("Close preview", () => popup.close(true));
        const title = node("strong", scrap.pinned ? "Pinned scrap" : "Scrap");
        markPinned(title, !!scrap.pinned);
        heading.append(title, close);
        const passage = node("div");
        passage.className = "studio-scrap-full-text";
        renderScrapPreview(passage, scrap.text, true);
        body.append(heading, passage);
        if (scrap.note) body.append(node("p", scrap.note));
        popup.show(text, body, false, persistent);
      };
      text.onclick = () => {
        clearTimeout(hoverTimer);
        showPreview(true);
      };
      text.onpointerenter = (event) => {
        popup.cancelClose();
        if (event.pointerType === "mouse" && text.getAttribute("aria-expanded") !== "true")
          hoverTimer = setTimeout(() => showPreview(false), 350);
      };
      text.onpointerleave = () => {
        clearTimeout(hoverTimer);
        popup.deferClose();
      };
      text.draggable = true;
      text.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData("text/plain", scrap.text);
        event.dataTransfer.effectAllowed = "copy";
      });
      const annotation = node("p", scrap.note);
      annotation.className = "studio-scrap-note";
      annotation.hidden = !scrap.note;
      const controls = node("div");
      controls.className = "studio-scrap-heading";
      const label = node("span", scrap.pinned ? "Pinned scrap" : "Scrap");
      label.className = "studio-scrap-label";
      markPinned(label, !!scrap.pinned);
      const menu = button("⋯", () => openMenu());
      menu.setAttribute("aria-label", "Scrap actions");
      menu.setAttribute("aria-haspopup", "menu");
      menu.setAttribute("aria-expanded", "false");
      menu.onkeydown = (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          openMenu();
        }
      };
      const insert = button("Insert at cursor", () => {
        if (actions.current().id !== current) {
          refresh();
          return;
        }
        if (actions.insert(scrap.text))
          say("Scrap inserted. It stays here too; undo the insertion in your screenplay.");
        else say("Could not insert this scrap. Check the screenplay notice; the scrap stays here.");
      });
      const edit = button("Edit", () => {
        if (state.editing && state.editing !== scrap.id) {
          say(
            "Save or cancel the open scrap before editing another. Your unfinished words are still here.",
          );
          list.querySelector<HTMLTextAreaElement>("textarea")?.focus();
          return;
        }
        state.editing = scrap.id;
        state.editText = scrap.text;
        state.editNote = scrap.note;
        state.editOriginal = JSON.stringify([scrap.text, scrap.note]);
        renderList();
        list.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      });
      const remove = button("Delete", () => {
        if (
          !commit(
            {
              ...state.book,
              scraps: state.book.scraps.filter((entry) => entry.id !== scrap.id),
              deleted: [
                scrap,
                ...state.book.deleted.filter((entry) => entry.id !== scrap.id),
              ].slice(0, 50),
            },
            "Scrap deleted. Bring it back under Deleted scraps.",
          )
        )
          return;
        if (state.editing === scrap.id) state.editing = undefined;
        renderList();
        deleted.open = true;
        deletedList.querySelector<HTMLButtonElement>("button")?.focus();
      });
      const copy = button("Copy", async () => {
        const draft = current;
        try {
          await navigator.clipboard.writeText(scrap.text);
          if (current === draft) say("Scrap copied.");
        } catch {
          if (current === draft)
            say("Clipboard unavailable. Open Edit to select and copy the words.");
        }
      });
      const returned = button("Return to text", () => {
        if (actions.current().id !== current) {
          refresh();
          return;
        }
        say(
          actions.returnToText?.(scrap) ??
            "This scrap has no saved source location. Use Insert at cursor.",
        );
      });
      returned.disabled = !scrap.origin || !actions.returnToText;
      returned.title = scrap.origin
        ? "Return to the original passage, or restore it if removed"
        : "Available for selections saved from this screenplay";
      const pin = button(scrap.pinned ? "Unpin" : "Pin to top", () => {
        if (
          commit(
            {
              ...state.book,
              scraps: state.book.scraps.map((entry) =>
                entry.id === scrap.id ? { ...entry, pinned: !entry.pinned } : entry,
              ),
            },
            scrap.pinned ? "Scrap unpinned." : "Scrap pinned.",
          )
        ) {
          renderList();
          focusScrap(scrap.id);
        }
      });
      const reorder = (top: boolean) => {
        const rest = state.book.scraps.filter((entry) => entry.id !== scrap.id);
        // Stored oldest first; display newest first, with pinned scraps grouped above.
        const scraps = top ? [...rest, scrap] : [scrap, ...rest];
        if (
          commit(
            { ...state.book, scraps },
            `Scrap moved to the ${top ? "top" : "bottom"}${scrap.pinned ? " of pinned scraps" : " of unpinned scraps"}.`,
          )
        ) {
          renderList();
          focusScrap(scrap.id);
        }
      };
      const top = button("Move to top", () => reorder(true));
      const bottom = button("Move to bottom", () => reorder(false));
      const group = [...state.book.scraps]
        .reverse()
        .filter((entry) => !!entry.pinned === !!scrap.pinned);
      top.disabled = group[0]?.id === scrap.id;
      bottom.disabled = group.at(-1)?.id === scrap.id;
      const menuActions = [copy, insert, returned, edit, pin, top, bottom, remove];
      const paths = [
        "M9 8h11v13H9zM15 8V3H4v13h5",
        "M14 4h6v16h-6M3 12h12m-4-4 4 4-4 4",
        "m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3",
        "m15 4 5 5M4 20l1-6L16 3a2 2 0 0 1 5 5L10 19z",
        scrap.pinned ? `${pinPath}M3 3l18 18` : pinPath,
        "M4 3h16M12 21V7m-6 6 6-6 6 6",
        "M4 21h16M12 3v14m-6-6 6 6 6-6",
        "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
      ];
      for (const [index, action] of menuActions.entries()) {
        action.append(scrapIcon(paths[index] ?? ""));
        action.setAttribute("role", "menuitem");
        const run = action.onclick;
        action.onclick = (event) => {
          popup.close(true);
          if (typeof run === "function") run.call(action, event);
        };
      }
      function openMenu() {
        clearTimeout(hoverTimer);
        const choices = node("div");
        choices.append(...menuActions);
        popup.show(menu, choices, true, true);
      }
      controls.append(label, menu);
      item.append(controls, text, annotation);
      if (state.editing === scrap.id) {
        const editForm = node("form");
        editForm.className = "studio-scrap-editor";
        const words = node("textarea");
        words.rows = 5;
        words.maxLength = MAX_SCRAP_CHARS;
        words.value = state.editText ?? scrap.text;
        words.setAttribute("aria-label", "Edit scrap text");
        words.oninput = () => {
          state.editText = words.value;
        };
        const annotationInput = node("input");
        annotationInput.maxLength = 2_000;
        annotationInput.value = state.editNote ?? scrap.note;
        annotationInput.setAttribute("aria-label", "Edit scrap note");
        annotationInput.oninput = () => {
          state.editNote = annotationInput.value;
        };
        const save = button("Save changes", () => {
          if (!words.value.trim()) {
            say("Keep some words in the scrap, or use Delete.");
            return;
          }
          if (state.editOriginal !== JSON.stringify([scrap.text, scrap.note])) {
            say(
              "This scrap changed in another tab while you were editing it. Copy your unfinished words into a new scrap, or Cancel to use the saved version.",
            );
            return;
          }
          const updated = { ...scrap, text: words.value, note: annotationInput.value };
          if (
            !commit(
              {
                ...state.book,
                scraps: state.book.scraps.map((entry) => (entry.id === scrap.id ? updated : entry)),
              },
              "Scrap updated.",
            )
          )
            return;
          state.editing = undefined;
          renderList();
          focusScrap(scrap.id);
        });
        const cancel = button("Cancel", () => {
          state.editing = undefined;
          renderList();
          focusScrap(scrap.id);
        });
        const editActions = node("div");
        editActions.className = "studio-scraps-actions";
        editActions.append(save, cancel);
        editForm.append(words, annotationInput, editActions);
        editForm.onsubmit = (event) => {
          event.preventDefault();
          save.click();
        };
        item.replaceChildren(editForm);
      }
      list.append(item);
    }
    empty.hidden = matches.length > 0;
    empty.textContent = state.book.scraps.length
      ? "No matching scraps."
      : "Set aside alternate lines and ideas here. Add a scrap, copy a selection, or drop text into this panel.";
    more.hidden = matches.length <= shown;
    exportButton.disabled = state.book.scraps.length === 0;
    deleted.hidden = state.book.deleted.length === 0;
    deletedSummary.textContent = `Deleted scraps (${state.book.deleted.length})`;
    deletedList.replaceChildren();
    for (const scrap of state.book.deleted) {
      const item = node("li");
      const text = node("p", scrap.text.length > 140 ? `${scrap.text.slice(0, 140)}…` : scrap.text);
      const restore = button("Bring back", () => {
        if (
          !commit(
            {
              ...state.book,
              scraps: [...state.book.scraps, scrap],
              deleted: state.book.deleted.filter((entry) => entry.id !== scrap.id),
            },
            "Scrap restored.",
          )
        )
          return;
        search.value = "";
        shown = 30;
        renderList();
        focusScrap(scrap.id);
      });
      restore.setAttribute("aria-label", `Bring back: ${scrap.text.slice(0, 60)}`);
      item.append(text, restore);
      deletedList.append(item);
    }
  }
  function focusScrap(id: string) {
    list.querySelector<HTMLButtonElement>(`[data-scrap-id="${CSS.escape(id)}"] button`)?.focus();
  }
  file.onchange = async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    const ticket = ++generation;
    const draft = current;
    say("Reading scraps…");
    try {
      if (!/\.(md|markdown)$/i.test(chosen.name) || chosen.size > 4_000_000)
        throw new Error("Choose a .scraps.md file of up to 4 MB.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await chosen.arrayBuffer());
      const imported = readScrapsFile(text);
      validateScraps(imported);
      if (!imported.length)
        throw new Error(
          "This file has no Writer or Studio scraps. Paste ordinary text into New scrap instead.",
        );
      if (ticket !== generation || actions.current().id !== draft || current !== draft) return;
      const merged = mergeScraps(state.book.scraps, imported);
      if (
        commit(
          { ...state.book, scraps: merged.scraps },
          `${merged.added} ${merged.added === 1 ? "scrap imported" : "scraps imported"}. Existing scraps are unchanged.`,
        )
      )
        renderList();
    } catch (error) {
      if (ticket === generation && actions.current().id === draft)
        say(`Could not import scraps: ${message(error)}`);
    }
  };
  host.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("text/plain")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  host.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.types.includes("text/plain")) return;
    event.preventDefault();
    event.stopPropagation();
    // Always copy. Moving text out of the source requires an explicit editor transaction.
    addScrap(event.dataTransfer.getData("text/plain"), "");
  });

  function refresh(copyFromId?: string) {
    popup.close();
    generation++;
    current = actions.current().id;
    const cached = drafts.get(current);
    state = cached ?? {
      book: { version: 1, scraps: [], deleted: [] },
      raw: null,
      error: "",
      loaded: false,
      composer: "",
      note: "",
    };
    drafts.set(current, state);
    try {
      const saved = readScrapBook(storage, current);
      state.raw = saved.raw;
      state.book = saved.book;
      state.loaded = true;
      state.error = "";
      const inherited = copyFromId ?? state.copiedFrom;
      if (inherited && inherited !== current && saved.raw === null) {
        state.copiedFrom = inherited;
        // A recovery is a fresh working copy. Do not duplicate its potentially
        // large scraps on every reload: the first successful edit writes the
        // separate namespace and changed() makes that working copy reachable.
        state.book = readScrapBook(storage, inherited).book;
      }
    } catch (error) {
      state.loaded = false;
      state.error = `Could not load saved scraps: ${message(error)} Existing browser data is unchanged.`;
    }
    composer.value = state.composer;
    note.value = state.note;
    add.disabled = !composer.value.trim();
    say(state.error);
    search.value = "";
    shown = 30;
    renderList();
  }
  refresh();
  return {
    refresh,
    /** Keep inherited scraps when source edits first persist a recovered working copy. */
    persist() {
      if (actions.current().id !== current) refresh();
      if (!state.loaded) return false;
      if (state.raw !== null || (!state.book.scraps.length && !state.book.deleted.length))
        return true;
      try {
        state.raw = writeScrapBook(storage, current, null, state.book);
        state.error = "";
        return true;
      } catch (error) {
        state.error = `The screenplay's inherited scraps could not be kept in this draft: ${message(error)} Export scraps before leaving.`;
        say(state.error);
        return false;
      }
    },
    focus() {
      composer.focus();
    },
  };
}
