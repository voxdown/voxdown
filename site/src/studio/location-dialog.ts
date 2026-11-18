import {
  type LocationDirectory,
  type LocationRenamePlan,
  type ScreenplayLocation,
  locationDirectory,
  planLocationRename,
} from "./locations";

export interface LocationSnapshot {
  source: string;
  id: string;
}
const reasons: Record<LocationDirectory["excluded"][number]["reason"], string> = {
  "private-comment": "contains a private comment",
  "formatted-or-escaped": "contains formatting or escapes",
  "unqualified-heading": "has no explicit INT/EXT/EST/I/E location prefix",
  "ambiguous-time": "has an unrecognized final time suffix",
  "ambiguous-location": "has an ambiguous location name",
};
let instance = 0;
export function mountLocations(
  host: HTMLElement,
  actions: {
    current(): LocationSnapshot;
    apply(snapshot: LocationSnapshot, plan: LocationRenamePlan): boolean;
    jump(snapshot: LocationSnapshot, line: number): boolean;
  },
) {
  const id = ++instance;
  const dialog = document.createElement("dialog");
  dialog.className = "location-dialog";
  const heading = document.createElement("h2");
  heading.id = `location-title-${id}`;
  heading.textContent = "Locations";
  dialog.setAttribute("aria-labelledby", heading.id);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const explanation = document.createElement("p");
  explanation.textContent =
    "Locations group confidently recognized INT/EXT scene headings across times of day. Rename changes only their location names; dialogue and action references stay intact. Uncertain headings are excluded and listed below.";
  const searchLabel = document.createElement("label");
  searchLabel.textContent = "Find a location ";
  const search = document.createElement("input");
  search.type = "search";
  search.maxLength = 200;
  searchLabel.append(search);
  const count = document.createElement("p");
  count.setAttribute("role", "status");
  const directoryList = document.createElement("div");
  directoryList.className = "location-directory";
  const selectedTitle = document.createElement("h3");
  const appearanceList = document.createElement("ol");
  appearanceList.className = "location-appearances";
  appearanceList.setAttribute("aria-label", "Location appearances");
  const renameLabel = document.createElement("label");
  renameLabel.textContent = "New location name ";
  const renameInput = document.createElement("input");
  renameInput.type = "text";
  renameInput.maxLength = 200;
  renameLabel.append(renameInput);
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview location rename";
  const previewSummary = document.createElement("p");
  previewSummary.setAttribute("role", "status");
  const previewList = document.createElement("ol");
  previewList.className = "location-rename-preview";
  previewList.setAttribute("aria-label", "Location rename preview");
  previewList.tabIndex = 0;
  const collisionLabel = document.createElement("label");
  const collision = document.createElement("input");
  collision.type = "checkbox";
  collisionLabel.append(collision, " Merge with the existing location of this name");
  collisionLabel.hidden = true;
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "primary";
  applyButton.textContent = "Apply location rename";
  const excluded = document.createElement("details");
  const excludedSummary = document.createElement("summary");
  const excludedList = document.createElement("ol");
  excludedList.className = "location-exclusions";
  excludedList.tabIndex = 0;
  excludedList.setAttribute("aria-label", "Excluded location headings");
  excluded.append(excludedSummary, excludedList);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  dialog.append(
    heading,
    close,
    explanation,
    searchLabel,
    count,
    directoryList,
    selectedTitle,
    appearanceList,
    renameLabel,
    previewButton,
    previewSummary,
    previewList,
    collisionLabel,
    applyButton,
    excluded,
    status,
  );
  host.append(dialog);
  let snapshot: LocationSnapshot | undefined;
  let directory: LocationDirectory | undefined;
  let selected: ScreenplayLocation | undefined;
  let plan: LocationRenamePlan | undefined;
  function invalidate() {
    plan = undefined;
    previewList.replaceChildren();
    previewSummary.textContent = "";
    collision.checked = false;
    collisionLabel.hidden = true;
    applyButton.disabled = true;
  }
  function clear() {
    snapshot = undefined;
    directory = undefined;
    selected = undefined;
    invalidate();
    directoryList.replaceChildren();
    appearanceList.replaceChildren();
    excludedList.replaceChildren();
    excluded.hidden = true;
    excludedSummary.textContent = "";
    selectedTitle.textContent = count.textContent = status.textContent = "";
    renameInput.value = "";
  }
  function dismiss() {
    clear();
    dialog.close();
  }
  close.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) clear();
  });
  function fresh(): boolean {
    const current = actions.current();
    if (snapshot && snapshot.id === current.id && snapshot.source === current.source) return true;
    invalidate();
    status.textContent =
      "The screenplay changed. Close and reopen Locations to inspect the current source before jumping or renaming.";
    return false;
  }
  function choose(location: ScreenplayLocation) {
    selected = location;
    invalidate();
    status.textContent = "";
    selectedTitle.textContent = `${location.name} · ${location.appearances.length} appearances${location.appearances.length > 50 ? " (showing first 50)" : ""}`;
    renameInput.value = location.name;
    renameInput.disabled = previewButton.disabled = false;
    appearanceList.replaceChildren();
    for (const appearance of location.appearances.slice(0, 50)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Line ${appearance.line}: ${appearance.heading.slice(0, 300)}`;
      button.onclick = () => {
        if (!snapshot || !fresh()) return;
        if (actions.jump(snapshot, appearance.line)) dismiss();
        else status.textContent = "Could not jump to this snapshot. Close and reopen Locations.";
      };
      item.append(button);
      appearanceList.append(item);
    }
  }
  function filter() {
    directoryList.replaceChildren();
    const query = search.value.trim().normalize("NFC").toLowerCase();
    const matches = (directory?.locations ?? []).filter((location) =>
      location.name.normalize("NFC").toLowerCase().includes(query),
    );
    count.textContent = `${matches.length} matching locations${matches.length > 50 ? "; showing first 50. Narrow the search to find another location." : "."}`;
    for (const location of matches.slice(0, 50)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${location.name} · ${location.appearances.length}`;
      button.onclick = () => choose(location);
      directoryList.append(button);
    }
  }
  search.oninput = filter;
  renameInput.oninput = invalidate;
  collision.onchange = () => {
    applyButton.disabled =
      !plan?.changes.length || (plan.targetAlreadyExists && !collision.checked);
  };
  previewButton.onclick = () => {
    invalidate();
    if (!snapshot || !selected || !fresh()) return;
    try {
      plan = planLocationRename(snapshot.source, selected.name, renameInput.value);
      previewSummary.textContent = `${plan.changes.length} scene headings will change${plan.changes.length > 50 ? "; showing first 50 changes" : ""}. ${plan.excluded.length} uncertain headings are excluded; these may include further appearances of this location.`;
      for (const row of plan.preview.slice(0, 50)) {
        const item = document.createElement("li");
        const before = document.createElement("pre");
        const after = document.createElement("pre");
        before.textContent = `Line ${row.line} before: ${row.before}`;
        after.textContent = `After: ${row.after}`;
        item.append(before, after);
        previewList.append(item);
      }
      collisionLabel.hidden = !plan.targetAlreadyExists;
      applyButton.disabled = !plan.changes.length || plan.targetAlreadyExists;
      status.textContent = plan.changes.length
        ? "Review the exact changes before applying. Undo restores the whole rename."
        : "No changes to apply.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not plan this rename.";
    }
  };
  applyButton.onclick = () => {
    if (
      !snapshot ||
      !plan?.changes.length ||
      (plan.targetAlreadyExists && !collision.checked) ||
      !fresh()
    )
      return;
    if (actions.apply(snapshot, plan)) dismiss();
    else {
      invalidate();
      status.textContent =
        "The rename was not applied. Close and reopen Locations to inspect current source.";
    }
  };
  return {
    open() {
      if (dialog.open) return;
      clear();
      search.value = "";
      renameInput.disabled = previewButton.disabled = true;
      try {
        snapshot = { ...actions.current() };
        directory = locationDirectory(snapshot.source);
        filter();
        excludedSummary.textContent = `${directory.excluded.length} excluded headings${directory.excluded.length > 50 ? " (showing first 50)" : ""}`;
        excluded.hidden = !directory.excluded.length;
        excluded.open = false;
        for (const row of directory.excluded.slice(0, 50)) {
          const item = document.createElement("li");
          item.textContent = `Line ${row.line}: ${row.heading.slice(0, 300)} — ${reasons[row.reason]}`;
          excludedList.append(item);
        }
        if (directory.locations[0]) choose(directory.locations[0]);
        if (directory.warnings.length)
          status.textContent = directory.warnings.slice(0, 10).join(" ");
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "Could not read this screenplay.";
      }
      dialog.showModal();
      search.focus();
    },
    close: dismiss,
  };
}
