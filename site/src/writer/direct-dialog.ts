/**
 * Directing the reading with AI: an AI suggests how the story is performed (directions, pauses,
 * stressed words, sounds) by giving the text back with marks added, and the writer chooses which
 * to keep. Any AI chat will do: the Writer gives the request to copy, and reads the answer pasted
 * back. With `vxd connect` running (a version that can ask), an AI on the writer's own computer is
 * asked a passage at a time instead. Either way the core keeps a mark only where it changes no
 * word, no speaker and none of the writer's own marks, and the marks chosen are added as one step
 * to undo.
 */
import {
  DIRECTING_INSTRUCTIONS,
  type Refusal,
  type Story,
  type Suggestion,
  type SuggestionKind,
  chosenChanges,
  directingPassages,
  directingPrompt,
  directingRequest,
  directingSchema,
  readDirected,
} from "voxdown";
import { type AiContext, chapterAt } from "./ai-dialog";
import { type Found, HelperError, askAi, hello, keptPairing } from "./helper";
import { proseWords } from "./words";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const plural = (count: number, word: string, words = `${word}s`) =>
  `${count} ${count === 1 ? word : words}`;

const KINDS: Record<SuggestionKind, [string, string]> = {
  direction: ["direction", "directions"],
  stress: ["stressed word", "stressed words"],
  pause: ["pause", "pauses"],
  sound: ["sound", "sounds"],
  vocal: ["sound a character makes", "sounds characters make"],
};

const CHOICE = "voxdown-writer-direct-ai";

/** A long reach, for a chat: past this, it may give back only part. */
const CHAT_WORDS = 3000;

/** What the last reading found, kept while the dialog is put away: for the story it was read for. */
let last:
  | {
      storyId: string;
      /** The answers, as they came, joined: read again against the story as it is when marks are added. */
      answers: string[];
      reach: { from: number; to: number };
      suggestions: Suggestion[];
      /** The paragraphs in reach the answers didn't give back, as they were first read. */
      missed: Refusal[];
      /** The ids the writer has left unticked. */
      unticked: Set<string>;
      said: string;
    }
  | undefined;

let running: AbortController | undefined;

const wordsIn = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/** Where the reach chosen runs: the whole story, the chapter at the cursor, or the selection. */
function reachOf(context: AiContext, scope: string): { from: number; to: number } {
  const story = context.story();
  const { from, to } = context.selection();
  if (scope === "selection" && from !== to) return { from, to };
  if (scope === "chapter") {
    const chapter = chapterAt(story, from);
    return { from: chapter.from, to: chapter.to };
  }
  return { from: 0, to: story.source.length };
}

/** Each reach said with its length, before anything is asked. */
function sayReaches(context: AiContext): void {
  const story = context.story();
  const { from, to } = context.selection();
  const chapter = chapterAt(story, from);
  // The story's own words, as the status line counts them: not its marks or its front matter.
  const words = (start: number, end: number) => proseWords(story.source.slice(start, end));
  const options = $("#direct-scope").querySelectorAll<HTMLOptionElement>("option");
  for (const option of options) {
    if (option.value === "story")
      option.textContent = `The whole story (${plural(words(0, story.source.length), "word")})`;
    else if (option.value === "chapter") {
      const count = words(chapter.from, chapter.to);
      option.textContent = `This chapter${chapter.name ? `, “${chapter.name}”` : ""} (${plural(count, "word")})`;
      // No words of its own (the cursor in the story's details, say): not offered.
      option.disabled = count === 0;
    } else if (option.value === "selection") {
      option.disabled = from === to;
      option.textContent =
        from === to ? "The selection" : `The selection (${plural(words(from, to), "word")})`;
    }
  }
  const scope = $<HTMLSelectElement>("#direct-scope");
  if (scope.selectedOptions[0]?.disabled) scope.value = "chapter";
  if (scope.selectedOptions[0]?.disabled) scope.value = "story";
}

/** Opens the dialog. */
export async function openDirect(context: AiContext): Promise<void> {
  const dialog = $<HTMLDialogElement>("#direct");
  const scope = $<HTMLSelectElement>("#direct-scope");
  const local = $("#direct-local");
  const pasted = $<HTMLTextAreaElement>("#direct-answer");
  sayReaches(context);
  sayLength(context);
  scope.onchange = () => sayLength(context);
  $<HTMLButtonElement>("#direct-copy").onclick = () => void copyRequest(context);
  $<HTMLButtonElement>("#direct-read").onclick = () => {
    const answer = pasted.value;
    if (!answer.trim()) {
      say("Paste the AI's answer in the box first.");
      return;
    }
    const reach = reachOf(context, scope.value);
    show(context, [answer], reach);
  };
  $<HTMLButtonElement>("#direct-add").onclick = () => add(context);
  $<HTMLButtonElement>("#direct-all").onclick = () => tickAll(true);
  $<HTMLButtonElement>("#direct-none").onclick = () => tickAll(false);
  // What was found before, for this story: there again.
  if (last && last.storyId === context.storyId()) show(context, last.answers, last.reach, last);
  else {
    last = undefined;
    $("#direct-found").hidden = true;
    say("");
  }
  local.hidden = true;
  dialog.onclose = () => {
    running?.abort();
    running = undefined;
  };
  if (!dialog.open) dialog.showModal();
  // An AI on this computer, where the helper running can ask one: offered too.
  const pairing = keptPairing();
  if (!pairing) return;
  let ais: Found[] = [];
  try {
    const found = await hello(pairing);
    if (!found.can?.includes("ask")) return;
    ais = found.ais.filter((ai) => ai.id !== "tags");
  } catch {
    return;
  }
  if (!dialog.open || ais.length === 0) return;
  const choice = $<HTMLSelectElement>("#direct-ai");
  choice.replaceChildren(
    ...ais.map((ai) => {
      const option = document.createElement("option");
      option.value = ai.id;
      option.textContent = ai.label;
      return option;
    }),
  );
  const remembered = localStorage.getItem(CHOICE);
  if (remembered && ais.some((ai) => ai.id === remembered)) choice.value = remembered;
  local.hidden = false;
  $<HTMLButtonElement>("#direct-ask").onclick = () => {
    localStorage.setItem(CHOICE, choice.value);
    void askHere(context, choice.value);
  };
}

/** How long the reach is, for a chat. */
function sayLength(context: AiContext): void {
  const reach = reachOf(context, $<HTMLSelectElement>("#direct-scope").value);
  const words = wordsIn(context.text().slice(reach.from, reach.to));
  $("#direct-long").textContent =
    words > CHAT_WORDS
      ? `That's ${plural(words, "word")}: a chat may give back only part of it. A chapter at a time works best.`
      : "";
}

function say(text: string): void {
  $("#direct-progress").textContent = text;
}

/** The request for the reach, copied for the writer to paste into a chat. */
async function copyRequest(context: AiContext): Promise<void> {
  const reach = reachOf(context, $<HTMLSelectElement>("#direct-scope").value);
  const request = directingRequest(context.story(), reach.from, reach.to);
  const button = $<HTMLButtonElement>("#direct-copy");
  if (!request) {
    say("There's nothing there to read aloud.");
    return;
  }
  try {
    await navigator.clipboard.writeText(request);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy the request";
    }, 2500);
    say(
      "Copied. Paste it into ChatGPT, Claude, Gemini or another AI chat, then paste its answer below.",
    );
  } catch {
    // No clipboard for this page: the request in the box, selected, for the writer's own keys.
    const box = $<HTMLTextAreaElement>("#direct-answer");
    box.value = request;
    box.select();
    say("Your browser didn't let the Writer copy it: it's selected in the box, to copy yourself.");
  }
}

/** Asks the AI on this computer a passage at a time, then shows what it found. */
async function askHere(context: AiContext, ai: string): Promise<void> {
  const pairing = keptPairing();
  if (!pairing) return;
  const reach = reachOf(context, $<HTMLSelectElement>("#direct-scope").value);
  const story = context.story();
  const storyId = context.storyId();
  const passages = directingPassages(story, reach);
  if (passages.length === 0) {
    say("There's nothing there to read aloud.");
    return;
  }
  running?.abort();
  running = new AbortController();
  const signal = running.signal;
  const ask = $<HTMLButtonElement>("#direct-ask");
  ask.disabled = true;
  const answers: string[] = [];
  let stopped = "";
  try {
    for (const passage of passages) {
      say(
        `Asking about passage ${passage.index} of ${passages.length}${passage.heading ? ` (${passage.heading})` : ""}…`,
      );
      const { answer } = await askAi(
        pairing,
        {
          with: ai,
          instructions: DIRECTING_INSTRUCTIONS,
          prompt: directingPrompt(story, passage),
          schema: directingSchema(),
          name: "directions",
        },
        signal,
      );
      answers.push(answer);
      if (signal.aborted) break;
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    stopped = error instanceof HelperError ? error.message : String((error as Error).message);
  } finally {
    ask.disabled = false;
  }
  if (context.storyId() !== storyId) return;
  if (answers.length) show(context, answers, reach);
  if (stopped)
    say(`${$("#direct-progress").textContent ?? ""} It stopped early: ${stopped}`.trim());
}

/** The suggestions in the answers, for the story as it is now, each to tick or untick. */
function show(
  context: AiContext,
  answers: string[],
  reach: { from: number; to: number },
  kept?: typeof last,
): void {
  const story = context.story();
  // Read against the story as it is: offsets as they are now, paragraphs changed meanwhile left.
  const read = readDirected(story, answers.join("\n\n"), kept ? {} : reach);
  const unticked = kept?.unticked ?? new Set<string>();
  last = {
    storyId: context.storyId(),
    answers,
    reach,
    suggestions: read.suggestions,
    // Read again over the whole story, every paragraph outside the reach would be missed: the
    // reach's own, as first read.
    missed: kept ? kept.missed : read.missed,
    unticked,
    said: "",
  };
  const list = $("#direct-list");
  list.replaceChildren(...read.suggestions.map((suggestion) => row(context, suggestion, unticked)));
  const counts = new Map<SuggestionKind, number>();
  for (const suggestion of read.suggestions)
    counts.set(suggestion.kind, (counts.get(suggestion.kind) ?? 0) + 1);
  const found = [...counts].map(([kind, count]) => plural(count, ...KINDS[kind])).join(", ");
  const refusals = $("#direct-refused");
  // Said only beside something the answers did give: an answer about something else entirely
  // would list every paragraph.
  const missed = read.suggestions.length + read.refused.length > 0 ? last.missed : [];
  refusals.replaceChildren(
    ...[...read.refused, ...missed].slice(0, 30).map((refusal) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-button";
      button.textContent = `Line ${refusal.line}`;
      button.onclick = () => {
        context.goToLine(refusal.line);
        $<HTMLDialogElement>("#direct").close();
      };
      item.append(button, `: ${refusal.why}. `, refusal.words);
      return item;
    }),
  );
  refusals.hidden = read.refused.length + missed.length === 0;
  last.said = [
    read.suggestions.length
      ? `${plural(read.suggestions.length, "suggestion")}: ${found}. Untick any you don't want.`
      : "No marks to add: the answer suggested none that keep the words as they are.",
    read.refused.length
      ? `${plural(read.refused.length, "paragraph")} left as written, below: the AI changed more than marks there.`
      : "",
    missed.length
      ? `${plural(missed.length, "paragraph")} the answer didn't give back, below.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  say(last.said);
  $("#direct-found").hidden =
    read.suggestions.length === 0 && read.refused.length === 0 && missed.length === 0;
  sayAdd();
}

/** One suggestion: ticked to add, its line with the mark in it, the line to go to. */
function row(context: AiContext, suggestion: Suggestion, unticked: Set<string>): HTMLElement {
  const item = document.createElement("li");
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !unticked.has(suggestion.id);
  box.dataset.id = suggestion.id;
  box.onchange = () => {
    if (box.checked) unticked.delete(suggestion.id);
    else unticked.add(suggestion.id);
    sayAdd();
  };
  const text = document.createElement("span");
  text.className = "direct-preview";
  let at = 0;
  for (const [from, to] of suggestion.preview.added) {
    text.append(suggestion.preview.text.slice(at, from));
    const mark = document.createElement("mark");
    mark.textContent = suggestion.preview.text.slice(from, to);
    text.append(mark);
    at = to;
  }
  text.append(suggestion.preview.text.slice(at));
  label.append(box, text);
  const go = document.createElement("button");
  go.type = "button";
  go.className = "link-button direct-line";
  go.textContent = `Line ${suggestion.line}`;
  go.onclick = () => {
    context.goToLine(suggestion.line);
    $<HTMLDialogElement>("#direct").close();
  };
  item.append(label, go);
  return item;
}

function tickAll(on: boolean): void {
  if (!last) return;
  for (const box of $("#direct-list").querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
    box.checked = on;
    const id = box.dataset.id as string;
    if (on) last.unticked.delete(id);
    else last.unticked.add(id);
  }
  sayAdd();
}

/** The add button, saying how many it adds. */
function sayAdd(): void {
  const button = $<HTMLButtonElement>("#direct-add");
  const count = last ? last.suggestions.filter((s) => !last?.unticked.has(s.id)).length : 0;
  button.textContent = count ? `Add ${plural(count, "mark")}` : "Add marks";
  button.disabled = count === 0;
}

/** The ticked marks added, as one step to undo; the story read again first if it changed. */
function add(context: AiContext): void {
  if (!last) return;
  const story: Story = context.story();
  const now = readDirected(story, last.answers.join("\n\n"));
  const chosen = now.suggestions.filter(
    (suggestion) =>
      !last?.unticked.has(suggestion.id) && last?.suggestions.some((s) => s.id === suggestion.id),
  );
  const wanted = last.suggestions.filter((suggestion) => !last?.unticked.has(suggestion.id)).length;
  const { changes, dropped } = chosenChanges(story, chosen);
  const gone = wanted - chosen.length + dropped;
  if (changes.length === 0) {
    say(
      gone
        ? "None of them could be added: the paragraphs they were for have changed."
        : "No marks are ticked.",
    );
    return;
  }
  if (!context.apply(changes)) return;
  const added = chosen.length - dropped;
  last = undefined;
  $("#direct-found").hidden = true;
  $<HTMLTextAreaElement>("#direct-answer").value = "";
  $<HTMLDialogElement>("#direct").close();
  context.notice(
    [
      `${plural(added, "mark")} added: Ctrl+Z takes ${added === 1 ? "it" : "them"} back.`,
      gone ? `${plural(gone, "suggestion")} left out: their paragraphs changed meanwhile.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}
