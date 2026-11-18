import { arrangeDialogHeader, dialogActions, dialogSection } from "./dialog-layout";
import {
  MAX_PROJECT_BYTES,
  type StudioProject,
  createProject,
  parseProject,
  projectName,
  serializeProject,
} from "./project";
import { getSnapshot, listSnapshots } from "./storage";

type Current = { name: string; source: string; draftId: string };
export function mountBackup(
  host: HTMLElement,
  actions: {
    current(): Current;
    replace(source: string, name: string): Promise<boolean>;
    download(value: string, name: string, type: string): void;
    notice(message: string): void;
  },
) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "backup-title");
  const title = document.createElement("h2");
  title.id = "backup-title";
  title.textContent = "Portable Studio backup";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.onclick = dismiss;
  const explanation = document.createElement("p");
  explanation.textContent =
    "A Studio backup is a local JSON file containing your exact Fountain source and optional snapshots. It includes private notes. Keep it somewhere you trust.";
  const label = document.createElement("label");
  const include = document.createElement("input");
  include.type = "checkbox";
  label.append(include, " Include snapshots from this editing session (up to 50)");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download backup";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "Open Studio backup file");
  const choices = document.createElement("select");
  choices.setAttribute("aria-label", "Draft or snapshot to open");
  choices.hidden = true;
  const restore = document.createElement("button");
  restore.type = "button";
  restore.textContent = "Open selected item as a new draft";
  restore.hidden = true;
  let imported: StudioProject | undefined;
  let generation = 0;
  function clearImport() {
    generation++;
    imported = undefined;
    choices.replaceChildren();
    choices.hidden = restore.hidden = true;
    status.textContent = "";
  }
  function dismiss() {
    clearImport();
    dialog.close();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) clearImport();
  });
  function presentImport(value: StudioProject, selected = "0") {
    imported = value;
    choices.replaceChildren(
      ...[value.draft, ...value.snapshots].map((item, i) => {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = `${i ? "Snapshot" : "Draft"}: ${item.name}`;
        return option;
      }),
    );
    choices.value = selected;
    choices.hidden = restore.hidden = false;
    status.textContent = `Validated backup with ${value.snapshots.length} snapshots. Choose one item to open. The other items stay in your backup file; no existing recovery data is replaced.`;
  }
  save.onclick = async () => {
    const current = actions.current();
    const snapshots: StudioProject["snapshots"] = [];
    save.disabled = true;
    try {
      if (include.checked) {
        let before: Parameters<typeof listSnapshots>[0];
        let scanned = 0;
        do {
          const page = await listSnapshots(before);
          for (const item of page.items) {
            if (++scanned > 5000)
              throw new Error(
                "Too many stored snapshots to scan. Download this draft without snapshots or remove older snapshots explicitly.",
              );
            if (item.draftId !== current.draftId) continue;
            if (snapshots.length >= 50)
              throw new Error(
                "This session has more than 50 snapshots. Download without snapshots or remove selected snapshots first.",
              );
            const snapshot = await getSnapshot(item.id);
            if (!snapshot)
              throw new Error("A snapshot was removed in another tab. Refresh and try again.");
            snapshots.push({
              name: snapshot.name,
              source: snapshot.source,
              created: snapshot.created,
            });
            // Enforce the combined budget while hydrating, not after loading the library.
            createProject({ name: current.name, source: current.source }, snapshots);
          }
          before = page.next ? { before: page.next } : undefined;
        } while (before);
      }
      actions.download(
        serializeProject(createProject({ name: current.name, source: current.source }, snapshots)),
        projectName(current.name),
        "application/json",
      );
      status.textContent = `Backup download started with ${snapshots.length} snapshots.`;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Backup failed; your draft is unchanged.";
    } finally {
      save.disabled = false;
    }
  };
  file.onchange = async () => {
    const selected = file.files?.[0];
    file.value = "";
    const request = ++generation;
    imported = undefined;
    choices.hidden = restore.hidden = true;
    if (!selected) return;
    try {
      if (selected.size > MAX_PROJECT_BYTES)
        throw new Error("Studio backups must be smaller than 16 MB.");
      const value = parseProject(
        new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer()),
      );
      if (request !== generation || !dialog.open) return;
      presentImport(value);
    } catch (error) {
      if (request === generation)
        status.textContent = error instanceof Error ? error.message : "Invalid backup.";
    }
  };
  restore.onclick = async () => {
    if (!imported) return;
    const validated = imported;
    const selected = choices.value;
    const item = [validated.draft, ...validated.snapshots][Number(selected)];
    if (!item) return;
    restore.disabled = true;
    dismiss();
    try {
      if (!(await actions.replace(item.source, item.name))) {
        dialog.showModal();
        presentImport(validated, selected);
        choices.focus();
      }
    } catch (error) {
      actions.notice(String(error));
    } finally {
      restore.disabled = false;
    }
  };
  save.classList.add("primary");
  restore.classList.add("primary");
  dialog.append(
    title,
    close,
    explanation,
    dialogSection("Save a backup", label, dialogActions(save)),
    dialogSection("Open a backup", file, choices, dialogActions(restore)),
    status,
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  return {
    open() {
      dialog.showModal();
    },
  };
}
