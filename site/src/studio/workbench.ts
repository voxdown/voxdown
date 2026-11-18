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
  dialog.setAttribute("aria-labelledby", "workbench-title");
  const heading = document.createElement("h2");
  heading.id = "workbench-title";
  heading.textContent = "Screenplay workbench";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
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
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Filter this view…";
  search.setAttribute("aria-label", "Filter workbench");
  const content = document.createElement("div");
  content.className = "workbench-content";
  const summary = document.createElement("p");
  summary.setAttribute("role", "status");
  const goalLabel = document.createElement("label");
  goalLabel.textContent = "Draft word target (optional) ";
  const goal = document.createElement("input");
  goal.type = "number";
  goal.min = "0";
  goal.max = "1000000";
  goal.step = "100";
  goal.value = "0";
  goalLabel.append(goal);
  try {
    const value = Number(localStorage.getItem("studio-word-goal"));
    if (Number.isSafeInteger(value) && value >= 0 && value <= 1e6) goal.value = String(value);
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
      : `No matching ${label}.`;
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
  function render() {
    if (!data && pending) data = screenplayInsights(pending.document, pending.source);
    content.replaceChildren();
    summary.textContent = "";
    resultPages.hidden = true;
    goalLabel.hidden = select.value !== "statistics";
    search.hidden = select.value === "statistics";
    if (!data) {
      content.append(node("p", "Wait for the screenplay preview to finish updating."));
      return;
    }
    if (select.value === "statistics") {
      const stats = data.statistics;
      content.append(
        node(
          "p",
          `${stats.words.toLocaleString()} printable words · ${stats.scenes} scenes · ${stats.characters} speaking characters`,
        ),
      );
      content.append(
        node(
          "p",
          `${stats.dialogueWords.toLocaleString()} spoken words · about ${Math.ceil(stats.estimatedSpokenSeconds / 60)} minutes at ${stats.wordsPerMinute} words per minute.`,
        ),
      );
      content.append(
        node(
          "p",
          "Speech time is an estimate. It excludes action, pauses, and overlapping dialogue. Word counts for unspaced languages are approximate. Private notes and outlines do not count.",
        ),
      );
      const target = Number(goal.value);
      if (target > 0 && target <= 1e6)
        content.append(
          node(
            "p",
            `${Math.min(100, Math.floor((stats.words / target) * 100))}% of your ${target.toLocaleString()}-word draft target · ${Math.max(0, target - stats.words).toLocaleString()} words remaining.`,
          ),
        );
    } else if (select.value === "characters") {
      if (actions.rename) {
        const renameButton = node("button", "Rename a character") as HTMLButtonElement;
        renameButton.type = "button";
        renameButton.onclick = () => {
          dialog.close();
          actions.rename?.();
        };
        content.append(renameButton);
      }
      if (actions.sides) {
        const sidesButton = node("button", "Actor sides PDF") as HTMLButtonElement;
        sidesButton.type = "button";
        sidesButton.onclick = () => {
          dialog.close();
          actions.sides?.();
        };
        content.append(sidesButton);
      }
      const found = searchCharacters(data.characters, search.value, 100, resultOffset);
      pageResults(found.total, "characters");
      const excerpts = pending ? dialogueExcerpts(pending.document) : new Map();
      for (const character of found.items) {
        const details = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = `${character.name} · ${character.blocks} cues · ${character.words} spoken words`;
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
          node(
            "p",
            "No matching parser warnings. Export may still report layout or unsupported font characters.",
          ),
        );
    }
  }
  goal.addEventListener("change", () => {
    const value = Math.max(0, Math.min(1e6, Math.round(Number(goal.value) || 0)));
    goal.value = String(value);
    try {
      localStorage.setItem("studio-word-goal", String(value));
    } catch {}
    render();
  });
  search.oninput = () => {
    resultOffset = 0;
    render();
  };
  select.onchange = () => {
    resultOffset = 0;
    search.value = "";
    render();
  };
  dialog.append(heading, close, select, search, goalLabel, summary, content, resultPages);
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
    },
  };
}
