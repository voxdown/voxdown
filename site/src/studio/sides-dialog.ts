import { arrangeDialogHeader, countLabel, dialogActions, dialogDisclosure } from "./dialog-layout";
import { filenameStem } from "./filename";
import { type ActorSidesProject, type ActorSidesResult, prepareActorSides } from "./sides";

export interface ActorSidesSnapshot {
  source: string;
  name: string;
  paper: "letter" | "a4";
}

export function mountActorSides(
  host: HTMLElement,
  actions: {
    current(): ActorSidesSnapshot;
    download(bytes: BlobPart, name: string, type: string): void;
  },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "actor-sides-dialog";
  dialog.setAttribute("aria-labelledby", "actor-sides-title");
  const title = document.createElement("h2");
  title.id = "actor-sides-title";
  title.textContent = "Actor sides";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const explanation = document.createElement("p");
  explanation.textContent =
    "Create a PDF of complete scenes for one character. Private notes, outlines and original author/contact fields are excluded.";
  const details = document.createElement("p");
  details.textContent =
    "Other characters and action are included for context. Pages are repaginated, not locked to the original screenplay. This uses a snapshot; close and reopen to include later edits.";
  const snapshotLabel = document.createElement("p");
  const searchLabel = document.createElement("label");
  searchLabel.textContent = "Find a character ";
  const search = document.createElement("input");
  search.type = "search";
  search.maxLength = 200;
  searchLabel.append(search);
  const selectLabel = document.createElement("label");
  selectLabel.textContent = "Character ";
  selectLabel.htmlFor = "actor-sides-character";
  const select = document.createElement("select");
  select.id = "actor-sides-character";
  const matches = document.createElement("p");
  matches.setAttribute("role", "status");
  const includeLabel = document.createElement("label");
  const includeTitle = document.createElement("input");
  includeTitle.type = "checkbox";
  includeLabel.append(includeTitle, " Include original script title on the cover");
  const preview = document.createElement("ol");
  preview.className = "actor-sides-scenes";
  preview.setAttribute("aria-label", "Scenes included in actor sides");
  const summary = document.createElement("p");
  summary.setAttribute("role", "status");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "primary";
  exportButton.textContent = "Download actor sides PDF";
  dialog.append(
    title,
    close,
    explanation,
    snapshotLabel,
    searchLabel,
    selectLabel,
    select,
    matches,
    includeLabel,
    summary,
    preview,
    status,
    dialogActions(exportButton),
    dialogDisclosure("About actor sides", details),
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let snapshot: ActorSidesSnapshot | undefined;
  let project: ActorSidesProject | undefined;
  let result: ActorSidesResult | undefined;
  let generation = 0;
  let busy = false;
  let previewKey: string | undefined;
  let opener: HTMLElement | undefined;
  function clear() {
    generation++;
    snapshot = undefined;
    project = undefined;
    result = undefined;
    previewKey = undefined;
    busy = false;
    select.replaceChildren();
    preview.replaceChildren();
    summary.textContent = status.textContent = snapshotLabel.textContent = matches.textContent = "";
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  close.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) clear();
  });
  function controls() {
    search.disabled = select.disabled = busy || !project;
    includeTitle.disabled = busy || !project?.hasScriptTitle;
    exportButton.disabled = busy || !result;
    exportButton.textContent = busy ? "Preparing actor sides…" : "Download actor sides PDF";
  }
  function updatePreview() {
    const key = `${select.value}:${includeTitle.checked}`;
    if (result && previewKey === key) {
      controls();
      return;
    }
    generation++;
    result = undefined;
    status.textContent = "";
    preview.replaceChildren();
    summary.textContent = "";
    try {
      const index = Number(select.value);
      const character = select.value === "" ? undefined : project?.characters[index];
      if (character && snapshot) {
        result = project?.build(character.name, snapshot.paper, {
          includeScriptTitle: includeTitle.checked,
        });
        if (result) {
          previewKey = key;
          for (const segment of result.segments.slice(0, 100)) {
            const item = document.createElement("li");
            item.textContent = `${segment.heading.length > 240 ? `${segment.heading.slice(0, 240)}…` : segment.heading} · source lines ${segment.line}–${segment.endLine} · ${segment.cues} speaking ${segment.cues === 1 ? "cue" : "cues"}`;
            preview.append(item);
          }
          summary.textContent = `${result.segments.length} ${result.segments.length === 1 ? "segment" : "segments"} · ${result.layout.pages.length} PDF pages including cover${result.segments.length > 100 ? ". Showing the first 100 segments; the PDF includes all selected segments." : "."}`;
          if (result.layout.warnings.length)
            status.textContent = result.layout.warnings.slice(0, 10).join(" ");
        }
      }
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Could not prepare actor sides.";
    }
    controls();
  }
  function filter(preferredRole?: string) {
    const previous = select.value;
    select.replaceChildren();
    const query = search.value.trim().normalize("NFC").toLowerCase();
    let found = 0;
    const entries = [...(project?.characters ?? []).entries()];
    entries.sort(
      (a, b) => Number(b[1].name === preferredRole) - Number(a[1].name === preferredRole),
    );
    for (const [index, character] of entries) {
      if (!character.name.normalize("NFC").toLowerCase().includes(query)) continue;
      found++;
      if (found > 100) continue;
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${character.name.slice(0, 160)} · ${countLabel(character.segments, "segment")}`;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    matches.textContent = `${found} matching ${found === 1 ? "character" : "characters"}${found > 100 ? "; showing the first 100. Narrow the search to find another role." : "."}`;
    const preferred =
      project?.characters.findIndex((character) => character.name === preferredRole) ?? -1;
    if (preferred >= 0) select.value = String(preferred);
    updatePreview();
  }
  search.oninput = () => filter();
  select.onchange = updatePreview;
  includeTitle.onchange = updatePreview;
  exportButton.onclick = async () => {
    if (!snapshot || !result || busy) return;
    const captured = result;
    const file = `${filenameStem(`${filenameStem(snapshot.name)}-${captured.character}-actor-sides`)}.pdf`;
    const version = generation;
    busy = true;
    status.textContent =
      "Preparing the selected snapshot. Closing this dialog cancels its download.";
    controls();
    try {
      const { screenplayPdf } = await import("./pdf");
      if (version !== generation || !dialog.open) return;
      const bytes = await screenplayPdf(captured.layout, captured.title);
      if (version !== generation || !dialog.open) return;
      actions.download(new Uint8Array(bytes).buffer, file, "application/pdf");
      status.textContent = "Actor sides PDF download started. Your screenplay is unchanged.";
    } catch (error) {
      if (version === generation && dialog.open)
        status.textContent =
          error instanceof Error
            ? error.message
            : "Actor sides export failed. Your screenplay is unchanged.";
    } finally {
      if (version === generation) {
        busy = false;
        controls();
      }
    }
  };
  return {
    open(selection?: { role: string }) {
      if (dialog.open) return;
      clear();
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      search.value = "";
      includeTitle.checked = false;
      try {
        snapshot = { ...actions.current() };
        snapshotLabel.textContent = `${snapshot.name} · ${snapshot.paper === "a4" ? "A4" : "US Letter"}`;
        project = prepareActorSides(snapshot.source);
        filter(selection?.role);
        if (!project.characters.length)
          status.textContent = "No characters with spoken dialogue were found in this snapshot.";
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "Could not read this screenplay snapshot.";
      }
      controls();
      dialog.showModal();
      (search.disabled ? close : search).focus();
    },
    close: dismiss,
  };
}
