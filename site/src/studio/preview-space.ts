type PreviewSpaceElements = {
  app: HTMLElement;
  preview: HTMLElement;
  writing: HTMLElement;
  outline: HTMLElement;
  button: HTMLButtonElement;
};

/** A temporary layout change only: the editor keeps its document and selection. */
export function mountPreviewSpace(
  elements: PreviewSpaceElements,
  focusWriting: () => void,
): {
  expand: () => boolean;
  restore: (focus?: boolean) => void;
  toggle: () => void;
  expanded: () => boolean;
  dispose: () => void;
} {
  const { app, preview, writing, outline, button } = elements;
  const document = app.ownerDocument;
  const mobile = document.defaultView?.matchMedia("(max-width: 700px)");
  const panel = button.closest<HTMLElement>('[role="tabpanel"]');
  let active = false;
  let disposed = false;
  let previousInert = { writing: false, outline: false };
  const update = () => {
    button.hidden = mobile?.matches ?? false;
    button.textContent = active ? "Return to writing" : "Expand preview";
    button.setAttribute("aria-pressed", String(active));
    if (preview.id) button.setAttribute("aria-controls", preview.id);
  };
  const restore = (focus = true) => {
    if (!active) return;
    active = false;
    app.classList.remove("preview-expanded");
    writing.inert = previousInert.writing;
    outline.inert = previousInert.outline;
    update();
    if (focus && !app.inert) focusWriting();
  };
  const expand = () => {
    if (
      disposed ||
      active ||
      mobile?.matches ||
      app.inert ||
      preview.hidden ||
      button.closest("[hidden]") ||
      button.disabled ||
      app.classList.contains("focus-writing") ||
      app.classList.contains("no-preview")
    )
      return false;
    previousInert = { writing: writing.inert, outline: outline.inert };
    active = true;
    writing.inert = true;
    outline.inert = true;
    app.classList.add("preview-expanded");
    update();
    button.focus();
    return true;
  };
  const toggle = () => {
    if (active) restore();
    else expand();
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      !active ||
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.isComposing ||
      app.inert ||
      document.querySelector("dialog[open]")
    )
      return;
    event.preventDefault();
    restore();
  };
  const resize = () => {
    if (mobile?.matches) restore(false);
    update();
  };
  // A text-reference tab can hide the page controls, including the return button.
  const panelObserver = new MutationObserver(() => {
    if (panel?.hidden) restore(false);
  });
  if (panel) panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  button.addEventListener("click", toggle);
  document.addEventListener("keydown", keydown);
  mobile?.addEventListener("change", resize);
  update();
  return {
    expand,
    restore,
    toggle,
    expanded: () => active,
    dispose: () => {
      restore(false);
      disposed = true;
      button.removeEventListener("click", toggle);
      document.removeEventListener("keydown", keydown);
      mobile?.removeEventListener("change", resize);
      panelObserver.disconnect();
    },
  };
}
