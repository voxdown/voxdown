import type { VoxDownAdaptation } from "./adaptation";
import { AdaptationClient } from "./adaptation-client";
import { arrangeDialogHeader, countLabel, dialogActions, dialogDisclosure } from "./dialog-layout";
import { filenameStem } from "./filename";

let instance = 0;
export function mountAdaptation(
  host: HTMLElement,
  actions: {
    current(): { source: string; name: string };
    download(bytes: BlobPart, name: string, type: string): void;
  },
) {
  const id = ++instance;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const dialog = node("dialog");
  dialog.className = "adaptation-dialog";
  const title = node("h2", "Adapt to VoxDown");
  title.id = `adaptation-title-${id}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const explanation = node(
    "p",
    "Action becomes narration. Private notes, outlines and title/contact details stay out.",
  );
  const snapshotLabel = node("p");
  const sceneLabel = node("label");
  const readScenes = node("input");
  readScenes.type = "checkbox";
  sceneLabel.append(readScenes, " Read scene headings aloud");
  const report = node("ul");
  report.setAttribute("aria-label", "VoxDown adaptation report");
  const cast = node("ul");
  cast.className = "adaptation-cast";
  cast.tabIndex = 0;
  cast.setAttribute("aria-label", "Adapted cast handles");
  const castNote = node("p");
  const dualLabel = node("label");
  const dual = node("input");
  dual.type = "checkbox";
  dualLabel.append(
    dual,
    " I accept reading overlapping dialogue in source order, without simultaneous timing",
  );
  dualLabel.hidden = true;
  const details = node("details");
  const summary = node("summary", "Inspect the generated VoxDown text");
  const preview = node("textarea");
  preview.className = "adaptation-preview";
  preview.readOnly = true;
  preview.spellcheck = false;
  preview.setAttribute("aria-label", "Generated VoxDown preview (read only)");
  const previewNote = node("p");
  details.append(summary, previewNote, preview);
  const status = node("p");
  status.setAttribute("role", "status");
  const download = node("button", "Download adapted .vxd");
  const retry = node("button", "Retry preparation");
  retry.type = "button";
  retry.hidden = true;
  const close = node("button", "Close");
  download.type = close.type = "button";
  download.classList.add("primary");
  const consequences = node(
    "p",
    "Formatting and timing change. Keep your original Fountain file and review the performance.",
  );
  const compatibility = dialogDisclosure(
    "Adaptation details and cast",
    snapshotLabel,
    report,
    castNote,
    cast,
  );
  dialog.append(
    title,
    explanation,
    sceneLabel,
    status,
    consequences,
    dualLabel,
    dialogActions(download, retry),
    compatibility,
    details,
    close,
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  const client = new AdaptationClient();
  let snapshot: { source: string; name: string } | undefined;
  let result: VoxDownAdaptation | undefined;
  let generation = 0;
  let opener: HTMLElement | undefined;
  function invalidate() {
    result = undefined;
    report.replaceChildren();
    cast.replaceChildren();
    castNote.textContent = "";
    preview.value = "";
    previewNote.textContent = "";
    details.hidden = true;
    dual.checked = false;
    dualLabel.hidden = true;
    download.disabled = true;
  }
  async function prepare() {
    const ticket = ++generation;
    invalidate();
    retry.hidden = true;
    const captured = snapshot;
    if (!captured) return;
    const readSceneHeadings = readScenes.checked;
    status.textContent = "Preparing and validating the adaptation… Close this dialog to cancel.";
    try {
      // The heavy parser and validation live only in the on-demand worker.
      const prepared = await client.request(captured.source, readSceneHeadings);
      if (!dialog.open || ticket !== generation) return;
      result = prepared;
      for (const message of prepared.report) report.append(node("li", message));
      for (const member of prepared.cast.slice(0, 30))
        cast.append(node("li", `${member.handle} → ${member.name}`));
      castNote.textContent = `${countLabel(prepared.cast.length, "speaking role")}${prepared.cast.length > 30 ? "; showing the first 30 handles" : ""}. Narrator reads action; cast handles keep every role distinct.`;
      dualLabel.hidden = !prepared.dualCues;
      download.disabled = prepared.dualCues > 0;
      details.hidden = false;
      preview.value = prepared.source.slice(0, 8000);
      previewNote.textContent =
        prepared.source.length > 8000
          ? "Preview limited to the first 8,000 characters. Download includes the complete validated adaptation."
          : "Complete generated text. This is a separate adaptation, not your original screenplay.";
      status.textContent = `Validated: ${countLabel(prepared.cast.length, "role")} · ${countLabel(prepared.spokenRows, "spoken line")}.${prepared.dualCues ? " Overlapping dialogue needs your acknowledgment below." : " Ready to download."}`;
    } catch (error) {
      if (ticket === generation && dialog.open) {
        retry.hidden = false;
        status.textContent =
          error instanceof Error
            ? error.message
            : "Could not prepare the adaptation. Retry preparation.";
      }
    }
  }
  retry.onclick = () => {
    if (dialog.open && snapshot) void prepare();
  };
  readScenes.onchange = () => {
    void prepare();
  };
  dual.onchange = () => {
    download.disabled = !result || (result.dualCues > 0 && !dual.checked);
  };
  download.onclick = () => {
    if (!dialog.open || !snapshot || !result || (result.dualCues > 0 && !dual.checked)) return;
    try {
      actions.download(
        result.source,
        `${filenameStem(snapshot.name)}.vxd`,
        "text/plain;charset=utf-8",
      );
      status.textContent =
        "Adapted .vxd download started. Open it in VoxDown Writer yourself and review the performance. Your Fountain source is unchanged.";
    } catch {
      status.textContent =
        "The download could not start. Try again; your Fountain source is unchanged.";
    }
  };
  function clear() {
    generation++;
    client.close();
    retry.hidden = true;
    snapshot = undefined;
    invalidate();
    snapshotLabel.textContent = status.textContent = "";
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
  return {
    open() {
      if (dialog.open) return;
      clear();
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      readScenes.checked = false;
      details.open = false;
      compatibility.open = false;
      try {
        snapshot = { ...actions.current() };
        snapshotLabel.textContent = `Snapshot of ${snapshot.name}. Close and reopen to include later edits.`;
      } catch {
        status.textContent = "Could not read the screenplay. Close and retry.";
      }
      dialog.showModal();
      close.focus();
      if (snapshot) void prepare();
    },
    close: dismiss,
  };
}
