import {
  type BreakdownReport,
  type BreakdownScene,
  breakdownCsv,
  filterBreakdown,
  prepareBreakdown,
  summarizeBreakdown,
} from "./breakdown";
import { arrangeDialogHeader, countLabel, dialogActions, dialogDisclosure } from "./dialog-layout";
import { filenameStem } from "./filename";

let instance = 0;
const clipped = (text: string, limit = 160) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;
export function mountBreakdown(
  host: HTMLElement,
  actions: {
    current(): { source: string; name: string };
    download(bytes: BlobPart, name: string, type: string): void;
  },
) {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const dialog = node("dialog");
  dialog.className = "breakdown-dialog";
  const title = node("h2", "Scene and cast breakdown");
  title.id = `breakdown-title-${++instance}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const explanation = node(
    "p",
    "Explore scenes and speaking roles, then export a CSV. Read-only; private notes, omitted passages, title/contact fields and outlines are excluded.",
  );
  const snapshotLabel = node("p");
  const queryLabel = node("label", "Scene heading or number contains");
  const query = node("input");
  query.type = "search";
  query.maxLength = 200;
  query.setAttribute("aria-label", "Scene heading or number contains");
  queryLabel.append(query);
  const roleLabel = node("label", "Speaking role contains");
  const role = node("input");
  role.type = "search";
  role.maxLength = 200;
  role.setAttribute("aria-label", "Speaking role contains");
  roleLabel.append(role);
  const totals = node("p");
  const status = node("p");
  status.setAttribute("role", "status");
  const rows = node("ol");
  rows.className = "breakdown-rows";
  rows.tabIndex = 0;
  rows.setAttribute("aria-label", "Scene breakdown results");
  const previous = node("button", "Previous 50 scenes");
  const next = node("button", "Next 50 scenes");
  const download = node("button", "Download filtered CSV");
  const close = node("button", "Close");
  for (const button of [previous, next, download, close]) button.type = "button";
  const navigation = node("div");
  navigation.className = "breakdown-navigation";
  navigation.append(previous, next);
  const notes = node(
    "p",
    "A role appears only when its cue has nonempty dialogue or lyrics. This does not identify silent characters, props, shooting schedules or runtime. Counts cover complete matching scenes, including all their roles. Dialogue words include lyrics and unnamed cues (which do not create roles); action words include centered action. Cue names, headings, directions and transitions do not add words. Unicode word counts are approximate for unspaced languages. Dual cues count explicit ^ marks on speaking cues, not overlapping pairs. CSV contains every matching row with full names/headings, even when the display is shortened; formula-like fields receive an apostrophe for spreadsheet safety. It is not an exact-source backup.",
  );
  download.classList.add("primary");
  dialog.append(
    title,
    explanation,
    snapshotLabel,
    queryLabel,
    roleLabel,
    dialogActions(download),
    totals,
    status,
    rows,
    navigation,
    dialogDisclosure("About counts and CSV", notes),
    close,
  );
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let report: BreakdownReport | undefined;
  let filtered: readonly BreakdownScene[] = [];
  let name = "";
  let page = 0;
  let opener: HTMLElement | undefined;
  function render() {
    rows.replaceChildren();
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 50 >= filtered.length;
    download.disabled = !report || !filtered.length;
    if (!report) return;
    const summary = summarizeBreakdown(filtered);
    const all = report.summary;
    totals.textContent = `Filtered: ${countLabel(summary.scenes, "scene occurrence")}${summary.beforeFirst ? " + before-first-scene content" : ""}, ${countLabel(summary.roles, "speaking role")}, ${summary.dialogueWords} dialogue words, ${summary.actionWords} action words, ${countLabel(summary.speeches, "speech block")}, ${countLabel(summary.dualCues, "explicit dual cue")}. Whole snapshot: ${countLabel(all.scenes, "scene occurrence")}${all.beforeFirst ? " + before-first-scene content" : ""}, ${countLabel(all.roles, "speaking role")}, ${all.dialogueWords} dialogue words, ${all.actionWords} action words.`;
    status.textContent = filtered.length
      ? `Showing ${page * 50 + 1}–${Math.min((page + 1) * 50, filtered.length)} of ${filtered.length} matching rows. CSV includes all ${filtered.length}.`
      : "No matching scenes or public content.";
    rows.start = page * 50 + 1;
    for (const row of filtered.slice(page * 50, (page + 1) * 50)) {
      const item = node("li");
      const heading = node(
        "h3",
        `${row.beforeFirst ? "Before first scene" : `Scene occurrence ${row.id}`}: ${clipped(row.heading)}`,
      );
      const location = node(
        "p",
        `Source line ${row.line}${row.number ? ` · explicit number ${clipped(row.number, 60)}` : " · no explicit scene number"}`,
      );
      const members = row.roles
        .slice(0, 10)
        .map(
          (member) =>
            `${clipped(member.name, 80)} (${countLabel(member.speeches, "speech", "speeches")}, ${countLabel(member.words, "word")})`,
        )
        .join("; ");
      const cast = node(
        "p",
        members
          ? `Speaking roles: ${members}${row.roles.length > 10 ? `; +${row.roles.length - 10} more roles in CSV` : ""}`
          : "No speaking roles.",
      );
      const counts = node(
        "p",
        `${countLabel(row.dialogueWords, "dialogue word")} · ${countLabel(row.actionWords, "action word")} · ${countLabel(row.speeches, "speech block")} · ${countLabel(row.dualCues, "explicit dual cue")}`,
      );
      item.append(heading, location, cast, counts);
      rows.append(item);
    }
  }
  function filter() {
    if (!report) return;
    page = 0;
    filtered = filterBreakdown(report, { query: query.value, role: role.value });
    render();
  }
  query.oninput = role.oninput = filter;
  previous.onclick = () => {
    if (page > 0) {
      page--;
      render();
    }
  };
  next.onclick = () => {
    if ((page + 1) * 50 < filtered.length) {
      page++;
      render();
    }
  };
  download.onclick = () => {
    if (!dialog.open || !report || !filtered.length) return;
    try {
      actions.download(
        breakdownCsv(filtered),
        `${filenameStem(name)}-breakdown.csv`,
        "text/csv;charset=utf-8",
      );
      status.textContent = `CSV download started with all ${filtered.length} filtered rows. Your screenplay is unchanged.`;
    } catch {
      status.textContent =
        "The CSV download could not start. Try again; your screenplay is unchanged.";
    }
  };
  function clear() {
    report = undefined;
    filtered = [];
    name = "";
    totals.textContent = snapshotLabel.textContent = status.textContent = "";
    query.value = role.value = "";
    page = 0;
    render();
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  close.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  for (const input of [query, role])
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        dismiss();
      }
    });
  dialog.addEventListener("close", () => {
    if (!dialog.open) clear();
  });
  return {
    open() {
      if (dialog.open) return;
      clear();
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      try {
        const captured = actions.current();
        name = captured.name;
        report = prepareBreakdown(captured.source);
        filtered = report.rows;
        snapshotLabel.textContent = `Snapshot of ${clipped(name)}. Close and reopen to include later edits.`;
        render();
      } catch (error) {
        status.textContent =
          error instanceof Error
            ? error.message
            : "Could not prepare the breakdown. Your screenplay is unchanged.";
      }
      dialog.showModal();
      query.focus();
    },
    close: dismiss,
  };
}
