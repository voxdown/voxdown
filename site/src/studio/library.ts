import { type SourceComparison, compareSources } from "./comparison";
import { arrangeDialogHeader } from "./dialog-layout";
import { filenameStem } from "./filename";
import { readSource } from "./source";
import {
  type DraftCursor,
  type SnapshotCursor,
  type StudioDraftMetadata,
  type StudioSnapshotMetadata,
  createSnapshot,
  deleteDraft,
  deleteSnapshot,
  getDraft,
  getSnapshot,
  listDrafts,
  listSnapshots,
} from "./storage";

type LibraryCallbacks = {
  current(): { name: string; source: string; draftId: string };
  /** Replace with a new draft id, after preserving/confirming the current document. */
  replace(source: string, name: string): Promise<boolean>;
  notice(message: string): void;
  download(content: string, filename: string, type: string): void;
};
type Kind = "drafts" | "snapshots";
type Entry = StudioDraftMetadata | StudioSnapshotMetadata;
const PAGE_SIZE = 25;
const MAX_ROWS = 100;
const PREVIEW_CHARACTERS = 50_000;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, action: () => void) {
  const node = element("button", text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

/** Local-only library: listings contain metadata; source is fetched only for a chosen entry. */
export function mountLibrary(host: HTMLElement, callbacks: LibraryCallbacks): { open(): void } {
  const prefix = `studio-library-${crypto.randomUUID()}`;
  const dialog = element("dialog");
  dialog.className = "studio-library";
  const heading = element("div");
  heading.className = "dialog-heading";
  const title = element("h2", "Your saved work");
  title.id = `${prefix}-title`;
  dialog.setAttribute("aria-labelledby", title.id);
  const close = button("Close", closeDialog);
  close.className = "close";
  heading.append(title, close);
  const explanation = element(
    "p",
    "Drafts are automatic recovery copies in this browser. Snapshots are named copies that stay unchanged. Download Fountain files to keep an independent backup.",
  );
  const controls = element("fieldset");
  controls.className = "library-controls";
  const legend = element("legend", "Browse and save");
  const kindLabel = element("label", "Show ");
  const kindSelect = element("select");
  for (const [value, label] of [
    ["drafts", "Drafts"],
    ["snapshots", "Snapshots"],
  ]) {
    const option = element("option", label);
    option.value = value ?? "drafts";
    kindSelect.append(option);
  }
  kindLabel.append(kindSelect);
  const refresh = button("Refresh", () => void load(true));
  const snapshotLabel = element("label", "Snapshot name ");
  const snapshotName = element("input");
  snapshotName.type = "text";
  snapshotName.maxLength = 200;
  snapshotName.placeholder = "Before revising act two";
  snapshotLabel.append(snapshotName);
  const save = button("Save snapshot of current draft", () => void saveSnapshot());
  controls.append(legend, kindLabel, refresh, snapshotLabel, save);
  const status = element("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const emergency = element("section");
  emergency.hidden = true;
  const emergencyDescription = element("p");
  const emergencyDownload = button("Download recovery JSON", () => {
    if (!emergencySource || busy) return;
    try {
      const content = JSON.stringify(
        {
          format: "voxdown-studio-raw-recovery",
          version: 1,
          name: emergencySource.name,
          source: emergencySource.source,
        },
        null,
        2,
      );
      callbacks.download(
        content,
        `${filenameStem(emergencySource.name)}.recovery.json`,
        "application/json",
      );
      report(
        "Recovery JSON downloaded. It preserves the exact saved source, including private text. This emergency copy cannot be imported as a Studio backup.",
      );
    } catch (error) {
      fail(error);
    }
  });
  emergency.append(emergencyDescription, emergencyDownload);
  const list = element("ul");
  list.className = "library-list";
  list.setAttribute("aria-label", "Saved work");
  const more = button("Load older saved work", () => void load(false));
  more.hidden = true;
  const comparison = element("section");
  comparison.className = "library-comparison";
  comparison.hidden = true;
  const comparisonHeading = element("h3", "Compare with current draft");
  comparisonHeading.tabIndex = -1;
  const comparisonNotice = element("p");
  comparisonNotice.className = "comparison-counts";
  const navigation = element("div");
  navigation.className = "comparison-navigation";
  navigation.setAttribute("role", "group");
  navigation.setAttribute("aria-label", "Comparison changes");
  const previousChange = button("Previous change", () => selectChange(changeIndex - 1));
  const nextChange = button("Next change", () => selectChange(changeIndex + 1));
  const position = element("p");
  position.className = "comparison-position";
  position.setAttribute("role", "status");
  position.setAttribute("aria-live", "polite");
  position.setAttribute("aria-atomic", "true");
  position.id = `${prefix}-change`;
  navigation.append(previousChange, nextChange, position);
  const hunks = element("div");
  hunks.className = "comparison-hunks";
  const fullSources = element("details");
  fullSources.className = "comparison-sources";
  const fullSummary = element("summary", "Full source versions");
  const fullColumns = element("div");
  fullColumns.className = "comparison-source-columns";
  const savedLabel = element("label", "Saved version ");
  const savedText = element("textarea");
  savedText.readOnly = true;
  savedText.setAttribute("aria-describedby", position.id);
  savedText.rows = 12;
  savedText.spellcheck = false;
  savedLabel.append(savedText);
  const currentLabel = element("label", "Current draft ");
  const currentText = element("textarea");
  currentText.readOnly = true;
  currentText.setAttribute("aria-describedby", position.id);
  currentText.rows = 12;
  currentText.spellcheck = false;
  currentLabel.append(currentText);
  fullColumns.append(savedLabel, currentLabel);
  fullSources.append(fullSummary, fullColumns);
  fullSources.addEventListener("toggle", () => {
    if (fullSources.open) selectChange(changeIndex);
  });
  const restoreCompared = button("Open saved version as a new draft", () => {
    if (compared) void openEntry(compared.kind, compared.id);
  });
  const hideComparison = button("Close comparison", () => {
    clearComparison();
    refresh.focus();
  });
  comparison.append(
    comparisonHeading,
    comparisonNotice,
    navigation,
    hunks,
    fullSources,
    restoreCompared,
    hideComparison,
  );
  const deletionHelp = element(
    "p",
    "Deleting saved work cannot be undone. Your active draft cannot be deleted here. Another open Studio tab may recreate its own automatic recovery copy.",
  );
  dialog.append(
    heading,
    explanation,
    controls,
    status,
    emergency,
    list,
    more,
    comparison,
    deletionHelp,
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);

  let kind: Kind = "drafts";
  let rows: Entry[] = [];
  let draftCursor: DraftCursor | undefined;
  let snapshotCursor: SnapshotCursor | undefined;
  let hasMore = false;
  let skippedRows = 0;
  let busy = false;
  let reloadWhenIdle = false;
  let epoch = 0;
  let opener: HTMLElement | null = null;
  let emergencySource: { name: string; source: string } | undefined;
  function clearEmergency() {
    emergencySource = undefined;
    emergency.hidden = true;
    emergencyDescription.textContent = "";
  }
  let compared: { kind: Kind; id: string } | undefined;

  let diff: SourceComparison | undefined;
  let changeIndex = -1;
  function selectChange(index: number) {
    if (diff?.status !== "complete" || !diff.changes.length) return;
    changeIndex = Math.max(0, Math.min(index, diff.changes.length - 1));
    const change = diff.changes[changeIndex];
    if (!change) return;
    hunks.replaceChildren();
    for (const [source, range, label, kind] of [
      [diff.saved, change.saved, "− Saved: removed lines", "removed"],
      [diff.current, change.current, "+ Current: added lines", "added"],
    ] as const) {
      const panel = element("section");
      panel.className = `comparison-hunk comparison-${kind}`;
      const heading = element("h4", label);
      panel.append(heading);
      if (range.lineTo < range.lineFrom) {
        panel.append(element("p", "No lines on this side of the change."));
      } else {
        // Keep each displayed hunk bounded even for a replacement of the entire script.
        const excerpt = source.slice(range.from, Math.min(range.to, range.from + 4000));
        const visible = excerpt.split("\n").slice(0, 40).join("\n");
        const text = element("pre", visible === "\n" || visible === "" ? "(Blank line)" : visible);
        text.tabIndex = 0;
        text.setAttribute("aria-label", label);
        panel.append(text);
        if (visible.length < range.to - range.from)
          panel.append(
            element("p", "Excerpt shortened. Expand Full source versions for the complete change."),
          );
      }
      hunks.append(panel);
    }
    for (const [textarea, range] of [
      [savedText, change.saved],
      [currentText, change.current],
    ] as const) {
      textarea.setSelectionRange(range.from, range.to);
      const style = getComputedStyle(textarea);
      const lineHeight =
        Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      // Disable wrapping so each source line corresponds to one scrollable display line.
      textarea.scrollTop = Math.max(0, (range.lineFrom - 3) * lineHeight);
    }
    const describe = (range: typeof change.saved) =>
      range.lineTo < range.lineFrom
        ? `insertion point at line ${range.lineFrom}`
        : range.lineFrom === range.lineTo
          ? `line ${range.lineFrom}`
          : `lines ${range.lineFrom}–${range.lineTo}`;
    position.textContent = `Change ${changeIndex + 1} of ${diff.changes.length}. Saved: ${describe(change.saved)}. Current: ${describe(change.current)}.`;
    previousChange.disabled = changeIndex === 0;
    nextChange.disabled = changeIndex === diff.changes.length - 1;
  }
  savedText.wrap = "off";
  currentText.wrap = "off";
  function clearComparison() {
    comparison.hidden = true;
    savedText.value = "";
    currentText.value = "";
    compared = undefined;
    diff = undefined;
    changeIndex = -1;
    position.textContent = "";
    hunks.replaceChildren();
    fullSources.open = false;
  }
  function report(message: string) {
    status.textContent = message;
    callbacks.notice(message);
  }
  function fail(error: unknown) {
    report(error instanceof Error ? error.message : "Saved work could not be accessed. Try again.");
  }
  function setBusy(value: boolean) {
    busy = value;
    controls.disabled = value;
    more.disabled = value;
    list.setAttribute("aria-busy", String(value));
    for (const node of list.querySelectorAll("button"))
      node.disabled = value || node.dataset.activeDraft === "true";
    restoreCompared.disabled = value;
    emergencyDownload.disabled = value;
    if (!value && reloadWhenIdle) {
      reloadWhenIdle = false;
      if (dialog.open) void load(true);
    }
  }
  function render() {
    list.replaceChildren();
    for (const row of rows) {
      const item = element("li");
      const name = element("strong", row.name || "Untitled");
      const timestamp = "updated" in row ? row.updated : row.created;
      const date = new Date(timestamp);
      const details = element(
        "p",
        `${Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString()} · ${row.characters.toLocaleString()} characters`,
      );
      const entryKind = kind;
      const open = button("Open as new draft", () => void openEntry(entryKind, row.id));
      open.setAttribute("aria-label", `Open ${row.name || "Untitled"} as a new draft`);
      const compare = button("Compare", () => void compareEntry(entryKind, row.id));
      compare.setAttribute("aria-label", `Compare ${row.name || "Untitled"} with current draft`);
      const remove = button("Delete", () => void deleteEntry(entryKind, row));
      remove.setAttribute("aria-label", `Delete ${row.name || "Untitled"}`);
      const active = entryKind === "drafts" && row.id === callbacks.current().draftId;
      remove.dataset.activeDraft = String(active);
      remove.disabled = active;
      if (active) details.append(" · Current draft");
      item.append(name, details, open, compare, remove);
      list.append(item);
    }
    more.hidden = !hasMore;
  }
  async function load(reset: boolean) {
    if (busy) return;
    setBusy(true);
    const ticket = epoch;
    if (reset) clearEmergency();
    status.textContent = "Loading saved work…";
    try {
      const page =
        kind === "drafts"
          ? await listDrafts({ limit: PAGE_SIZE, before: reset ? undefined : draftCursor })
          : await listSnapshots({ limit: PAGE_SIZE, before: reset ? undefined : snapshotCursor });
      if (ticket !== epoch || !dialog.open) return;
      if (reset) {
        rows = [];
        skippedRows = 0;
        clearComparison();
      }
      const known = new Set(rows.map((row) => row.id));
      rows.push(...page.items.filter((row) => !known.has(row.id)));
      if (rows.length > MAX_ROWS) {
        const excess = rows.length - MAX_ROWS;
        rows.splice(0, excess);
        skippedRows += excess;
      }
      if (kind === "drafts") draftCursor = page.next as DraftCursor | undefined;
      else snapshotCursor = page.next as SnapshotCursor | undefined;
      hasMore = Boolean(page.next);
      render();
      status.textContent = rows.length
        ? `${rows.length} ${kind} shown${skippedRows ? "; newer entries were removed from this view to keep it fast. Refresh to see the newest again" : ""}.`
        : `No saved ${kind} yet.`;
    } catch (error) {
      if (ticket === epoch) fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function readEntry(entryKind: Kind, id: string) {
    const value = entryKind === "drafts" ? await getDraft(id) : await getSnapshot(id);
    if (!value)
      throw new Error(
        "This saved version is no longer available. Refresh the list to see current saved work.",
      );
    return value;
  }
  async function compareEntry(entryKind: Kind, id: string) {
    if (busy) return;
    setBusy(true);
    const ticket = epoch;
    try {
      const value = await readEntry(entryKind, id);
      if (ticket !== epoch || !dialog.open) return;
      const current = callbacks.current();
      diff = compareSources(value.source, current.source);
      const complete = diff.status === "complete";
      savedText.value = complete ? diff.saved : diff.saved.slice(0, PREVIEW_CHARACTERS);
      currentText.value = complete ? diff.current : diff.current.slice(0, PREVIEW_CHARACTERS);
      savedText.setAttribute("aria-label", `Saved version: ${value.name}`);
      currentText.setAttribute("aria-label", `Current draft: ${current.name}`);
      navigation.hidden = diff.status !== "complete" || diff.changes.length === 0;
      hunks.hidden = navigation.hidden;
      hunks.replaceChildren();
      fullSources.open = navigation.hidden;
      if (diff.status === "complete") {
        comparisonNotice.textContent = `${diff.added} added, ${diff.removed} removed, ${diff.unchanged} unchanged lines.${diff.changes.length ? " Use Previous and Next change to review the highlighted excerpts below." : value.source === current.source ? " The texts are identical." : " Only line endings differ."} Opening makes a new draft and preserves this saved version.`;
        changeIndex = -1;
        position.textContent = "";
      } else {
        comparisonNotice.textContent =
          "Comparison too large to calculate within a safe processing budget. Changes have not been counted. Previews show only the first 50,000 characters. Opening restores the complete saved source.";
        position.textContent = "Change navigation unavailable for this comparison.";
      }
      compared = { kind: entryKind, id };
      comparison.hidden = false;
      selectChange(0);
      comparisonHeading.focus();
    } catch (error) {
      if (ticket === epoch) fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function openEntry(entryKind: Kind, id: string) {
    if (busy) return;
    setBusy(true);
    const ticket = epoch;
    let reopen = false;
    let closedForReplacement = false;
    try {
      const value = await readEntry(entryKind, id);
      if (ticket !== epoch || !dialog.open) return;
      clearEmergency();
      try {
        readSource(value.source);
      } catch {
        emergencySource = { name: value.name, source: value.source };
        emergencyDescription.textContent = `“${value.name || "Untitled"}” cannot be opened because its saved text contains unsupported characters or exceeds Studio's size limits. Download recovery JSON to preserve its exact source, including private text. This emergency copy is for manual recovery; it cannot be imported as a Studio backup.`;
        emergency.hidden = false;
        report(
          "The saved version is unchanged. Download recovery JSON below to keep an independent copy.",
        );
        // Focus after the finally block re-enables this control.
        queueMicrotask(() => {
          if (ticket === epoch && dialog.open) emergencyDownload.focus();
        });
        return;
      }
      closeDialog();
      closedForReplacement = true;
      if (await callbacks.replace(value.source, value.name))
        callbacks.notice("Opened saved work as a new draft. The saved version is unchanged.");
      else reopen = true;
    } catch (error) {
      if (closedForReplacement || ticket === epoch) {
        fail(error);
        reopen = closedForReplacement;
      }
    } finally {
      setBusy(false);
    }
    if (reopen) openDialog();
  }
  async function deleteEntry(entryKind: Kind, row: Entry) {
    if (busy) return;
    if (entryKind === "drafts" && row.id === callbacks.current().draftId) {
      report("Your active draft cannot be deleted here.");
      return;
    }
    if (!window.confirm(`Permanently delete “${row.name || "Untitled"}”? This cannot be undone.`))
      return;
    setBusy(true);
    const ticket = epoch;
    let removed = false;
    try {
      if (entryKind === "drafts") await deleteDraft(row.id);
      else await deleteSnapshot(row.id);
      removed = true;
    } catch (error) {
      if (ticket === epoch) fail(error);
    } finally {
      setBusy(false);
    }
    if (removed && ticket === epoch && dialog.open) {
      await load(true);
      report("Saved version deleted.");
      refresh.focus();
    }
  }
  async function saveSnapshot() {
    if (busy) return;
    const name = snapshotName.value.trim();
    if (
      !name ||
      name.length > 200 ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) {
      report("Give this snapshot a name without control characters.");
      snapshotName.focus();
      return;
    }
    setBusy(true);
    const ticket = epoch;
    const current = callbacks.current();
    let saved = false;
    try {
      await createSnapshot({ name, source: current.source, draftId: current.draftId });
      saved = true;
    } catch (error) {
      if (ticket === epoch) fail(error);
    } finally {
      setBusy(false);
    }
    if (saved && ticket === epoch && dialog.open) {
      snapshotName.value = "";
      kind = "snapshots";
      kindSelect.value = kind;
      await load(true);
      report(`Snapshot “${name}” saved.`);
    }
  }
  kindSelect.addEventListener("change", () => {
    kind = kindSelect.value === "snapshots" ? "snapshots" : "drafts";
    void load(true);
  });
  function closeDialog() {
    epoch++;
    reloadWhenIdle = false;
    clearComparison();
    clearEmergency();
    dialog.close();
    opener?.focus();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  function openDialog() {
    if (dialog.open) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    close.focus();
    if (busy) reloadWhenIdle = true;
    else void load(true);
  }
  return { open: openDialog };
}
