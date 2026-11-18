import { type FdxExport, exportFdx } from "./fdx";
import { filenameStem } from "./filename";

export function mountFdxExport(
  host: HTMLElement,
  actions: {
    current(): { source: string; name: string };
    download(bytes: BlobPart, name: string, type: string): void;
  },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "studio-fdx-export";
  dialog.setAttribute("aria-labelledby", "fdx-export-title");
  const title = document.createElement("h2");
  title.id = "fdx-export-title";
  title.textContent = "Export Final Draft XML (.fdx)";
  const description = document.createElement("p");
  description.textContent =
    "Export an editable screenplay snapshot. Private notes, omitted passages and outlines stay out. This is an interchange file, not an exact Fountain backup. Review the compatibility report before downloading.";
  const snapshotLabel = document.createElement("p");
  const label = document.createElement("label");
  const includeTitle = document.createElement("input");
  includeTitle.type = "checkbox";
  label.append(
    includeTitle,
    " Include recognized title fields, including author and contact details",
  );
  const report = document.createElement("ul");
  report.setAttribute("aria-label", "FDX compatibility report");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const download = document.createElement("button");
  download.type = "button";
  download.textContent = "Download FDX";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  dialog.append(title, description, snapshotLabel, label, report, status, download, close);
  host.append(dialog);
  let snapshot: { source: string; name: string } | undefined;
  let result: FdxExport | undefined;
  let opener: HTMLElement | undefined;
  function clear() {
    snapshot = undefined;
    result = undefined;
    report.replaceChildren();
    status.textContent = snapshotLabel.textContent = "";
    download.disabled = true;
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  function prepare() {
    result = undefined;
    report.replaceChildren();
    download.disabled = true;
    if (!snapshot) return;
    try {
      result = exportFdx(snapshot.source, { includeTitle: includeTitle.checked });
      for (const message of result.report) {
        const item = document.createElement("li");
        item.textContent = message;
        report.append(item);
      }
      status.textContent = `Ready: ${result.bytes.toLocaleString()} UTF-8 bytes. Your Fountain screenplay remains unchanged.`;
      download.disabled = false;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Could not prepare this FDX export.";
    }
  }
  includeTitle.onchange = prepare;
  download.onclick = () => {
    if (!dialog.open || !snapshot || !result) return;
    try {
      actions.download(
        result.xml,
        `${filenameStem(snapshot.name)}.fdx`,
        "application/xml;charset=utf-8",
      );
      status.textContent =
        "FDX download started. Open it in the receiving app and check its layout. Your Fountain source is unchanged.";
    } catch {
      status.textContent =
        "The download could not start. Try again; your Fountain source is unchanged.";
    }
  };
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
      includeTitle.checked = true;
      try {
        snapshot = { ...actions.current() };
        snapshotLabel.textContent = `Snapshot of ${snapshot.name}. Close and reopen to include later edits.`;
        prepare();
      } catch {
        status.textContent = "Could not read the screenplay. Close and retry.";
      }
      dialog.showModal();
      close.focus();
    },
    close: dismiss,
  };
}
