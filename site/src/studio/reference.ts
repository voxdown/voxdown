import { MAX_SOURCE, readSource } from "./source";

/** A session-only, literal text reference beside the authoritative screenplay. */
export function mountReference(host: HTMLElement, reveal: () => void) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  }
  const heading = host.querySelector<HTMLElement>(".panel-heading");
  const pagePanel = node("div");
  pagePanel.id = "studio-page-panel";
  pagePanel.className = "studio-side-panel";
  pagePanel.setAttribute("role", "tabpanel");
  pagePanel.setAttribute("aria-labelledby", "studio-page-tab");
  for (const child of [...host.children]) if (child !== heading) pagePanel.append(child);
  const reference = node("div");
  reference.id = "studio-reference-panel";
  reference.className = "studio-side-panel studio-reference";
  reference.setAttribute("role", "tabpanel");
  reference.setAttribute("aria-labelledby", "studio-reference-tab");
  const tabs = node("div");
  tabs.className = "studio-side-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Beside your screenplay");
  const pageTab = node("button", "Page preview");
  const referenceTab = node("button", "Text reference");
  for (const [tab, panel, id] of [
    [pageTab, pagePanel, "studio-page-tab"],
    [referenceTab, reference, "studio-reference-tab"],
  ] as const) {
    tab.type = "button";
    tab.id = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.onclick = () => select(tab === referenceTab);
    tabs.append(tab);
  }
  const controls = node("div");
  controls.className = "reference-controls";
  const open = node("button", "Open text reference…");
  open.type = "button";
  const clear = node("button", "Clear reference");
  clear.type = "button";
  clear.disabled = true;
  controls.append(open, clear);
  const file = node("input");
  file.type = "file";
  file.accept = ".txt,.md,.fountain,.vxd,text/plain,text/markdown";
  file.hidden = true;
  const status = node(
    "p",
    "Choose a text, Markdown, Fountain or VoxDown file. It appears as plain text here.",
  );
  status.setAttribute("role", "status");
  const name = node("p", "No reference open");
  name.className = "reference-name";
  const content = node("textarea");
  content.readOnly = true;
  content.spellcheck = false;
  content.setAttribute("aria-label", "Reference text (read only)");
  const hint = node(
    "p",
    "This reference stays only in this tab until cleared or reloaded. It is not included in your screenplay, PDF, recovery or backups. Private notes in the chosen file are visible here.",
  );
  hint.className = "reference-hint";
  reference.append(controls, name, status, content, hint, file);
  host.append(tabs, pagePanel, reference);
  let generation = 0;
  function select(isReference: boolean) {
    pagePanel.hidden = isReference;
    reference.hidden = !isReference;
    pageTab.setAttribute("aria-selected", String(!isReference));
    referenceTab.setAttribute("aria-selected", String(isReference));
    pageTab.tabIndex = isReference ? -1 : 0;
    referenceTab.tabIndex = isReference ? 0 : -1;
    if (heading) {
      const title = heading.querySelector("h2");
      const caption = heading.querySelector("span");
      if (title) title.textContent = isReference ? "Beside your screenplay" : "On the page";
      if (caption)
        caption.textContent = isReference ? "Read only · this tab" : "Same layout as PDF";
    }
  }
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const isReference =
      event.key === "End" || (event.key !== "Home" && document.activeElement === pageTab);
    select(isReference);
    (isReference ? referenceTab : pageTab).focus();
  });
  open.onclick = () => file.click();
  clear.onclick = () => {
    generation++;
    content.value = "";
    file.value = "";
    name.textContent = "No reference open";
    status.textContent = "Reference cleared. Your screenplay is unchanged.";
    clear.disabled = true;
    open.focus();
  };
  file.onchange = async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    const ticket = ++generation;
    status.textContent = "Opening reference…";
    clear.disabled = false;
    try {
      if (!/\.(txt|md|fountain|vxd)$/i.test(chosen.name))
        throw new Error("Choose a .txt, .md, .fountain or .vxd text file.");
      if (chosen.size > MAX_SOURCE * 4)
        throw new Error(
          "This reference is too large. Choose a text file of up to 500,000 characters.",
        );
      const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await chosen.arrayBuffer(),
      );
      const source = readSource(decoded);
      if (ticket !== generation) return;
      content.value = source.normalized;
      name.textContent = chosen.name;
      status.textContent = "Reference open as plain text. Your screenplay is unchanged.";
      clear.disabled = false;
      content.scrollTop = 0;
      // A file read may finish after the writer has resumed typing elsewhere.
      if (!reference.hidden && reference.contains(document.activeElement)) content.focus();
    } catch (error) {
      if (ticket === generation)
        status.textContent =
          error instanceof Error
            ? `Could not open reference: ${error.message}`
            : "Could not open this reference. Choose a UTF-8 text file.";
    }
  };
  select(false);
  return {
    open() {
      reveal();
      select(true);
      open.focus();
    },
    showPage() {
      select(false);
    },
    isReference() {
      return !reference.hidden;
    },
  };
}
