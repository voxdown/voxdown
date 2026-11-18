import { arrangeDialogHeader, dialogActions } from "./dialog-layout";
import { type FdxImportResult, MAX_FDX_IMPORT_BYTES, importFdx } from "./fdx-import";
import { filenameStem } from "./filename";

export function mountFdxImport(
  host: HTMLElement,
  actions: {
    /** The host must check isCurrent after any asynchronous save/replacement guard. */
    openScreenplay(
      value: { source: string; name: string },
      isCurrent: () => boolean,
    ): boolean | Promise<boolean>;
  },
) {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    return value;
  };
  const dialog = node("dialog");
  dialog.className = "studio-fdx-import";
  dialog.setAttribute("aria-labelledby", "fdx-import-title");
  const title = node("h2", "Import Final Draft XML (.fdx)");
  title.id = "fdx-import-title";
  const description = node(
    "p",
    "Choose a local UTF-8 FDX file and review compatibility before opening a new screenplay. This imports a conservative subset; keep your original FDX. No upload occurs. Title pages, script notes and production metadata are excluded.",
  );
  const label = node("label", "FDX file");
  const file = node("input");
  file.type = "file";
  file.accept = ".fdx,application/xml,text/xml";
  file.id = "fdx-import-file";
  label.htmlFor = file.id;
  const status = node("p");
  status.setAttribute("role", "status");
  const report = node("ul");
  report.setAttribute("aria-label", "FDX import compatibility report");
  const details = node("details");
  const summary = node("summary", "Preview converted Fountain (first 5,000 characters)");
  const preview = node("pre");
  preview.className = "fdx-import-preview";
  details.append(summary, preview);
  const open = node("button", "Open as new screenplay");
  open.type = "button";
  const close = node("button", "Close");
  close.type = "button";
  open.classList.add("primary");
  dialog.append(
    title,
    description,
    label,
    file,
    status,
    report,
    details,
    dialogActions(open),
    close,
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let generation = 0;
  let captured: { result: FdxImportResult; name: string } | undefined;
  let opener: HTMLElement | undefined;
  let pending = false;
  function clear() {
    generation++;
    captured = undefined;
    pending = false;
    file.disabled = false;
    file.value = "";
    open.disabled = true;
    report.replaceChildren();
    preview.textContent = "";
    status.textContent = "";
    details.open = false;
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  file.onchange = async () => {
    const selected = file.files?.[0];
    const token = ++generation;
    captured = undefined;
    open.disabled = true;
    report.replaceChildren();
    preview.textContent = "";
    details.open = false;
    if (!selected) {
      status.textContent = "Choose a local FDX file.";
      return;
    }
    status.textContent = "Reading local FDX file…";
    try {
      if (selected.size > MAX_FDX_IMPORT_BYTES)
        throw new Error("FDX import supports files up to 8 MB.");
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (token !== generation || !dialog.open) return;
      const result = importFdx(bytes);
      captured = { result, name: `${filenameStem(selected.name.replace(/\.fdx$/i, ""))}.fountain` };
      for (const message of result.report) report.append(node("li", message));
      preview.textContent =
        result.source.slice(0, 5000) +
        (result.source.length > 5000
          ? "\n… (preview truncated; opening uses the complete conversion)"
          : "");
      status.textContent = `Ready: ${captured.name}. Review the report, then explicitly open the new screenplay. Your current screenplay is unchanged.`;
      open.disabled = false;
    } catch (error) {
      if (token === generation && dialog.open)
        status.textContent =
          error instanceof Error ? error.message : "Could not read this FDX file.";
    }
  };
  open.onclick = async () => {
    if (pending || !captured || !dialog.open) return;
    const token = generation;
    const value = { source: captured.result.source, name: captured.name };
    const isCurrent = () => token === generation && dialog.open;
    pending = true;
    open.disabled = true;
    file.disabled = true;
    status.textContent = "Preparing the new screenplay…";
    try {
      const accepted = await actions.openScreenplay(value, isCurrent);
      if (!isCurrent()) return;
      if (accepted) {
        dismiss();
        return;
      }
      status.textContent =
        "Opening was canceled. Your current screenplay is unchanged; the conversion is ready to retry.";
    } catch {
      if (isCurrent())
        status.textContent = "The new screenplay could not open. The conversion is ready to retry.";
    } finally {
      if (isCurrent()) {
        pending = false;
        open.disabled = false;
        file.disabled = false;
      }
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
      status.textContent = "Choose a local FDX file.";
      dialog.showModal();
      file.focus();
    },
    close: dismiss,
  };
}
