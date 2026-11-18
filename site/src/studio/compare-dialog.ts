import { type SourceComparison, compareSources } from "./comparison";
import { MAX_SOURCE, readSource } from "./source";
import { type WordSegment, compareWords } from "./word-comparison";
const MAX_BYTES = MAX_SOURCE * 4 + 4;
const EXCERPT_CHARACTERS = 8000;
const EXCERPT_LINES = 80;
let instance = 0;
export function mountCompareDialog(
  host: HTMLElement,
  actions: { current(): { source: string; name: string } },
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
  dialog.className = "studio-file-comparison";
  const title = node("h2", "Compare with local Fountain file");
  title.id = `file-comparison-title-${id}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const intro = node(
    "p",
    "Read-only source comparison: private notes, omitted passages and title/contact fields are included in the excerpts. Nothing is changed, saved, uploaded or exported. Line endings are normalized for comparison; this does not establish byte equality.",
  );
  const snapshotLabel = node("p");
  const file = node("input");
  file.type = "file";
  file.accept = ".fountain,.txt,text/plain";
  file.id = `comparison-file-${id}`;
  const label = node("label", "Baseline Fountain or text file");
  label.htmlFor = file.id;
  const compare = button("Compare source", prepare);
  const status = node("p");
  status.setAttribute("role", "status");
  const counts = node("p");
  counts.setAttribute("role", "status");
  const navigation = node("div");
  navigation.className = "file-comparison-navigation";
  const search = node("input");
  search.type = "search";
  search.maxLength = 200;
  search.placeholder = "Find changed text…";
  search.setAttribute("aria-label", "Find source changes");
  const choice = node("select");
  choice.setAttribute("aria-label", "Source change");
  const previous = button("Previous change", () => move(-1));
  const next = button("Next change", () => move(1));
  const position = node("p");
  position.setAttribute("role", "status");
  navigation.append(search, choice, previous, next, position);
  const columns = node("div");
  columns.className = "file-comparison-columns";
  const beforeSection = node("section");
  const beforeHeading = node("h3");
  const before = node("pre");
  before.tabIndex = 0;
  before.setAttribute("role", "region");
  before.setAttribute("aria-label", "Baseline source excerpt");
  const afterSection = node("section");
  const afterHeading = node("h3");
  const after = node("pre");
  after.tabIndex = 0;
  after.setAttribute("role", "region");
  after.setAttribute("aria-label", "Current snapshot source excerpt");
  beforeSection.append(beforeHeading, before);
  afterSection.append(afterHeading, after);
  columns.append(beforeSection, afterSection);
  const excerptNotice = node("p");
  const help = node(
    "p",
    "Removed source is shown on the baseline side; added source is shown on the current side. Small paired changes highlight changed word, punctuation and whitespace chunks. Excerpts show at most 80 lines and 8,000 characters per side. Use left/right arrows while reading an excerpt to navigate changes.",
  );
  const close = button("Close", dismiss);
  dialog.append(
    title,
    intro,
    snapshotLabel,
    label,
    file,
    compare,
    status,
    counts,
    navigation,
    columns,
    excerptNotice,
    help,
    close,
  );
  host.append(dialog);
  let snapshot: { source: string; name: string } | undefined;
  let baseline: { source: string; name: string } | undefined;
  let diff: SourceComparison | undefined;
  let generation = 0;
  let matched: number[] = [];
  let selected = 0;
  let opener: HTMLElement | undefined;
  const short = (value: string) => (value.length > 160 ? `${value.slice(0, 160)}…` : value);
  function resetComparison() {
    diff = undefined;
    matched = [];
    selected = 0;
    counts.textContent = position.textContent = excerptNotice.textContent = "";
    search.value = "";
    choice.replaceChildren();
    before.textContent = after.textContent = "";
    beforeHeading.textContent = afterHeading.textContent = "";
    navigation.hidden = columns.hidden = true;
  }
  function clear() {
    generation++;
    snapshot = baseline = undefined;
    file.value = "";
    file.disabled = false;
    compare.disabled = true;
    resetComparison();
    snapshotLabel.textContent = status.textContent = "";
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  function excerpt(text: string) {
    const lines = text.split("\n");
    const value = lines.slice(0, EXCERPT_LINES).join("\n").slice(0, EXCERPT_CHARACTERS);
    return { value, truncated: value.length < text.length };
  }
  function renderText(
    target: HTMLElement,
    value: string,
    segments: WordSegment[] | undefined,
    kind: "removed" | "added",
  ) {
    target.replaceChildren();
    if (!segments) {
      target.textContent = value;
      return;
    }
    for (const segment of segments) {
      const span = node("span", segment.text);
      if (segment.changed) span.className = `comparison-word-${kind}`;
      target.append(span);
    }
  }
  function showPair(a: string, b: string, inline: boolean) {
    const left = excerpt(a);
    const right = excerpt(b);
    const words =
      inline && !left.truncated && !right.truncated
        ? compareWords(left.value, right.value)
        : undefined;
    renderText(before, left.value, words?.before, "removed");
    renderText(after, right.value, words?.after, "added");
    before.scrollTop = after.scrollTop = 0;
    excerptNotice.textContent = `${left.truncated || right.truncated ? "Excerpt truncated; the counts and change ranges still refer to the full source. " : ""}${words ? "Changed chunks are highlighted; unhighlighted text is shared. " : "Word highlighting is unavailable for this larger or unpaired change. "}${!a ? "No removed source in this change. " : ""}${!b ? "No added source in this change." : ""}`;
  }
  function render() {
    if (diff?.status !== "complete") return;
    const index = matched[selected];
    const change = index === undefined ? undefined : diff.changes[index];
    previous.disabled = selected === 0;
    next.disabled = selected >= matched.length - 1;
    choice.disabled = !change;
    choice.replaceChildren();
    const page = Math.floor(selected / 50) * 50;
    for (const index of matched.slice(page, page + 50)) {
      const item = diff.changes[index];
      if (!item) continue;
      const option = node(
        "option",
        `Change ${index + 1}: baseline line ${item.saved.lineFrom}, current line ${item.current.lineFrom}`,
      );
      option.value = String(index);
      choice.append(option);
    }
    choice.value = index === undefined ? "" : String(index);
    position.textContent = change
      ? `Match ${selected + 1} of ${matched.length} · change ${(index ?? 0) + 1} of ${diff.changes.length}. Choice list shows ${page + 1}–${Math.min(page + 50, matched.length)}; Previous/Next reaches every match.`
      : "No source changes match this search.";
    columns.hidden = !change;
    if (!change) {
      before.textContent = after.textContent = excerptNotice.textContent = "";
      return;
    }
    const range = (from: number, to: number) =>
      to < from ? `insertion point ${from}` : from === to ? `line ${from}` : `lines ${from}–${to}`;
    beforeHeading.textContent = `Removed from baseline · ${range(change.saved.lineFrom, change.saved.lineTo)}`;
    afterHeading.textContent = `Added in current snapshot · ${range(change.current.lineFrom, change.current.lineTo)}`;
    const a = diff.saved.slice(change.saved.from, change.saved.to);
    const b = diff.current.slice(change.current.from, change.current.to);
    showPair(a, b, Boolean(a && b));
  }
  function filter() {
    if (diff?.status !== "complete") return;
    const needle = search.value.toLocaleLowerCase();
    matched = diff.changes.flatMap((change, index) =>
      !needle ||
      `${index + 1}\n${diff?.saved.slice(change.saved.from, change.saved.to)}\n${diff?.current.slice(change.current.from, change.current.to)}`
        .toLocaleLowerCase()
        .includes(needle)
        ? [index]
        : [],
    );
    selected = 0;
    render();
  }
  function move(amount: number) {
    if (selected + amount < 0 || selected + amount >= matched.length) return;
    selected += amount;
    render();
  }
  function prepare() {
    resetComparison();
    if (!snapshot || !baseline) return;
    diff = compareSources(baseline.source, snapshot.source);
    status.textContent = `Comparing ${short(baseline.name)} with the captured ${short(snapshot.name)}. Current editor changes made after opening this dialog are not included.`;
    if (diff.status === "complete") {
      counts.textContent = `${diff.added} added, ${diff.removed} removed and ${diff.unchanged} unchanged lines; ${diff.changes.length} changes.${!diff.changes.length ? (baseline.source === snapshot.source ? " Source text is identical, including line-ending spelling." : " Only line-ending spelling differs.") : ""}`;
      navigation.hidden = !diff.changes.length;
      filter();
    } else {
      counts.textContent =
        "This comparison exceeds the bounded change-search budget. Added/removed counts and change navigation are unavailable. Only the beginning of each normalized source is shown below; no equality is implied.";
      columns.hidden = false;
      beforeHeading.textContent = "Baseline beginning";
      afterHeading.textContent = "Current snapshot beginning";
      showPair(diff.saved, diff.current, false);
    }
  }
  search.oninput = filter;
  choice.onchange = () => {
    const value = matched.indexOf(Number(choice.value));
    if (value >= 0) {
      selected = value;
      render();
    }
  };
  for (const pre of [before, after])
    pre.addEventListener("keydown", (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }
    });
  file.onchange = async () => {
    const token = ++generation;
    baseline = undefined;
    compare.disabled = true;
    resetComparison();
    const chosen = file.files?.[0];
    if (!chosen) {
      status.textContent = "No baseline selected. Previous comparison cleared.";
      return;
    }
    status.textContent = "Reading local baseline. Previous comparison cleared…";
    try {
      if (!/\.(fountain|txt)$/i.test(chosen.name) || /[\p{Cc}\p{Cf}\\/]/u.test(chosen.name))
        throw new Error(
          "Choose a .fountain or .txt file with a valid filename. No comparison is shown.",
        );
      if (chosen.size > MAX_BYTES)
        throw new Error(
          "This baseline file exceeds the 2 MB input limit. Choose a smaller screenplay.",
        );
      const bytes = await chosen.arrayBuffer();
      if (token !== generation || !dialog.open) return;
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new Error("This baseline is not valid UTF-8. Export a UTF-8 Fountain or text copy.");
      }
      readSource(source);
      baseline = { source, name: chosen.name };
      compare.disabled = !snapshot;
      status.textContent = `Ready: ${short(chosen.name)}. Choose Compare source to view differences, including private source text.`;
    } catch (error) {
      if (token === generation && dialog.open)
        status.textContent =
          error instanceof Error
            ? error.message
            : "Could not read the baseline. No comparison is shown.";
    }
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
      try {
        snapshot = { ...actions.current() };
        readSource(snapshot.source);
        snapshotLabel.textContent = `Current snapshot: ${short(snapshot.name)}. Close and reopen to include later edits.`;
        status.textContent = "Choose a local baseline file.";
      } catch (error) {
        snapshot = undefined;
        status.textContent =
          error instanceof Error ? error.message : "Could not capture the current screenplay.";
      }
      file.disabled = !snapshot;
      dialog.showModal();
      if (snapshot) file.focus();
      else close.focus();
    },
    close: dismiss,
  };
}
