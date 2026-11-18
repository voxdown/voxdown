import {
  MAX_REPLACE_QUERY,
  MAX_REPLACE_TEXT,
  type ReplaceScope,
  type ScopedReplacePlan,
  planScopedReplace,
} from "./scoped-replace";
export type ReplaceSnapshot = {
  source: string;
  id: string;
  position: number;
  selection: { from: number; to: number };
};
export function mountScopedReplace(
  host: HTMLElement,
  actions: {
    current(): ReplaceSnapshot;
    apply(snapshot: ReplaceSnapshot, plan: ScopedReplacePlan): boolean;
  },
) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    return value;
  }
  function labeled<T extends HTMLInputElement | HTMLSelectElement>(name: string, control: T) {
    const label = node("label", name);
    control.setAttribute("aria-label", name);
    label.append(control);
    return label;
  }
  const dialog = node("dialog");
  dialog.className = "studio-scoped-replace";
  const heading = node("h2", "Scoped find and replace");
  heading.id = "scoped-replace-title";
  dialog.setAttribute("aria-labelledby", heading.id);
  const disclosure = node(
    "p",
    "Search literal Fountain source in printable screenplay elements. Private notes, omitted passages, title fields and outline summaries are always excluded—even within a selection. Matches never cross a line or private passage. Dialogue scope includes spoken dialogue lines; lyrics and parentheticals remain unchanged.",
  );
  const query = node("input");
  query.type = "text";
  query.maxLength = MAX_REPLACE_QUERY;
  query.autocomplete = "off";
  const replacement = node("input");
  replacement.type = "text";
  replacement.maxLength = MAX_REPLACE_TEXT;
  replacement.autocomplete = "off";
  const scope = node("select");
  for (const [value, text] of [
    ["screenplay", "Printable screenplay"],
    ["scene", "Current scene"],
    ["dialogue", "Dialogue only"],
    ["action", "Action only"],
    ["selection", "Selected text"],
  ]) {
    const option = node("option", text);
    option.value = value ?? "";
    scope.append(option);
  }
  const caseSensitive = node("input");
  caseSensitive.type = "checkbox";
  caseSensitive.checked = true;
  const wholeWord = node("input");
  wholeWord.type = "checkbox";
  const status = node("p");
  status.setAttribute("role", "status");
  const results = node("ol");
  results.className = "replace-preview";
  const preview = node("button", "Preview replacements");
  preview.type = "button";
  const apply = node("button", "Apply replacements");
  apply.type = "button";
  const cancel = node("button", "Cancel");
  cancel.type = "button";
  cancel.onclick = () => dialog.close();
  dialog.append(
    heading,
    disclosure,
    labeled("Find text", query),
    labeled("Replacement text", replacement),
    labeled("Search scope", scope),
    labeled("Match case", caseSensitive),
    labeled("Whole words", wholeWord),
    preview,
    status,
    results,
    apply,
    cancel,
  );
  host.append(dialog);
  let snapshot: ReplaceSnapshot | undefined;
  let plan: ScopedReplacePlan | undefined;
  function invalidate() {
    plan = undefined;
    apply.disabled = true;
    results.replaceChildren();
  }
  function current() {
    const now = actions.current();
    return snapshot && now.id === snapshot.id && now.source === snapshot.source;
  }
  function stale() {
    invalidate();
    status.textContent =
      "The screenplay changed. Close and reopen Replace to search its current version.";
  }
  for (const control of [query, replacement, scope, caseSensitive, wholeWord]) {
    control.addEventListener("input", () => {
      invalidate();
      status.textContent = "Preview the changes before applying.";
    });
    control.addEventListener("change", () => {
      invalidate();
      status.textContent = "Preview the changes before applying.";
    });
  }
  preview.onclick = () => {
    invalidate();
    if (!snapshot || !current()) return stale();
    try {
      plan = planScopedReplace(snapshot.source, {
        query: query.value,
        replacement: replacement.value,
        scope: scope.value as ReplaceScope,
        caseSensitive: caseSensitive.checked,
        wholeWord: wholeWord.checked,
        position: snapshot.position,
        selection: snapshot.selection,
      });
      status.textContent = `${plan.matches} matches; ${plan.changes.length} replacements. Showing the first ${plan.preview.length} changed matches. Private text and excluded elements remain unchanged.`;
      for (const item of plan.preview) {
        const row = node("li");
        row.append(node("p", `Line ${item.line}`), node("pre", `${item.before}\n→ ${item.after}`));
        results.append(row);
      }
      apply.disabled = !plan.changes.length;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "This replacement could not be prepared.";
    }
  };
  apply.onclick = () => {
    if (!snapshot || !plan?.changes.length) return;
    if (!current()) return stale();
    try {
      if (actions.apply(snapshot, plan)) dialog.close();
      else stale();
    } catch {
      invalidate();
      status.textContent =
        "The replacement was not confirmed. Your search and replacement remain here; check the screenplay before retrying.";
    }
  };
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    snapshot = undefined;
    invalidate();
    query.value = "";
    replacement.value = "";
  });
  return {
    open() {
      const now = actions.current();
      snapshot = { ...now, selection: { ...now.selection } };
      invalidate();
      query.value = "";
      replacement.value = "";
      scope.value = "screenplay";
      caseSensitive.checked = true;
      wholeWord.checked = false;
      status.textContent =
        "Preview the changes before applying. At most 10,000 matches can be prepared at once.";
      dialog.showModal();
      query.focus();
    },
  };
}
