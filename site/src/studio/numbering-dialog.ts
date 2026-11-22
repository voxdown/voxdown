import { arrangeDialogHeader, countLabel, dialogActions, dialogDisclosure } from "./dialog-layout";
import {
  planSuggestedSceneNumbers,
  readProduction,
  sceneNumberSuggestions,
} from "./production-numbering";
import {
  type SceneNumberingMode,
  type SceneNumberingPlan,
  planSceneNumbering,
  sceneNumberingSummary,
} from "./scene-numbering";
type Snapshot = { source: string; id: string };
let instance = 0;
export function mountNumberingDialog(
  host: HTMLElement,
  actions: {
    current(): Snapshot;
    apply(snapshot: Snapshot, plan: SceneNumberingPlan): boolean;
    setLocked?(snapshot: Snapshot, locked: boolean): boolean;
    releaseLock?(snapshot: Snapshot): boolean;
  },
) {
  const id = ++instance;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    return value;
  };
  const button = (text: string, run: () => void) => {
    const value = node("button", text);
    value.type = "button";
    value.onclick = run;
    return value;
  };
  const dialog = node("dialog");
  dialog.className = "studio-scene-numbering";
  const title = node("h2", "Number scenes");
  title.id = `scene-numbering-title-${id}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const intro = node(
    "p",
    "Add scene numbers in source order. Existing numbers stay unchanged by default; private and ambiguous headings are skipped.",
  );
  const summary = node("p");
  const legend = node(
    "p",
    "Dashed margin numbers are suggestions and stay out of the PDF. Solid numbers are committed in the source and print in the PDF. Click either margin to accept a suggestion.",
  );
  const locking = node("label");
  const lock = node("input");
  lock.type = "checkbox";
  locking.append(lock, " Lock scene numbers for production");
  locking.hidden = !actions.setLocked;
  const lockHelp = node(
    "p",
    "Protect committed numbers and reserve deleted numbers. New scenes get suggestions such as 15A; accept them in the margin or with Ctrl/⌘ Alt N. The lock travels with your Fountain file in a nonprinting comment.",
  );
  lockHelp.id = `scene-lock-help-${id}`;
  lock.setAttribute("aria-describedby", lockHelp.id);
  lockHelp.hidden = !actions.setLocked;
  const mode = node("select");
  mode.id = `scene-numbering-mode-${id}`;
  const modeLabel = node("label", "Numbering mode");
  modeLabel.htmlFor = mode.id;
  for (const [value, text] of [
    ["suggested", "Accept suggested numbers"],
    ["unnumbered", "Number only unnumbered scenes"],
    ["renumber", "Renumber all eligible scenes"],
  ]) {
    const option = node("option", text);
    option.value = value ?? "";
    mode.append(option);
  }
  const start = node("input");
  start.type = "number";
  start.min = "1";
  start.max = String(Number.MAX_SAFE_INTEGER);
  start.step = "1";
  start.id = `scene-numbering-start-${id}`;
  const startLabel = node("label", "Starting number");
  startLabel.htmlFor = start.id;
  const startHelp = node(
    "p",
    "Default: after the highest existing integer label. Preserved labels are reserved, including labels on skipped headings; new numbers skip collisions.",
  );
  startHelp.id = `scene-numbering-help-${id}`;
  start.setAttribute("aria-describedby", startHelp.id);
  const acknowledgment = node("label");
  const acknowledge = node("input");
  acknowledge.type = "checkbox";
  acknowledgment.append(
    acknowledge,
    " I understand that existing labels on eligible headings will be replaced",
  );
  const preview = button("Preview scene numbering", prepare);
  const result = node("p");
  result.setAttribute("role", "status");
  const release = button("Release unreadable production lock", () => {
    if (!snapshot || !fresh()) {
      stale();
      return;
    }
    try {
      if (!actions.releaseLock?.(snapshot)) {
        stale();
        return;
      }
      dismiss();
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : "Could not release this lock.";
    }
  });
  release.hidden = true;
  const listing = node("div");
  listing.className = "scene-numbering-preview";
  const excluded = node("ul");
  excluded.setAttribute("aria-label", "Skipped scene headings");
  const apply = button("Apply scene numbering", () => {
    if (!plan?.changes.length || (mode.value === "renumber" && !acknowledge.checked)) return;
    if (!fresh()) {
      stale();
      return;
    }
    if (actions.apply(snapshot as Snapshot, plan)) dismiss();
    else stale();
  });
  apply.classList.add("primary");
  const close = button("Close", dismiss);
  dialog.append(
    title,
    intro,
    summary,
    locking,
    modeLabel,
    mode,
    startLabel,
    start,
    acknowledgment,
    preview,
    result,
    release,
    listing,
    excluded,
    dialogActions(apply),
    dialogDisclosure(
      "How numbering works",
      legend,
      lockHelp,
      startHelp,
      node(
        "p",
        "Numbers use ordinary Fountain #N# labels. This does not sort scenes. Formatted and ambiguous headings are skipped. Unlock production numbering before renumbering existing scenes. Unlocking keeps committed labels but clears the reservation list. Close and reopen to include later edits.",
      ),
    ),
    close,
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let snapshot: Snapshot | undefined;
  let plan: SceneNumberingPlan | undefined;
  let suggested: number | undefined;
  let opener: HTMLElement | undefined;
  function fresh() {
    if (!snapshot) return false;
    const now = actions.current();
    return now.id === snapshot.id && now.source === snapshot.source;
  }
  function invalidate() {
    plan = undefined;
    apply.disabled = true;
    result.textContent = "";
    listing.replaceChildren();
    excluded.replaceChildren();
  }
  function stale() {
    invalidate();
    result.textContent =
      "The screenplay changed. Close and reopen Number scenes to preview its current source.";
  }
  function clear() {
    snapshot = plan = undefined;
    summary.textContent = "";
    start.value = "";
    startHelp.textContent =
      "Default: after the highest existing integer label. Preserved labels are reserved, including labels on skipped headings; new numbers skip collisions.";
    acknowledge.checked = false;
    release.hidden = true;
    invalidate();
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  function prepare() {
    invalidate();
    if (!snapshot) return;
    if (!fresh()) {
      stale();
      return;
    }
    try {
      if (lock.checked || mode.value === "suggested") {
        const suggestions = sceneNumberSuggestions(snapshot.source);
        const changes = planSuggestedSceneNumbers(snapshot.source);
        const info = sceneNumberingSummary(snapshot.source);
        const lines = snapshot.source.split(/\r\n|\r|\n/);
        plan = {
          ...changes,
          mode: "unnumbered",
          start: 1,
          skipped: info.skipped,
          preserved: info.numbered,
          warnings: [],
          preview: suggestions.map((item) => ({
            line: item.line,
            number: item.number,
            before: lines[item.line - 1] ?? "",
            after:
              (lines[item.line - 1] ?? "").trimEnd() +
              item.insert +
              (lines[item.line - 1] ?? "").slice((lines[item.line - 1] ?? "").trimEnd().length),
          })),
        };
      } else {
        if (!start.value.trim()) throw new Error("Enter a positive whole-number start.");
        plan = planSceneNumbering(snapshot.source, {
          mode: mode.value as SceneNumberingMode,
          start: Number(start.value),
        });
      }
      result.textContent = `${countLabel(plan.preview.length, "heading")} will change; ${countLabel(plan.preserved, "existing label")} preserved; ${countLabel(plan.skipped.length, "heading")} skipped. ${plan.warnings.join(" ")}${plan.preview.length > 50 ? " Showing the first 50 exact source changes; Apply includes all changes." : ""}${mode.value === "renumber" ? " Confirm replacement of existing eligible labels before Apply." : ""}${!plan.changes.length ? " No changes are needed." : ""}`;
      for (const item of plan.preview.slice(0, 50)) {
        const section = node("section");
        section.append(
          node("h3", `Line ${item.line} → #${item.number}#`),
          node("p", "Before"),
          node(
            "pre",
            item.before.length > 2000
              ? `${item.before.slice(0, 2000)}… [heading preview truncated]`
              : item.before,
          ),
          node("p", "After"),
          node(
            "pre",
            item.after.length > 2000
              ? `${item.after.slice(0, 2000)}… [heading preview truncated]`
              : item.after,
          ),
        );
        listing.append(section);
      }
      for (const skip of plan.skipped.slice(0, 50))
        excluded.append(node("li", `Line ${skip.line}: ${skip.reason.replaceAll("-", " ")}.`));
      if (plan.skipped.length > 50)
        excluded.append(node("li", `Showing 50 of ${plan.skipped.length} skipped headings.`));
      apply.disabled = !plan.changes.length || (mode.value === "renumber" && !acknowledge.checked);
    } catch (error) {
      plan = undefined;
      result.textContent =
        error instanceof Error ? error.message : "Could not prepare scene numbering.";
    }
  }
  mode.onchange = () => {
    acknowledge.checked = false;
    acknowledgment.hidden = mode.value !== "renumber";
    start.value =
      mode.value === "renumber" ? "1" : suggested === undefined ? "" : String(suggested);
    startHelp.textContent =
      mode.value === "suggested"
        ? "Uses the same numbers as the margins, preserving committed labels."
        : mode.value === "renumber"
          ? "Renumbering starts at 1 by default, in source order. Labels on skipped headings remain reserved."
          : "Default: after the highest existing integer label. Preserved labels are reserved, including labels on skipped headings; new numbers skip collisions.";
    start.hidden = startLabel.hidden = mode.value === "suggested";
    start.disabled = lock.checked || mode.value === "suggested";
    invalidate();
  };
  start.oninput = invalidate;
  function syncLock() {
    lock.checked = snapshot ? readProduction(snapshot.source).locked : false;
    mode.disabled = lock.checked;
    if (lock.checked) {
      mode.value = "suggested";
      acknowledgment.hidden = true;
      startHelp.textContent =
        "Production numbering follows the margin suggestions and preserves all committed and reserved labels.";
    }
    start.hidden = startLabel.hidden = mode.value === "suggested";
    start.disabled = lock.checked || mode.value === "suggested";
  }
  lock.onchange = () => {
    invalidate();
    if (!snapshot || !fresh()) {
      stale();
      return;
    }
    try {
      if (!actions.setLocked?.(snapshot, lock.checked)) {
        stale();
        return;
      }
      snapshot = { ...actions.current() };
      mode.value = "suggested";
      syncLock();
      result.textContent = lock.checked
        ? "Scene numbers locked. You can keep writing and accept new suggestions as needed."
        : "Scene numbers unlocked. Existing labels are unchanged.";
    } catch (error) {
      lock.checked = !lock.checked;
      result.textContent =
        error instanceof Error ? error.message : "Could not change the scene lock.";
    }
  };
  acknowledge.onchange = () => {
    apply.disabled = !plan?.changes.length || (mode.value === "renumber" && !acknowledge.checked);
  };
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
      mode.value = actions.setLocked ? "suggested" : "unnumbered";
      lock.disabled = false;
      lock.checked = false;
      mode.disabled = start.disabled = false;
      acknowledgment.hidden = true;
      preview.disabled = true;
      try {
        snapshot = { ...actions.current() };
        syncLock();
        const info = sceneNumberingSummary(snapshot.source);
        suggested = info.suggestedStart;
        summary.textContent = `${countLabel(info.scenes, "scene")} · ${info.numbered} numbered · ${info.eligible} eligible${info.skipped.length ? ` · ${info.skipped.length} skipped` : ""}`;
        start.value = suggested === undefined ? "" : String(suggested);
        if (suggested === undefined)
          result.textContent =
            "An existing integer label exceeds the automatic-start range. Enter an explicit starting number.";
        preview.disabled = false;
      } catch (error) {
        const failedSnapshot = snapshot;
        snapshot = undefined;
        lock.disabled = true;
        result.textContent =
          error instanceof Error ? error.message : "Could not read the screenplay.";
        if (failedSnapshot && actions.releaseLock) {
          try {
            readProduction(failedSnapshot.source);
          } catch {
            snapshot = failedSnapshot;
            release.hidden = false;
            result.textContent +=
              " Release the unreadable lock to edit numbering. Existing labels and comment contents stay intact; Undo restores the lock.";
          }
        }
      }
      dialog.showModal();
      if (snapshot) mode.focus();
      else close.focus();
    },
    close: dismiss,
  };
}
