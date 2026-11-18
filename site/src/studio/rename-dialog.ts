import { parseFountain } from "./fountain";
import { screenplayInsights } from "./insights";
import { type CharacterRenamePlan, planCharacterRename } from "./rename";

type Snapshot = { source: string; id: string };
export function mountRename(
  host: HTMLElement,
  callbacks: {
    current(): Snapshot;
    apply(snapshot: Snapshot, plan: CharacterRenamePlan): boolean;
  },
) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    return value;
  }
  const short = (text: string) => (text.length > 500 ? `${text.slice(0, 500)}…` : text);
  const dialog = node("dialog");
  dialog.className = "studio-rename";
  const title = node("h2", "Rename a character");
  title.id = "studio-rename-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const intro = node(
    "p",
    "Change character cues with a preview and one-step undo. Mentions in action and dialogue stay as written. Private or formatted cues that cannot be safely rewritten are listed separately.",
  );
  const filterLabel = node("label", "Find character ");
  const filter = node("input");
  filter.type = "search";
  filterLabel.append(filter);
  const oldLabel = node("label", "Character ");
  const oldName = node("select");
  oldName.setAttribute("aria-label", "Character");
  oldLabel.append(oldName);
  const newLabel = node("label", "New name ");
  const newName = node("input");
  newName.maxLength = 200;
  newName.autocomplete = "off";
  newLabel.append(newName);
  const hint = node(
    "p",
    "Use uppercase for ordinary cues. Mixed case works for cues already beginning with @. Extensions such as (V.O.) stay unchanged.",
  );
  const previewButton = node("button", "Preview rename");
  previewButton.type = "button";
  const status = node("p");
  status.setAttribute("role", "status");
  const preview = node("ol");
  preview.className = "rename-preview";
  const mergeLabel = node("label");
  const merge = node("input");
  merge.type = "checkbox";
  mergeLabel.append(
    merge,
    document.createTextNode(" Merge these cues with the existing character of this name"),
  );
  const apply = node("button", "Apply rename");
  apply.type = "button";
  const close = node("button", "Cancel");
  close.type = "button";
  close.onclick = () => dialog.close();
  dialog.append(
    title,
    intro,
    filterLabel,
    oldLabel,
    newLabel,
    hint,
    previewButton,
    status,
    preview,
    mergeLabel,
    apply,
    close,
  );
  host.append(dialog);
  let snapshot: Snapshot;
  let cast: string[] = [];
  let plan: CharacterRenamePlan | undefined;
  function invalidate() {
    plan = undefined;
    apply.disabled = true;
    merge.checked = false;
    mergeLabel.hidden = true;
    preview.replaceChildren();
    status.textContent = "Preview the changes before applying.";
  }
  function choices() {
    const selected = oldName.value;
    const found = cast.filter((name) =>
      name.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()),
    );
    oldName.replaceChildren(
      ...found.slice(0, 100).map((name) => {
        const option = node("option", short(name));
        option.value = name;
        return option;
      }),
    );
    if (found.slice(0, 100).includes(selected)) oldName.value = selected;
    invalidate();
    status.textContent =
      found.length > 100
        ? `${found.length} matching characters. Showing the first 100; refine the search.`
        : found.length
          ? "Preview the changes before applying."
          : "No matching character cues. A cue needs speech immediately beneath it, or a leading @.";
    previewButton.disabled = !found.length;
  }
  filter.addEventListener("input", choices);
  oldName.addEventListener("change", invalidate);
  newName.addEventListener("input", invalidate);
  merge.addEventListener("change", () => {
    apply.disabled = !plan?.changes.length || (plan.targetAlreadyExists && !merge.checked);
  });
  previewButton.onclick = () => {
    invalidate();
    try {
      const now = callbacks.current();
      if (now.id !== snapshot.id || now.source !== snapshot.source)
        throw new Error(
          "The screenplay changed. Close this dialog and reopen Rename to preview the current version.",
        );
      plan = planCharacterRename(snapshot.source, oldName.value, newName.value);
      status.textContent = `${plan.changes.length} cues will change. ${plan.skipped.length} cues will be left unchanged.${plan.targetAlreadyExists ? " The new name already belongs to another character." : ""} Showing up to 50 changed and 50 skipped cues.`;
      for (const item of plan.preview.slice(0, 50)) {
        const row = node("li");
        row.append(
          node("p", `Line ${item.line}`),
          node("pre", `${short(item.before)}\n→ ${short(item.after)}`),
        );
        preview.append(row);
      }
      for (const item of plan.skipped.slice(0, 50))
        preview.append(
          node(
            "li",
            `Line ${item.line}: unchanged (${item.reason === "private-comment" ? "contains a private comment" : "formatted or escaped name"}).`,
          ),
        );
      mergeLabel.hidden = !plan.targetAlreadyExists;
      apply.disabled = !plan.changes.length || plan.targetAlreadyExists;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "The rename could not be prepared.";
    }
  };
  apply.onclick = () => {
    if (!plan?.changes.length || (plan.targetAlreadyExists && !merge.checked)) return;
    if (callbacks.apply(snapshot, plan)) dialog.close();
    else {
      invalidate();
      status.textContent =
        "The screenplay changed. Close this dialog and reopen Rename to preview the current version.";
    }
  };
  dialog.addEventListener("close", () => {
    plan = undefined;
    cast = [];
    preview.replaceChildren();
  });
  return {
    open() {
      snapshot = callbacks.current();
      cast = screenplayInsights(parseFountain(snapshot.source), snapshot.source).characters.map(
        (entry) => entry.name,
      );
      filter.value = "";
      newName.value = "";
      choices();
      dialog.showModal();
      filter.focus();
    },
  };
}
