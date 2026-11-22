import { dialogueExcerpts } from "./dialogue";
import type { FountainDocument } from "./fountain";
import {
  screenplayInsights,
  searchCharacters,
  searchDiagnostics,
  searchPrivateNotes,
} from "./insights";

export function mountWorkbench(
  host: HTMLElement,
  jump: (line: number) => void,
  actions: {
    rename?(): void;
    sides?(): void;
    editSpeech?(line: number, source: string): void;
  } = {},
) {
  const dialog = document.createElement("dialog");
  dialog.className = "workbench-dialog";
  dialog.setAttribute("aria-labelledby", "workbench-title");
  const header = document.createElement("header");
  header.className = "workbench-header";
  const heading = document.createElement("h2");
  heading.id = "workbench-title";
  heading.textContent = "Screenplay workbench";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  header.append(heading, close);
  const navigation = document.createElement("div");
  navigation.className = "workbench-navigation";
  const viewLabel = document.createElement("label");
  viewLabel.textContent = "View";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Workbench view");
  for (const [value, label] of [
    ["statistics", "Writing statistics"],
    ["characters", "Characters and dialogue"],
    ["notes", "Private notes and omissions"],
    ["diagnostics", "Source diagnostics"],
  ]) {
    const option = document.createElement("option");
    option.value = value ?? "";
    option.textContent = label ?? "";
    select.append(option);
  }
  viewLabel.append(select);
  const searchLabel = document.createElement("label");
  searchLabel.textContent = "Filter results";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Filter this view…";
  search.setAttribute("aria-label", "Filter workbench");
  searchLabel.append(search);
  navigation.append(viewLabel, searchLabel);
  const body = document.createElement("div");
  body.className = "workbench-body";
  const content = document.createElement("div");
  content.className = "workbench-content";
  const summary = document.createElement("p");
  summary.setAttribute("role", "status");
  summary.className = "workbench-results-summary";
  const goalSection = document.createElement("section");
  goalSection.className = "workbench-goal";
  goalSection.setAttribute("aria-label", "Draft word target");
  const goalLabel = document.createElement("label");
  goalLabel.textContent = "Draft word target (optional)";
  const goal = document.createElement("input");
  goal.type = "number";
  goal.min = "0";
  goal.max = "1000000";
  goal.step = "100";
  goal.value = "";
  goal.placeholder = "e.g. 10,000";
  goal.inputMode = "numeric";
  goal.setAttribute("aria-describedby", "workbench-goal-hint");
  goalLabel.append(goal);
  const goalHint = document.createElement("p");
  goalHint.id = "workbench-goal-hint";
  goalHint.className = "workbench-secondary";
  goalHint.textContent = "Set a word target for this browser. Clear it to turn it off.";
  const goalProgress = document.createElement("div");
  goalProgress.className = "workbench-goal-progress";
  goalProgress.setAttribute("aria-live", "polite");
  goalSection.append(goalLabel, goalHint, goalProgress);
  try {
    const value = Number(localStorage.getItem("studio-word-goal"));
    if (Number.isSafeInteger(value) && value > 0 && value <= 1e6) goal.value = String(value);
  } catch {}
  let resultOffset = 0;
  const resultPages = document.createElement("div");
  resultPages.className = "character-pages";
  const previousResults = document.createElement("button");
  previousResults.type = "button";
  previousResults.textContent = "Previous 100 results";
  const nextResults = document.createElement("button");
  nextResults.type = "button";
  nextResults.textContent = "Next 100 results";
  resultPages.append(previousResults, nextResults);
  function pageResults(total: number, label: string) {
    summary.textContent = total
      ? `${total} ${label} · showing ${resultOffset + 1}–${Math.min(resultOffset + 100, total)}`
      : search.value.trim()
        ? `No matching ${label}.`
        : label === "characters"
          ? "No speaking characters yet."
          : label === "private passages"
            ? "No private notes or omitted passages in this draft."
            : "No parser warnings.";
    resultPages.hidden = total <= 100;
    previousResults.disabled = resultOffset === 0;
    nextResults.disabled = resultOffset + 100 >= total;
  }
  function moveResults(direction: number) {
    resultOffset = Math.max(0, resultOffset + direction * 100);
    render();
    // The content is replaced; move focus to its first result, not a now-disabled pager.
    (
      content.querySelector<HTMLElement>("details > summary") ??
      content.querySelector<HTMLElement>("button")
    )?.focus();
  }
  previousResults.onclick = () => moveResults(-1);
  nextResults.onclick = () => moveResults(1);
  let data: ReturnType<typeof screenplayInsights> | undefined;
  let pending: { document: FountainDocument; source: string } | undefined;
  const node = (tag: "p" | "button" | "pre", text: string) => {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  };
  function link(text: string, line: number) {
    const button = node("button", text) as HTMLButtonElement;
    button.type = "button";
    button.onclick = () => {
      dialog.close();
      jump(line);
    };
    return button;
  }
  function updateGoalProgress(words: number) {
    goalProgress.replaceChildren();
    const target = Number(goal.value);
    if (target > 0 && target <= 1e6) {
      const percent = Math.min(100, Math.floor((words / target) * 100));
      const progress = document.createElement("progress");
      progress.max = target;
      progress.value = Math.min(words, target);
      progress.setAttribute("aria-label", "Draft word target progress");
      const remaining = Math.max(0, target - words);
      goalProgress.append(
        progress,
        node(
          "p",
          remaining
            ? `${percent}% complete · ${remaining.toLocaleString()} ${remaining === 1 ? "word" : "words"} to go`
            : "Target reached",
        ),
      );
    }
  }
  function render() {
    if (!data && pending) data = screenplayInsights(pending.document, pending.source);
    content.replaceChildren();
    summary.textContent = "";
    resultPages.hidden = true;
    searchLabel.hidden = select.value === "statistics";
    summary.hidden = select.value === "statistics";
    if (!data) {
      content.append(node("p", "Wait for the screenplay preview to finish updating."));
      return;
    }
    if (select.value === "statistics") {
      const stats = data.statistics;
      const metrics = document.createElement("dl");
      metrics.className = "workbench-metrics";
      for (const [value, label] of [
        [stats.words, stats.words === 1 ? "Printable word" : "Printable words"],
        [stats.scenes, stats.scenes === 1 ? "Scene" : "Scenes"],
        [stats.characters, stats.characters === 1 ? "Speaking character" : "Speaking characters"],
      ] as const) {
        const metric = document.createElement("div");
        const term = document.createElement("dt");
        term.textContent = label;
        const number = document.createElement("dd");
        number.textContent = value.toLocaleString();
        metric.append(term, number);
        metrics.append(metric);
      }
      const minutes = Math.ceil(stats.estimatedSpokenSeconds / 60);
      const speech = document.createElement("div");
      speech.className = "workbench-speech";
      const speechValue = document.createElement("strong");
      speechValue.textContent = `${stats.dialogueWords.toLocaleString()} spoken ${stats.dialogueWords === 1 ? "word" : "words"}`;
      const speechEstimate = document.createElement("span");
      speechEstimate.textContent = stats.dialogueWords
        ? stats.estimatedSpokenSeconds < 60
          ? "Less than 1 minute of speech"
          : `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} of speech`
        : "No spoken dialogue yet";
      speech.append(speechValue, speechEstimate);
      updateGoalProgress(stats.words);
      const explanation = document.createElement("details");
      explanation.className = "workbench-explanation";
      const explanationTitle = document.createElement("summary");
      explanationTitle.textContent = "How these numbers are calculated";
      explanation.append(
        explanationTitle,
        node(
          "p",
          `Speech time uses ${stats.wordsPerMinute} words per minute. It excludes action, pauses, and overlapping dialogue. Word counts for unspaced languages are approximate. Private notes and outlines do not count.`,
        ),
      );
      content.append(metrics, speech, goalSection, explanation);
    } else if (select.value === "characters") {
      const characterActions = document.createElement("div");
      characterActions.className = "workbench-actions";
      if (actions.rename) {
        const renameButton = node("button", "Rename a character") as HTMLButtonElement;
        renameButton.type = "button";
        renameButton.onclick = () => {
          dialog.close();
          actions.rename?.();
        };
        characterActions.append(renameButton);
      }
      if (actions.sides) {
        const sidesButton = node("button", "Actor sides PDF") as HTMLButtonElement;
        sidesButton.type = "button";
        sidesButton.onclick = () => {
          dialog.close();
          actions.sides?.();
        };
        characterActions.append(sidesButton);
      }
      if (characterActions.childElementCount) content.append(characterActions);
      const found = searchCharacters(data.characters, search.value, 100, resultOffset);
      pageResults(found.total, "characters");
      const excerpts = pending ? dialogueExcerpts(pending.document) : new Map();
      for (const character of found.items) {
        const details = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = `${character.name} · ${character.blocks} ${character.blocks === 1 ? "cue" : "cues"} · ${character.words} spoken ${character.words === 1 ? "word" : "words"}`;
        details.append(title);
        const speeches = document.createElement("div");
        speeches.className = "character-speeches";
        let offset = 0;
        function showSpeeches() {
          speeches.replaceChildren();
          for (const line of character.lines.slice(offset, offset + 25)) {
            const excerpt = excerpts.get(line);
            const article = document.createElement("article");
            article.append(
              link(`${excerpt?.scene ?? "Scene"} · line ${line}`, line),
              node("pre", excerpt?.text || "No dialogue follows this cue."),
            );
            if (actions.editSpeech && pending) {
              const original = pending.source;
              const edit = node("button", "Edit this speech…") as HTMLButtonElement;
              edit.type = "button";
              edit.onclick = () => {
                dialog.close();
                actions.editSpeech?.(line, original);
              };
              article.append(edit);
            }
            if (excerpt?.shortened)
              article.append(node("p", "Excerpt shortened. Open source for the complete speech."));
            speeches.append(article);
          }
          const controls = document.createElement("div");
          controls.className = "character-pages";
          const previous = node("button", "Previous 25 cues") as HTMLButtonElement;
          previous.type = "button";
          previous.disabled = offset === 0;
          const next = node("button", "Next 25 cues") as HTMLButtonElement;
          next.type = "button";
          next.disabled = offset + 25 >= character.lines.length;
          previous.onclick = () => {
            offset = Math.max(0, offset - 25);
            showSpeeches();
            speeches.querySelector<HTMLButtonElement>("button")?.focus();
          };
          next.onclick = () => {
            offset += 25;
            showSpeeches();
            speeches.querySelector<HTMLButtonElement>("button")?.focus();
          };
          controls.append(
            previous,
            node(
              "p",
              `Cues ${offset + 1}–${Math.min(offset + 25, character.lines.length)} of ${character.lines.length}`,
            ),
            next,
          );
          speeches.append(controls);
        }
        details.addEventListener("toggle", () => {
          if (!details.open) {
            speeches.replaceChildren();
            return;
          }
          for (const other of content.querySelectorAll<HTMLDetailsElement>("details"))
            if (other !== details) other.open = false;
          showSpeeches();
        });
        details.append(speeches);
        content.append(details);
      }
    } else if (select.value === "notes") {
      const found = searchPrivateNotes(data.notes, search.value, 100, resultOffset);
      pageResults(found.total, "private passages");
      for (const note of found.items) {
        const card = document.createElement("article");
        card.append(
          link(
            `${note.kind === "note" ? "Note" : "Omitted passage"} · line ${note.line}`,
            note.line,
          ),
          node("pre", note.text.slice(0, 2000)),
        );
        if (note.text.length > 2000)
          card.append(node("p", "Preview shortened. Open the source for the complete passage."));
        content.append(card);
      }
    } else {
      const found = searchDiagnostics(data.diagnostics, search.value, 100, resultOffset);
      pageResults(found.total, "parser warnings");
      for (const issue of found.items)
        content.append(link(`Line ${issue.line}: ${issue.message}`, issue.line));
      if (!found.total)
        content.append(
          node("p", "Export checks may also report layout issues or unsupported font characters."),
        );
    }
  }
  goal.addEventListener("change", () => {
    const value = Math.max(0, Math.min(1e6, Math.round(Number(goal.value) || 0)));
    goal.value = value ? String(value) : "";
    try {
      localStorage.setItem("studio-word-goal", String(value));
    } catch {}
    if (data) updateGoalProgress(data.statistics.words);
  });
  search.oninput = () => {
    resultOffset = 0;
    body.scrollTop = 0;
    render();
  };
  select.onchange = () => {
    resultOffset = 0;
    body.scrollTop = 0;
    search.value = "";
    render();
  };
  body.append(summary, content, resultPages);
  dialog.append(header, navigation, body);
  host.append(dialog);
  return {
    update(document: FountainDocument, source: string) {
      resultOffset = 0;
      pending = { document, source };
      data = undefined;
      if (dialog.open) render();
    },
    stale() {
      pending = undefined;
      data = undefined;
      if (dialog.open) render();
    },
    open(section = "statistics") {
      resultOffset = 0;
      search.value = "";
      select.value = section;
      render();
      dialog.showModal();
      body.scrollTop = 0;
    },
  };
}
