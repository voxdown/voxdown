import type { ScreenplayLayout } from "./layout";
import type { StudioPreferences } from "./preferences";

type Mode = StudioPreferences["previewMode"];
/** The PDF layout stays authoritative. Only the visible sheets acquire DOM nodes. */
export function mountPagePreview(options: {
  page: HTMLElement;
  scroll: HTMLElement;
  label: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  zoom: HTMLButtonElement;
  mode: HTMLSelectElement;
  initialMode: Mode;
  onPage(index: number): void;
  onMode(mode: Mode): void;
}) {
  const { page, scroll, label, previous, next, zoom, mode } = options;
  let layout: ScreenplayLayout | undefined;
  let selected = 0;
  let currentMode = options.initialMode;
  let full = false;
  let sheetHeight = 0;
  let stride = 0;
  let scrollFrame = 0;
  let positionedScroll: number | undefined;
  let lastWheel = Number.NEGATIVE_INFINITY;
  let wheelAmount = 0;
  let gestureConsumed = false;
  let gestureScrolled = false;
  const gap = 20;
  const sheets = new Map<number, HTMLElement>();
  mode.value = currentMode;

  function updateControls() {
    const count = layout?.pages.length ?? 0;
    const number = layout?.pages[selected]?.number;
    if (count) {
      const text = `${number === null ? "Title page" : `Page ${number}`} · ${selected + 1} of ${count}`;
      if (label.textContent !== text) label.textContent = text;
    }
    previous.disabled = selected <= 0 || !count;
    next.disabled = selected >= count - 1 || !count;
    zoom.disabled = !count;
    zoom.setAttribute("aria-pressed", String(full));
    zoom.textContent = full ? (currentMode === "single" ? "Fit page" : "Fit width") : "Full size";
    scroll.setAttribute(
      "aria-label",
      currentMode === "single"
        ? "Screenplay preview, single page. Scroll to turn pages."
        : "Screenplay preview, continuous scrolling.",
    );
  }
  function setPage(index: number) {
    selected = Math.max(0, Math.min(index, (layout?.pages.length ?? 1) - 1));
    options.onPage(selected);
    updateControls();
  }
  function makeSheet(index: number) {
    const sheet = document.createElement("div");
    sheet.className = "preview-sheet";
    sheet.dataset.pageIndex = String(index);
    const current = layout?.pages[index];
    sheet.setAttribute("role", "document");
    sheet.setAttribute(
      "aria-label",
      current?.number === null ? "Title page" : `Page ${current?.number}`,
    );
    if (!layout || !current) return sheet;
    for (const line of current.lines) {
      const row = document.createElement("div");
      row.className = "page-line";
      row.style.left = `${(line.x / layout.width) * 100}%`;
      row.style.top = `${(line.y / layout.height) * 100}%`;
      for (const run of line.runs) {
        const span = document.createElement("span");
        span.textContent = run.text;
        if (run.bold) span.style.fontWeight = "700";
        if (run.italic) span.style.fontStyle = "italic";
        if (run.underline) span.style.textDecoration = "underline";
        row.append(span);
      }
      sheet.append(row);
    }
    return sheet;
  }
  function renderVisible() {
    if (!layout || !stride) return;
    const continuous = currentMode === "continuous";
    const start = continuous ? Math.max(0, Math.floor(scroll.scrollTop / stride) - 1) : selected;
    const end = continuous
      ? Math.min(
          layout.pages.length - 1,
          Math.ceil((scroll.scrollTop + scroll.clientHeight) / stride) + 1,
        )
      : selected;
    for (const [index, sheet] of sheets) {
      if (index < start || index > end) {
        sheet.remove();
        sheets.delete(index);
      }
    }
    for (let index = start; index <= end; index++) {
      let sheet = sheets.get(index);
      if (!sheet) {
        sheet = makeSheet(index);
        sheets.set(index, sheet);
        // Keep the DOM reading order in page order when scrolling backwards.
        const later = Array.from(page.children).find(
          (child) => Number((child as HTMLElement).dataset.pageIndex) > index,
        );
        page.insertBefore(sheet, later ?? null);
      }
      sheet.style.top = `${continuous ? index * stride : 0}px`;
      sheet.style.height = `${sheetHeight}px`;
      sheet.classList.toggle("has-next-page", continuous && index < layout.pages.length - 1);
    }
  }
  function size(jump = false) {
    if (!layout?.pages.length || !scroll.clientWidth || !scroll.clientHeight) return;
    const style = getComputedStyle(scroll);
    const width = Math.max(
      1,
      scroll.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
    );
    const height = Math.max(
      1,
      scroll.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom),
    );
    const oldStride = stride;
    const offset = oldStride ? scroll.scrollTop / oldStride : selected;
    const sheetWidth = full
      ? (layout.width * 4) / 3
      : currentMode === "single"
        ? Math.min(width, (height * layout.width) / layout.height)
        : Math.min(width, (layout.width * 4) / 3);
    sheetHeight = (sheetWidth * layout.height) / layout.width;
    stride = sheetHeight + gap;
    const continuous = currentMode === "continuous";
    page.classList.toggle("continuous-pages", continuous);
    page.classList.toggle("full-size", full);
    page.style.width = `${sheetWidth}px`;
    page.style.maxWidth = "none";
    page.style.height = `${continuous ? layout.pages.length * stride - gap : sheetHeight}px`;
    page.style.aspectRatio = "auto";
    page.style.setProperty("--page-width", String(layout.width));
    page.setAttribute("role", "group");
    page.setAttribute("aria-label", continuous ? "Screenplay pages" : "Current screenplay page");
    const priorTop = scroll.scrollTop;
    scroll.scrollTop = continuous
      ? (jump ? selected : offset) * stride
      : jump
        ? 0
        : scroll.scrollTop;
    if (scroll.scrollTop !== priorTop) positionedScroll = scroll.scrollTop;
    renderVisible();
  }
  function go(index: number) {
    setPage(index);
    size(true);
  }
  function onScroll() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (currentMode !== "continuous" || !layout || !stride) return;
      const positioned = positionedScroll;
      positionedScroll = undefined;
      if (positioned === undefined || Math.abs(positioned - scroll.scrollTop) > 1) {
        const top = Number.parseFloat(getComputedStyle(scroll).paddingTop);
        const max = scroll.scrollHeight - scroll.clientHeight;
        setPage(
          max > 1 && scroll.scrollTop >= max - 1
            ? layout.pages.length - 1
            : Math.floor(
                Math.max(
                  0,
                  scroll.scrollTop - top + Math.min(scroll.clientHeight / 4, sheetHeight / 4),
                ) / stride,
              ),
        );
      }
      renderVisible();
    });
  }
  function onWheel(event: WheelEvent) {
    if (
      currentMode !== "single" ||
      !layout ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return;
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1);
    if (!delta) return;
    const now = performance.now();
    if (now - lastWheel > 200) {
      wheelAmount = 0;
      gestureConsumed = false;
      gestureScrolled = false;
    }
    lastWheel = now;
    if (gestureConsumed) {
      event.preventDefault();
      return;
    }
    const canScroll =
      delta > 0
        ? scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2
        : scroll.scrollTop > 2;
    if (canScroll) {
      gestureScrolled = true;
      return;
    }
    event.preventDefault();
    if (gestureScrolled) return;
    wheelAmount += delta;
    if (Math.abs(wheelAmount) < 24) return;
    gestureConsumed = true;
    const target = selected + Math.sign(wheelAmount);
    if (target < 0 || target >= layout.pages.length) return;
    go(target);
    // Enter the previous full-size page at its bottom, as in a document reader.
    if (full && delta < 0) scroll.scrollTop = scroll.scrollHeight;
  }
  function onKey(event: KeyboardEvent) {
    if (
      event.target !== scroll ||
      currentMode !== "single" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (!["PageDown", "PageUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    go(
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? (layout?.pages.length ?? 1) - 1
          : selected + (event.key === "PageDown" ? 1 : -1),
    );
  }
  const previousPage = () => go(selected - 1);
  const nextPage = () => go(selected + 1);
  const changeZoom = () => {
    lastWheel = Number.NEGATIVE_INFINITY;
    full = !full;
    updateControls();
    size(true);
  };
  const changeMode = () => {
    lastWheel = Number.NEGATIVE_INFINITY;
    currentMode = mode.value === "continuous" ? "continuous" : "single";
    gestureConsumed = false;
    options.onMode(currentMode);
    updateControls();
    size(true);
  };
  previous.addEventListener("click", previousPage);
  next.addEventListener("click", nextPage);
  zoom.addEventListener("click", changeZoom);
  mode.addEventListener("change", changeMode);
  scroll.addEventListener("scroll", onScroll, { passive: true });
  scroll.addEventListener("wheel", onWheel, { passive: false });
  scroll.addEventListener("keydown", onKey);
  const observer = new ResizeObserver(() => size());
  observer.observe(scroll);
  updateControls();
  return {
    update(nextLayout: ScreenplayLayout | undefined, index: number, message: string, jump = false) {
      const shouldJump = jump || index !== selected;
      if (layout !== nextLayout) {
        sheets.clear();
        page.replaceChildren();
      }
      layout = nextLayout;
      setPage(index);
      if (!layout?.pages.length) {
        page.removeAttribute("style");
        page.classList.remove("continuous-pages");
        label.textContent = message;
        return;
      }
      size(shouldJump);
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(scrollFrame);
      previous.removeEventListener("click", previousPage);
      next.removeEventListener("click", nextPage);
      zoom.removeEventListener("click", changeZoom);
      mode.removeEventListener("change", changeMode);
      scroll.removeEventListener("scroll", onScroll);
      scroll.removeEventListener("wheel", onWheel);
      scroll.removeEventListener("keydown", onKey);
    },
  };
}
