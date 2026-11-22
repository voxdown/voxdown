type PanelElements = {
  app: HTMLElement;
  workspace: HTMLElement;
  outline: HTMLElement;
  writing: HTMLElement;
  preview: HTMLElement;
  outlineToggle?: HTMLButtonElement;
  outlineClose?: HTMLButtonElement;
  /** Explicit open/close requests only; responsive and Focus layout changes do not persist. */
  onOutlineChange?: (open: boolean) => void;
};
type Widths = { outline: number; preview: number | null };
const STORAGE_KEY = "voxdown.studio.panel-widths.v1";
const DEFAULT_OUTLINE = 224;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Layout only: never reads or changes the screenplay or its editor selection. */
export function mountWorkspacePanels(elements: PanelElements) {
  const { app, workspace, outline, writing, preview, outlineToggle, outlineClose } = elements;
  const document = app.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Workspace must belong to a browser document.");
  let widths: Widths = { outline: DEFAULT_OUTLINE, preview: null };
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const value = saved as Partial<Widths>;
      if (typeof value.outline === "number" && Number.isFinite(value.outline))
        widths.outline = clamp(value.outline, 180, 360);
      if (typeof value.preview === "number" && Number.isFinite(value.preview))
        widths.preview = clamp(value.preview, 280, 4000);
    }
  } catch {
    // Storage is optional, including in private browsing and blocked origins.
  }
  const save = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // A layout preference must not interrupt writing.
    }
  };
  const separator = (name: string, control: HTMLElement) => {
    const element = document.createElement("div");
    element.className = "workspace-separator";
    element.tabIndex = 0;
    element.setAttribute("role", "separator");
    element.setAttribute("aria-label", `Resize ${name}`);
    element.setAttribute("aria-orientation", "vertical");
    if (control.id) element.setAttribute("aria-controls", control.id);
    element.title = `Resize ${name}. Use arrow keys; double-click to reset.`;
    return element;
  };
  const outlineHandle = separator("Scenes panel", outline);
  outlineHandle.classList.add("outline-separator");
  outline.after(outlineHandle);
  const previewHandle = separator("preview panel", preview);
  previewHandle.classList.add("preview-separator");
  writing.after(previewHandle);
  let disposed = false;
  let drag: {
    handle: HTMLElement;
    pointer: number;
    x: number;
    start: number;
    before: Widths;
  } | null = null;
  let actual = { outline: DEFAULT_OUTLINE, preview: 280, previewMax: 280 };
  const desktop = () => window.innerWidth > 1100;
  const outlineVisible = () =>
    !app.classList.contains("focus-writing") &&
    !app.classList.contains("preview-expanded") &&
    (desktop()
      ? !app.classList.contains("outline-collapsed")
      : app.classList.contains("outline-open"));
  const updateValue = (handle: HTMLElement, value: number, min: number, max: number) => {
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
    handle.setAttribute("aria-valuetext", `${Math.round(value)} pixels`);
  };
  const refreshLayouts = () => {
    if (disposed) return;
    const mobile = window.innerWidth <= 700;
    const single =
      app.classList.contains("focus-writing") || app.classList.contains("preview-expanded");
    const scenes = outlineVisible();
    const hasPreview = !app.classList.contains("no-preview") && !single && !mobile;
    const outlineWidth = clamp(widths.outline, 180, 360);
    const available = Math.max(
      0,
      workspace.clientWidth - (desktop() && scenes ? outlineWidth + 8 : 0),
    );
    const previewMax = Math.max(280, available - 328);
    const previewWidth = clamp(widths.preview ?? (available - 8) * 0.46, 280, previewMax);
    actual = { outline: outlineWidth, preview: previewWidth, previewMax };
    workspace.style.setProperty("--outline-width", `${outlineWidth}px`);
    workspace.style.setProperty("--preview-width", `${previewWidth}px`);
    outlineHandle.hidden = !desktop() || !scenes || single;
    previewHandle.hidden = !hasPreview || window.innerWidth < 760;
    outlineToggle?.setAttribute("aria-expanded", String(scenes));
    outlineToggle?.setAttribute("aria-pressed", String(scenes));
    if (outlineClose) outlineClose.hidden = !scenes;
    updateValue(outlineHandle, outlineWidth, 180, 360);
    updateValue(previewHandle, previewWidth, 280, previewMax);
    if (drag?.handle.hidden) finish(false);
  };
  const setOutline = (open: boolean) => {
    if (disposed) return;
    if (desktop()) app.classList.toggle("outline-collapsed", !open);
    else app.classList.toggle("outline-open", open);
    refreshLayouts();
    elements.onOutlineChange?.(open);
  };
  const closeOutline = () => {
    setOutline(false);
    outlineToggle?.focus();
  };
  const setWidth = (handle: HTMLElement, value: number) => {
    if (handle === outlineHandle) widths.outline = clamp(value, 180, 360);
    else widths.preview = clamp(value, 280, actual.previewMax);
    refreshLayouts();
  };
  const finish = (commit: boolean) => {
    const previous = drag;
    if (!previous) return;
    drag = null;
    if (!commit) widths = previous.before;
    app.classList.remove("resizing-panels");
    if (previous.handle.hasPointerCapture(previous.pointer))
      previous.handle.releasePointerCapture(previous.pointer);
    if (commit) save();
    refreshLayouts();
  };
  const pointerdown = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    if (event.button !== 0 || !event.isPrimary || handle.hidden || app.inert) return;
    event.preventDefault();
    finish(false);
    handle.focus({ preventScroll: true });
    drag = {
      handle,
      pointer: event.pointerId,
      x: event.clientX,
      start: handle === outlineHandle ? actual.outline : actual.preview,
      before: { ...widths },
    };
    handle.setPointerCapture(event.pointerId);
    app.classList.add("resizing-panels");
  };
  const pointermove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    setWidth(
      drag.handle,
      drag.start + (event.clientX - drag.x) * (drag.handle === outlineHandle ? 1 : -1),
    );
  };
  const pointerup = (event: PointerEvent) => {
    if (drag?.pointer === event.pointerId) finish(true);
  };
  const cancelPointer = () => finish(false);
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented || app.inert) return;
    const handle = event.currentTarget as HTMLElement;
    let next: number;
    const value = handle === outlineHandle ? actual.outline : actual.preview;
    const delta = event.shiftKey ? 40 : 16;
    if (event.key === "Home") next = handle === outlineHandle ? 180 : 280;
    else if (event.key === "End") next = handle === outlineHandle ? 360 : actual.previewMax;
    else if (event.key === "ArrowLeft") next = value + (handle === outlineHandle ? -delta : delta);
    else if (event.key === "ArrowRight") next = value + (handle === outlineHandle ? delta : -delta);
    else return;
    event.preventDefault();
    if (drag) finish(false);
    setWidth(handle, next);
    save();
  };
  const reset = (event: MouseEvent) => {
    finish(false);
    if (event.currentTarget === outlineHandle) widths.outline = DEFAULT_OUTLINE;
    else widths.preview = null;
    refreshLayouts();
    save();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.isComposing ||
      app.inert ||
      document.querySelector("dialog[open]")
    )
      return;
    if (drag) {
      event.preventDefault();
      finish(false);
    } else if (!desktop() && outlineVisible()) {
      event.preventDefault();
      closeOutline();
    }
  };
  const outsidePointer = (event: PointerEvent) => {
    const target = event.target;
    if (
      event.button !== 0 ||
      desktop() ||
      !outlineVisible() ||
      app.inert ||
      !(target instanceof Element) ||
      document.querySelector("dialog[open]") ||
      outline.contains(target) ||
      outlineToggle?.contains(target) ||
      target.closest('.workspace-dropdown, [aria-haspopup="menu"], .workspace-menus')
    )
      return;
    // Do not prevent the pointer's normal focus/selection or move focus to Scenes.
    setOutline(false);
  };
  const blur = () => finish(false);
  const observer = new ResizeObserver(refreshLayouts);
  observer.observe(workspace);
  const classes = new MutationObserver(refreshLayouts);
  classes.observe(app, { attributes: true, attributeFilter: ["class"] });
  for (const handle of [outlineHandle, previewHandle]) {
    handle.addEventListener("pointerdown", pointerdown);
    handle.addEventListener("pointermove", pointermove);
    handle.addEventListener("pointerup", pointerup);
    handle.addEventListener("pointercancel", cancelPointer);
    handle.addEventListener("lostpointercapture", cancelPointer);
    handle.addEventListener("blur", cancelPointer);
    handle.addEventListener("keydown", keydown);
    handle.addEventListener("dblclick", reset);
  }
  outlineClose?.addEventListener("click", closeOutline);
  document.addEventListener("keydown", onEscape);
  document.addEventListener("pointerdown", outsidePointer);
  window.addEventListener("blur", blur);
  window.addEventListener("resize", refreshLayouts);
  refreshLayouts();
  return {
    setOutline,
    toggleOutline: () => setOutline(!outlineVisible()),
    refreshLayouts,
    dispose: () => {
      finish(false);
      disposed = true;
      observer.disconnect();
      classes.disconnect();
      for (const handle of [outlineHandle, previewHandle]) {
        handle.removeEventListener("pointerdown", pointerdown);
        handle.removeEventListener("pointermove", pointermove);
        handle.removeEventListener("pointerup", pointerup);
        handle.removeEventListener("pointercancel", cancelPointer);
        handle.removeEventListener("lostpointercapture", cancelPointer);
        handle.removeEventListener("blur", cancelPointer);
        handle.removeEventListener("keydown", keydown);
        handle.removeEventListener("dblclick", reset);
      }
      outlineHandle.remove();
      previewHandle.remove();
      outlineClose?.removeEventListener("click", closeOutline);
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("pointerdown", outsidePointer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", refreshLayouts);
      workspace.style.removeProperty("--outline-width");
      workspace.style.removeProperty("--preview-width");
    },
  };
}
