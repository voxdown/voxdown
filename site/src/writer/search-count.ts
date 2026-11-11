/**
 * Find and replace says how many there are, and which one is selected: "3 of 12". Counted a moment
 * after the search or the selection changes, up to a limit, so a long book's common word never
 * holds the page.
 */
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Past this, "10,000+": counting further would take time for nothing. */
const LIMIT = 10_000;

/** How many matches the search has, and the place of the one selected (0 if none is). */
export function matchCount(state: EditorState): { total: number; at: number; more: boolean } {
  const query = getSearchQuery(state);
  if (!query.valid || !query.search) return { total: 0, at: 0, more: false };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state) as Iterator<{ from: number; to: number }>;
  let total = 0;
  let at = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) at = total;
    if (total >= LIMIT) return { total, at, more: true };
  }
  return { total, at, more: false };
}

/** What the count says. */
export function countText(
  count: { total: number; at: number; more: boolean },
  searching: boolean,
): string {
  if (!searching) return "";
  if (count.total === 0) return "No matches";
  const total = `${count.total.toLocaleString()}${count.more ? "+" : ""}`;
  return count.at ? `${count.at.toLocaleString()} of ${total}` : `${total} found`;
}

export const searchCount = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(private readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!searchPanelOpen(update.state)) return;
      const searched = getSearchQuery(update.state);
      const was = getSearchQuery(update.startState);
      if (!update.docChanged && !update.selectionSet && searched.eq(was) && this.shown()) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(), 120);
    }
    private shown(): boolean {
      return Boolean(this.view.dom.querySelector(".cm-search .search-count"));
    }
    private show() {
      const panel = this.view.dom.querySelector(".cm-search");
      if (!panel) return;
      let label = panel.querySelector<HTMLElement>(".search-count");
      if (!label) {
        label = document.createElement("span");
        label.className = "search-count";
        label.setAttribute("role", "status");
        panel.querySelector('input[name="search"]')?.after(label);
      }
      const state = this.view.state;
      label.textContent = countText(matchCount(state), Boolean(getSearchQuery(state).search));
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);
