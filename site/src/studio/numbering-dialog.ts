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
  actions: { current(): Snapshot; apply(snapshot: Snapshot, plan: SceneNumberingPlan): boolean },
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
    "Preview ordinary Fountain #N# scene labels in source order. This does not sort scenes or lock production numbering. Existing labels are preserved by default; ambiguous, formatted and private-comment headings are skipped.",
  );
  const summary = node("p");
  const mode = node("select");
  mode.id = `scene-numbering-mode-${id}`;
  const modeLabel = node("label", "Numbering mode");
  modeLabel.htmlFor = mode.id;
  for (const [value, text] of [
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
  const close = button("Close", dismiss);
  dialog.append(
    title,
    intro,
    summary,
    modeLabel,
    mode,
    startLabel,
    start,
    startHelp,
    acknowledgment,
    preview,
    result,
    listing,
    excluded,
    apply,
    close,
  );
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
      if (!start.value.trim()) throw new Error("Enter a positive whole-number start.");
      plan = planSceneNumbering(snapshot.source, {
        mode: mode.value as SceneNumberingMode,
        start: Number(start.value),
      });
      result.textContent = `${plan.changes.length} headings will change; ${plan.preserved} existing labels preserved; ${plan.skipped.length} headings skipped. ${plan.warnings.join(" ")}${plan.preview.length > 50 ? " Showing the first 50 exact source changes; Apply includes all changes." : ""}${mode.value === "renumber" ? " Confirm replacement of existing eligible labels before Apply." : ""}${!plan.changes.length ? " No changes are needed." : ""}`;
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
      mode.value === "renumber"
        ? "Renumbering starts at 1 by default, in source order. Labels on skipped headings remain reserved."
        : "Default: after the highest existing integer label. Preserved labels are reserved, including labels on skipped headings; new numbers skip collisions.";
    invalidate();
  };
  start.oninput = invalidate;
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
      mode.value = "unnumbered";
      acknowledgment.hidden = true;
      preview.disabled = true;
      try {
        snapshot = { ...actions.current() };
        const info = sceneNumberingSummary(snapshot.source);
        suggested = info.suggestedStart;
        summary.textContent = `${info.scenes} scenes; ${info.numbered} already numbered; ${info.eligible} eligible headings; ${info.skipped.length} headings skipped. Close and reopen to include later edits.`;
        start.value = suggested === undefined ? "" : String(suggested);
        if (suggested === undefined)
          result.textContent =
            "An existing integer label exceeds the automatic-start range. Enter an explicit starting number.";
        preview.disabled = false;
      } catch (error) {
        snapshot = undefined;
        result.textContent =
          error instanceof Error ? error.message : "Could not read the screenplay.";
      }
      dialog.showModal();
      if (snapshot) mode.focus();
      else close.focus();
    },
    close: dismiss,
  };
}
