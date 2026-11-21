/**
 * The Recover drafts dialog's list: every draft kept in this browser, newest first, to open as a
 * new draft or delete. Loaded when the dialog is first opened.
 */
import { humanDate } from "./dates";
import { deleteDraft, listDrafts } from "./storage";

export async function fillRecover(
  dialog: { body: HTMLElement; close: () => void },
  draftId: string,
  recover: (id: string) => void,
) {
  dialog.body.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent =
    "Every tab keeps its own draft in this browser as you write. Open one to carry on; it opens as a new draft, so nothing is overwritten.";
  dialog.body.append(intro);
  try {
    const drafts = await listDrafts(30);
    if (!drafts.length) {
      const empty = document.createElement("p");
      empty.textContent = "No drafts yet.";
      dialog.body.append(empty);
    }
    for (const draft of drafts) {
      const row = document.createElement("div");
      row.className = "recent-row";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "open";
      openButton.textContent = draft.title || draft.name;
      const small = document.createElement("small");
      small.textContent = `${draft.name} · ${humanDate(draft.updated)} · ${draft.characters.toLocaleString()}\u00a0characters`;
      openButton.append(small);
      openButton.addEventListener("click", () => {
        dialog.close();
        recover(draft.id);
      });
      // The draft open in this tab says so instead of offering a Delete it cannot do.
      if (draft.id === draftId) {
        const here = document.createElement("span");
        here.className = "recent-here";
        here.textContent = "Open here";
        row.append(openButton, here);
      } else {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "recent-delete";
        remove.textContent = "Delete";
        remove.setAttribute("aria-label", `Delete draft ${draft.title || draft.name}`);
        remove.addEventListener("click", async () => {
          await deleteDraft(draft.id);
          row.remove();
        });
        row.append(openButton, remove);
      }
      dialog.body.append(row);
    }
  } catch {
    const failed = document.createElement("p");
    failed.textContent = "Browser storage is unavailable here, so drafts cannot be listed.";
    dialog.body.append(failed);
  }
}
