import { arrangeDialogHeader, dialogActions } from "./dialog-layout";
import {
  type DraftCursor,
  type StudioDraft,
  type StudioDraftMetadata,
  getDraft,
  listDrafts,
} from "./storage";
import "./recent-drafts.css";

export type RecentDraftContext = { id: string; revision: number };
type Actions = {
  current(): RecentDraftContext;
  /** Preserve current work, then check stillCurrent immediately before replacing it. */
  open(
    draft: StudioDraft,
    expected: RecentDraftContext,
    stillCurrent: () => boolean,
  ): Promise<boolean>;
};
type DraftStore = Pick<typeof import("./storage"), "getDraft" | "listDrafts">;

export function mountRecentDrafts(
  host: HTMLElement,
  actions: Actions,
  store: DraftStore = { getDraft, listDrafts },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "studio-recent-drafts";
  const title = document.createElement("h2");
  title.id = "recent-drafts-title";
  title.textContent = "Recent drafts";
  dialog.setAttribute("aria-labelledby", title.id);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  const description = document.createElement("p");
  description.textContent =
    "Continue from a draft kept in this browser. Opening makes a working copy and keeps the original recovery draft. Files on your computer are separate.";
  const list = document.createElement("ul");
  list.className = "studio-recent-list";
  list.setAttribute("aria-label", "Recent drafts");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "Newer drafts";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Older drafts";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry loading drafts";
  retry.hidden = true;
  dialog.append(title, close, description, list, status, dialogActions(previous, next, retry));
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let generation = 0;
  let opening = false;
  let context: RecentDraftContext | undefined;
  let cursors: (DraftCursor | undefined)[] = [undefined];
  let nextCursor: DraftCursor | undefined;
  function isCurrent(ticket: number) {
    const now = actions.current();
    return (
      dialog.open &&
      ticket === generation &&
      context?.id === now.id &&
      context.revision === now.revision
    );
  }
  function controls(loading: boolean) {
    previous.disabled = loading || cursors.length === 1;
    next.disabled = loading || !nextCursor;
    for (const button of list.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = loading || button.dataset.current === "true";
    }
  }
  async function select(metadata: StudioDraftMetadata) {
    if (opening) return;
    const ticket = generation;
    if (!isCurrent(ticket) || !context) {
      status.textContent = "The screenplay changed. Close and reopen Recent drafts to continue.";
      return;
    }
    const expected = { ...context };
    opening = true;
    controls(true);
    status.textContent = `Opening ${metadata.name || "Untitled.fountain"}…`;
    try {
      const draft = await store.getDraft(metadata.id);
      if (!isCurrent(ticket)) {
        if (dialog.open && ticket === generation)
          status.textContent =
            "The screenplay changed. Close and reopen Recent drafts to continue.";
        return;
      }
      if (!draft) {
        status.textContent =
          "This draft is no longer available. Your current screenplay is unchanged.";
        return;
      }
      if (await actions.open(draft, expected, () => isCurrent(ticket))) {
        if (dialog.open && ticket === generation) dialog.close();
      } else if (dialog.open && ticket === generation) {
        status.textContent = "The draft was not opened. Your current screenplay is still here.";
      }
    } catch (error) {
      if (dialog.open && ticket === generation)
        status.textContent =
          error instanceof Error
            ? error.message
            : "This draft could not be opened. Your current screenplay is unchanged.";
    } finally {
      if (ticket === generation) {
        opening = false;
        controls(false);
      }
    }
  }
  function row(draft: StudioDraftMetadata) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("strong");
    name.textContent = draft.name || "Untitled.fountain";
    const details = document.createElement("span");
    details.className = "studio-recent-details";
    details.textContent = `${new Date(draft.updated).toLocaleString()} · ${draft.characters.toLocaleString()} characters`;
    const current = draft.id === context?.id;
    const action = document.createElement("span");
    action.className = "studio-recent-action";
    action.textContent = current ? "Current draft" : "Open copy";
    button.dataset.current = String(current);
    button.disabled = current;
    button.append(name, details, action);
    button.onclick = () => void select(draft);
    item.append(button);
    return item;
  }
  async function load() {
    const ticket = ++generation;
    opening = false;
    retry.hidden = true;
    list.replaceChildren();
    nextCursor = undefined;
    controls(true);
    status.textContent = "Loading drafts…";
    try {
      const page = await store.listDrafts({ limit: 20, before: cursors.at(-1) });
      if (!dialog.open || ticket !== generation) return;
      nextCursor = page.next;
      list.replaceChildren(...page.items.map(row));
      status.textContent = page.items.length
        ? `${page.items.length} drafts · newest first`
        : "No drafts kept in this browser yet. Your writing will appear here once it is kept for recovery.";
      controls(false);
    } catch (error) {
      if (!dialog.open || ticket !== generation) return;
      status.textContent =
        error instanceof Error
          ? error.message
          : "Recent drafts could not be loaded. Your current screenplay is unchanged.";
      retry.hidden = false;
      previous.disabled = cursors.length === 1;
    }
  }
  previous.onclick = () => {
    if (cursors.length > 1 && !opening) {
      cursors.pop();
      void load();
    }
  };
  next.onclick = () => {
    if (nextCursor && !opening) {
      cursors.push(nextCursor);
      void load();
    }
  };
  retry.onclick = () => void load();
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    generation++;
    opening = false;
    context = undefined;
    list.replaceChildren();
  });
  return {
    open() {
      context = actions.current();
      cursors = [undefined];
      if (!dialog.open) dialog.showModal();
      void load();
    },
    close() {
      dialog.close();
    },
  };
}
