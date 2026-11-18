import { arrangeDialogHeader, dialogActions } from "./dialog-layout";
import type { ScreenplayLayout } from "./layout";

/** Build once per layout; caret movement uses a binary search, not a page scan. */
export function manuscriptPageIndex(layout: ScreenplayLayout) {
  const first = new Map<number, number>();
  const pages: { number: number; line: number }[] = [];
  for (const sheet of layout.pages) {
    if (sheet.number === null) continue;
    const start = sheet.lines.find((row) => row.sourceLine > 0)?.sourceLine;
    if (start !== undefined) pages.push({ number: sheet.number, line: start });
    for (const row of sheet.lines)
      if (row.sourceLine > 0 && !first.has(row.sourceLine)) first.set(row.sourceLine, sheet.number);
  }
  const rows = [...first].sort(([a], [b]) => a - b);
  return {
    pages,
    at(line: number): number | undefined {
      if (!rows.length) return undefined;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if ((rows[middle]?.[0] ?? Number.POSITIVE_INFINITY) < line) low = middle + 1;
        else high = middle;
      }
      const after = rows[low];
      const before = rows[low - 1];
      return !after || (before && line - before[0] <= after[0] - line) ? before?.[1] : after[1];
    },
  };
}

export function mountManuscriptNavigation(
  host: HTMLElement,
  actions: { jump(line: number): void; zoom(size: 14 | 16 | 18 | 20): void },
) {
  const button = document.createElement("button");
  button.id = "manuscript-page";
  button.type = "button";
  button.title = "Go to a printed screenplay page";
  button.disabled = true;
  const zoom = document.createElement("select");
  zoom.id = "writing-zoom";
  zoom.setAttribute("aria-label", "Writing zoom");
  zoom.title = "Writing zoom; printed pages stay the same size";
  for (const size of [14, 16, 18, 20] as const) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = `${(size / 16) * 100}%`;
    zoom.append(option);
  }
  zoom.onchange = () => actions.zoom(Number(zoom.value) as 14 | 16 | 18 | 20);
  host.append(button, zoom);
  const dialog = document.createElement("dialog");
  dialog.className = "manuscript-navigation-dialog";
  dialog.setAttribute("aria-labelledby", "manuscript-navigation-title");
  const title = document.createElement("h2");
  title.id = "manuscript-navigation-title";
  title.textContent = "Go to page";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Screenplay page ";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.required = true;
  input.inputMode = "numeric";
  label.append(input);
  const hint = document.createElement("p");
  hint.textContent =
    "Jump to the source passage where this printed page begins. A long passage may span several pages. Use Page preview for exact printed wrapping.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "primary";
  go.textContent = "Go to page";
  form.append(label, hint, status, dialogActions(go));
  dialog.append(title, close, form);
  arrangeDialogHeader(dialog, title, close);
  document.body.append(dialog);
  let index: ReturnType<typeof manuscriptPageIndex> | undefined;
  let current: number | undefined;
  let opener: HTMLElement | undefined;
  const dismiss = () => {
    dialog.close();
    opener?.focus();
  };
  close.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  const open = () => {
    if (!index?.pages.length || dialog.open) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    input.value = String(current ?? 1);
    input.max = String(index.pages.at(-1)?.number ?? 1);
    status.textContent = "";
    dialog.showModal();
    input.focus();
    input.select();
  };
  button.onclick = open;
  form.onsubmit = (event) => {
    event.preventDefault();
    const target = index?.pages.find((page) => page.number === input.valueAsNumber);
    if (!target) {
      status.textContent = index
        ? "Choose a page in this screenplay."
        : "Pages are updating. Try again when the page count is ready.";
      return;
    }
    dismiss();
    actions.jump(target.line);
  };
  function position(line: number) {
    current = index?.at(line);
    button.textContent =
      current === undefined ? "Pages…" : `Page ${current} of ${index?.pages.length}`;
    button.disabled = current === undefined;
    button.setAttribute(
      "aria-label",
      current === undefined
        ? "Go to page (pages unavailable)"
        : `Go to page, currently page ${current} of ${index?.pages.length}`,
    );
  }
  return {
    open,
    ready: () => Boolean(index?.pages.length),
    position,
    update(layout: ScreenplayLayout | undefined, line: number) {
      index = layout ? manuscriptPageIndex(layout) : undefined;
      position(line);
      go.disabled = !index?.pages.length;
      if (dialog.open && index) input.max = String(index.pages.at(-1)?.number ?? 1);
    },
    zoom(size: number) {
      zoom.value = String(size);
    },
  };
}
