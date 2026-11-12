/**
 * Naming the speakers with AI, and making an audiobook: both done by the writer's own computer,
 * through `vxd connect`. The dialog says how to connect when the Writer isn't; once it is, it
 * offers what the computer has (Claude Code, Codex, a local model…; ElevenLabs, Kokoro…), the
 * choice remembered, and shows the work as it goes. Speakers come back as changes to the story,
 * one step to undo; an audiobook is made in a folder on the computer.
 */
import {
  type Gift,
  type Story,
  type TextChange,
  diffChanges,
  giveQuotes,
  parse,
  quotesOf,
} from "voxdown";
import {
  type Found,
  type Hello,
  HelperError,
  type Pairing,
  forgetPairing,
  hello,
  keptPairing,
  listen,
  work,
} from "./helper";
import { keys } from "./menu";

export type AiContext = {
  /** Which story is open: work asked for one is never given to another. */
  storyId(): string;
  /** The story as the editor has it now. */
  text(): string;
  /** Makes the changes as one step to undo; false if they can't be made. */
  apply(changes: TextChange[]): boolean;
  notice(message: string, action?: { label: string; run: () => void }): void;
  /** Takes the cursor to a line of the story. */
  goToLine(line: number): void;
  /** The story's file name. */
  name(): string;
  /** The story as it is now, read. */
  story(): Story;
  /** The selection, in the text. */
  selection(): { from: number; to: number };
};

type Mode = "speakers" | "audiobook";

const CHOICE = { speakers: "voxdown-writer-ai", audiobook: "voxdown-writer-voices" } as const;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

let running: AbortController | undefined;
/** What the last naming said, and the quotes it held back: there again when the dialog opens. */
let lastNaming: { said: string; held: Node[] } | undefined;
/** A run the writer went back to writing beside: closing the dialog doesn't stop it. */
let behind = false;
/** Naming the speakers under way: only Stop stops it; the dialog put away lets it go on. */
let naming = false;

/** The dialog's Close: Stop while work it would end goes on, which only it ends. */
function closeSays(working: boolean): void {
  const close = $<HTMLButtonElement>("#ai-close");
  close.textContent = working ? "Stop" : "Close";
  close.value = working ? "stop" : "close";
}

/** The naming goes on behind, while the writer writes: said, with Stop one click away. */
function goBehind(context: AiContext): void {
  behind = true;
  context.notice("Naming the speakers while you write: it says here when it's done.", {
    label: "Stop",
    run: () => {
      behind = false;
      running?.abort();
      running = undefined;
      context.notice("Naming the speakers stopped. Nothing was changed.");
    },
  });
}

/** The voices the writer chose in the casting, by service and character: sent with each request. */
const chosen = new Map<string, Record<string, string>>();
/** A voice being heard, stopped when another is. */
let heard: { audio: HTMLAudioElement; url: string; stop: AbortController } | undefined;

function stopHearing(): void {
  if (!heard) return;
  heard.stop.abort();
  heard.audio.pause();
  URL.revokeObjectURL(heard.url);
  heard = undefined;
}

type Cast = {
  file: string;
  people: Array<{ name: string; voice: string; id: string; description?: string; sample?: string }>;
  voices: Array<{ id: string; name: string; description?: string; language?: string }>;
};

/**
 * The casting, to change: each character's voice chosen from the service's, and heard saying their
 * first words. A choice goes with the next request, and the helper keeps it in casting.json.
 */
function castingTable(cast: Cast, pairing: Pairing, service: string): HTMLElement {
  const holder = document.createElement("div");
  const table = document.createElement("table");
  table.className = "ai-casting";
  const caption = document.createElement("caption");
  caption.textContent =
    "The voices: choose another for anyone, and Listen to hear their first words in it.";
  table.append(caption);
  // What a choice does, and what hearing a voice says when it can't: beside the casting, never over
  // what the book would cost.
  const said = document.createElement("p");
  said.className = "sheet-note ai-cast-note";
  said.setAttribute("role", "status");
  const mine = chosen.get(service) ?? {};
  chosen.set(service, mine);
  for (const person of cast.people) {
    const row = table.insertRow();
    const name = row.insertCell();
    name.textContent = person.name;
    const choice = document.createElement("select");
    choice.setAttribute("aria-label", `${person.name}’s voice`);
    for (const voice of cast.voices) {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.description ? `${voice.name} (${voice.description})` : voice.name;
      choice.append(option);
    }
    choice.value = mine[person.name] ?? person.id;
    choice.addEventListener("change", () => {
      mine[person.name] = choice.value;
      said.textContent = `${person.name} will be read by ${choice.selectedOptions[0]?.text ?? choice.value}: kept in casting.json when the book is made, or its cost counted again.`;
    });
    row.insertCell().append(choice);
    const hear = document.createElement("button");
    hear.type = "button";
    hear.className = "button ai-listen";
    hear.textContent = "Listen";
    hear.disabled = !person.sample;
    hear.title = person.sample
      ? `“${person.sample}” in this voice (a sentence or two, at the service’s price)`
      : `${person.name} says nothing yet`;
    hear.setAttribute("aria-label", `Hear ${person.name}’s first words in this voice`);
    hear.addEventListener("click", async () => {
      if (!person.sample) return;
      stopHearing();
      const stop = new AbortController();
      hear.disabled = true;
      hear.textContent = "Saying…";
      try {
        const sound = await listen(
          pairing,
          { with: service, voice: choice.value, words: person.sample },
          stop.signal,
        );
        if (stop.signal.aborted) return;
        const url = URL.createObjectURL(sound);
        const audio = new Audio(url);
        heard = { audio, url, stop };
        await audio.play();
      } catch (error) {
        if ((error as Error).name !== "AbortError") said.textContent = (error as Error).message;
      } finally {
        hear.disabled = false;
        hear.textContent = "Listen";
      }
    });
    row.insertCell().append(hear);
  }
  holder.append(table, said);
  return holder;
}

/** The helper's command, copied in one click to paste in a terminal; "Copied" for a moment. */
export function copyCommand(button: HTMLElement, command: HTMLElement): void {
  const label = button.querySelector(".copy-label");
  let resetting: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string, copied: boolean) => {
    if (label) label.textContent = text;
    button.setAttribute("aria-label", copied ? "Copied the command" : "Copy the command");
    button.toggleAttribute("data-copied", copied);
  };
  button.addEventListener("click", async () => {
    clearTimeout(resetting);
    try {
      await navigator.clipboard.writeText(command.textContent ?? "");
      say("Copied", true);
    } catch {
      // No clipboard for this page: the command selected, for the writer's own keys.
      const range = document.createRange();
      range.selectNodeContents(command);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      say(`${keys("Mod+C")} to copy`, false);
    }
    resetting = setTimeout(() => say("Copy", false), 2500);
  });
}

const copyButton = document.getElementById("ai-copy");
const commandText = document.getElementById("ai-command");
if (copyButton && commandText) copyCommand(copyButton, commandText);

/** Opens the dialog for naming speakers or making an audiobook. */
export async function openAi(mode: Mode, context: AiContext): Promise<void> {
  const dialog = $<HTMLDialogElement>("#ai");
  const title = $("#ai-title");
  const connect = $("#ai-connect");
  const ready = $("#ai-ready");
  const choice = $<HTMLSelectElement>("#ai-choice");
  const about = $("#ai-about");
  const progress = $("#ai-progress");
  const result = $("#ai-result");
  const go = $<HTMLButtonElement>("#ai-go");
  const second = $<HTMLButtonElement>("#ai-second");
  const bookOptions = $("#ai-book-options");
  const sounds = $<HTMLInputElement>("#ai-sounds");
  title.textContent = mode === "speakers" ? "Name the speakers with AI" : "Make an audiobook";
  $("#ai-choice-label").textContent = mode === "speakers" ? "The AI" : "The voices";
  $("#ai-private-short").textContent =
    mode === "speakers"
      ? "Your story goes only to the AI you choose, through the helper on your computer. VoxDown never sees it, nor your keys."
      : "Your story goes only to the voice service you choose, through the helper on your computer; the audiobook is made there. VoxDown never sees it, nor your keys.";
  // Before the helper is found too: where the story goes, said for what the dialog does.
  $("#ai-private-text").textContent =
    mode === "speakers"
      ? "VoxDown has no server and no account: your story goes from this page to the helper on your own computer, and from there only to the AI you choose. Your keys and sign-ins stay on your computer, and VoxDown never sees them."
      : "VoxDown has no server and no account: your story goes from this page to the helper on your own computer, and from there only to the voice service you choose, or to none if the voices are on your computer too. Your keys stay on your computer, and VoxDown never sees them.";
  $<HTMLAnchorElement>("#ai-private-link").href =
    `https://github.com/voxdown/voxdown/blob/main/docs/${mode === "speakers" ? "ai.md#where-your-words-go" : "produce.md#where-your-story-goes"}`;
  bookOptions.hidden = mode !== "audiobook";
  $("#ai-scope-options").hidden = mode !== "speakers";
  const selected = context.selection();
  ($("#ai-scope").querySelector('option[value="selection"]') as HTMLOptionElement).disabled =
    selected.from === selected.to;
  if (mode === "speakers") sayScopes(context);
  $("#ai-connect-how").hidden = false;
  progress.textContent = "";
  result.replaceChildren();
  // The last naming's result, finished while the writer wrote on: still to be read.
  if (mode === "speakers" && lastNaming) {
    progress.textContent = lastNaming.said;
    result.replaceChildren(...lastNaming.held);
  }
  second.hidden = true;
  go.disabled = false;
  connect.hidden = true;
  ready.hidden = true;
  // Opened again while the naming goes on behind: it is watched here again, Stop here to stop it.
  if (naming) behind = false;
  if (!dialog.open) {
    dialog.returnValue = "";
    dialog.showModal();
  }
  dialog.onclose = () => {
    // A voice being heard stops with the dialog.
    stopHearing();
    if (behind) return;
    // Naming under way, the dialog put away (Escape, its ×, Keep writing): it goes on.
    if (naming && dialog.returnValue !== "stop") {
      goBehind(context);
      return;
    }
    running?.abort();
    running = undefined;
  };

  const pairing = keptPairing();
  let found: Hello | undefined;
  if (pairing) {
    progress.textContent = "Connecting to this computer…";
    try {
      found = await hello(pairing);
    } catch (error) {
      if (error instanceof HelperError && error.unpaired) forgetPairing();
      $("#ai-connect-why").textContent = (error as Error).message;
    }
    progress.textContent = "";
  }
  if (!pairing || !found) {
    connect.hidden = false;
    if (!pairing) $("#ai-connect-why").textContent = "";
    go.textContent = "Try again";
    go.onclick = () => void openAi(mode, context);
    return;
  }
  const options: Found[] = mode === "speakers" ? found.ais : found.speech;
  if (options.length === 0) {
    // Connected: only what is missing is said.
    connect.hidden = false;
    $("#ai-connect-how").hidden = true;
    $("#ai-connect-why").textContent =
      mode === "speakers"
        ? "The helper found no AI on this computer: sign in to Claude Code or Codex, run a model in Ollama or LM Studio, or set an API key, then start vxd connect again."
        : "The helper found no voice service on this computer: set ELEVENLABS_API_KEY, or run Kokoro (docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu), then start vxd connect again.";
    go.textContent = "Try again";
    go.onclick = () => void openAi(mode, context);
    return;
  }
  ready.hidden = false;
  const remembered = localStorage.getItem(CHOICE[mode]);
  choice.replaceChildren(
    ...options.map((option) => {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      return element;
    }),
  );
  if (remembered && options.some((option) => option.id === remembered)) choice.value = remembered;
  const describe = () => {
    const option = options.find((candidate) => candidate.id === choice.value);
    about.textContent = option?.note ? `${option.label}: ${option.note}.` : "";
    // Free on this computer: nothing to pay for the sounds either.
    $("#ai-sounds-cost").textContent = /\bfree\b/i.test(option?.note ?? "")
      ? ""
      : " (they cost too)";
  };
  choice.onchange = describe;
  describe();
  // Remembered once the writer uses it, not before.
  const keep = () => localStorage.setItem(CHOICE[mode], choice.value);
  choice.focus();

  if (mode === "speakers") {
    go.textContent = "Name the speakers";
    go.onclick = () => {
      keep();
      const scope = $<HTMLSelectElement>("#ai-scope").value;
      void nameSpeakers(pairing, choice.value, context, quotesIn(context, scope));
    };
  } else {
    go.textContent = "Cast it and count the cost";
    go.onclick = () => {
      keep();
      void audiobook(pairing, choice.value, "estimate", context, sounds.checked, found);
    };
  }
}

/**
 * The quotes to ask about, by number: all of them (undefined), this chapter's (from the heading
 * of the story's top level before the cursor to the next), or the selection's.
 */
function quotesIn(context: AiContext, scope: string): number[] | undefined {
  if (scope === "story") return undefined;
  const story = context.story();
  const { from, to } = context.selection();
  let start = from;
  let end = to;
  if (scope === "chapter") {
    const chapter = chapterAt(story, from);
    start = chapter.from;
    end = chapter.to;
  }
  return quotesOf(story)
    .filter((quote) => quote.from >= start && quote.from < end)
    .map((quote) => quote.number);
}

/**
 * The chapter around `at`: between headings of the shallowest level that comes more than once
 * (a book's title alone at the top is no chapter), its name and where it runs.
 */
export function chapterAt(story: Story, at: number): { name: string; from: number; to: number } {
  const headings = story.blocks.flatMap((block) => (block.kind === "heading" ? [block] : []));
  const levels = [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b);
  const top =
    levels.find((level) => headings.filter((heading) => heading.level === level).length > 1) ??
    levels[0];
  const tops = headings.filter((heading) => heading.level === top);
  const opening = [...tops].reverse().find((heading) => heading.range.from <= at);
  return {
    name: opening
      ? story.source
          .slice(opening.range.from, opening.range.to)
          .replace(/^[ \t]*#+[ \t]*/, "")
          .replace(/[ \t]*\{[^}]*\}[ \t]*$/, "")
          .trim()
      : "",
    from: opening?.range.from ?? 0,
    to: tops.find((heading) => heading.range.from > at)?.range.from ?? story.source.length,
  };
}

/** Each scope's reach, said in the list before anything is asked: the chapter's name, and how many quotes wait for a speaker there. */
function sayScopes(context: AiContext): void {
  const story = context.story();
  const waiting = quotesOf(story).filter((quote) => quote.narrated);
  const count = (from: number, to: number) =>
    waiting.filter((quote) => quote.from >= from && quote.from < to).length;
  const waits = (n: number) => `${n} ${n === 1 ? "quote waits" : "quotes wait"}`;
  const { from, to } = context.selection();
  const chapter = chapterAt(story, from);
  const options = $("#ai-scope").querySelectorAll<HTMLOptionElement>("option");
  for (const option of options) {
    if (option.value === "story")
      option.textContent = `In the whole story (${waits(count(0, story.source.length))})`;
    else if (option.value === "chapter")
      option.textContent = `In this chapter${chapter.name ? `, “${chapter.name}”` : ""} (${waits(count(chapter.from, chapter.to))})`;
    else if (option.value === "selection")
      option.textContent =
        from === to ? "In the selection" : `In the selection (${waits(count(from, to))})`;
  }
}

/** Names the speakers with the AI chosen, and gives them, one step to undo. */
async function nameSpeakers(
  pairing: Pairing,
  ai: string,
  context: AiContext,
  only?: number[],
): Promise<void> {
  const progress = $("#ai-progress");
  const result = $("#ai-result");
  const go = $<HTMLButtonElement>("#ai-go");
  const second = $<HTMLButtonElement>("#ai-second");
  const sent = context.text();
  // The story it is for: never given to another opened meanwhile.
  const storyId = context.storyId();
  running?.abort();
  running = new AbortController();
  behind = false;
  lastNaming = undefined;
  result.replaceChildren();
  if (only?.length === 0) {
    progress.textContent = "No quote there waits for a speaker.";
    return;
  }
  go.disabled = true;
  progress.textContent = "Asking…";
  // Writing on while it works: the dialog goes, the work goes on, and says when it's done.
  second.hidden = false;
  second.textContent = "Keep writing";
  second.onclick = () => $<HTMLDialogElement>("#ai").close("behind");
  naming = true;
  closeSays(true);
  // The button pressed is put out of use: the keys go to Stop, not lost to the page.
  $<HTMLButtonElement>("#ai-close").focus();
  try {
    let done: Record<string, unknown> | undefined;
    await work(
      pairing,
      "/v1/tag",
      { text: sent, with: ai, ...(only ? { only } : {}) },
      (event) => {
        if (event.type === "start") progress.textContent = `Asking ${String(event.ai)}…`;
        else if (event.type === "passage" && event.named !== undefined)
          progress.textContent = `Passage ${event.index} of ${event.of}${event.heading ? ` (${String(event.heading)})` : ""}: ${event.named} of ${event.asked} named.`;
        else if (event.type === "done") done = event;
      },
      running.signal,
    );
    if (!done) throw new HelperError("The helper stopped before it was done.");
    if (context.storyId() !== storyId) {
      const said =
        "The speakers named weren’t given: another story is open now. Open the story they were named for and name them again.";
      progress.textContent = said;
      if (behind) context.notice(said);
      return;
    }
    let changes = (done.changes ?? []) as TextChange[];
    /** Quotes the writer gave someone while the AI worked: their choice kept. */
    let keptOwn = 0;
    const proposals = (done.proposals ?? []) as Array<{
      quote: number;
      line: number;
      words: string;
      speaker: string;
      fullName?: string;
      confidence: string;
      outcome: string;
      why?: string;
    }>;
    const given = proposals.filter((proposal) => proposal.outcome === "given").length;
    const held = proposals.filter((proposal) => proposal.outcome !== "given");
    const unknown = (done.unknown as number[] | undefined)?.length ?? 0;
    const joined = (done.joined as string[] | undefined) ?? [];
    /** Quotes whose lines the writer changed while the AI worked: left for the writer. */
    let moved = 0;
    let givenNow = given;
    // Written on meanwhile: each quote found again in the story as it is now, and given there if
    // its line is as it was. A word typed elsewhere loses nothing.
    if (context.text() !== sent && changes.length) {
      const placed = placedNow(sent, context.text(), context.story());
      const gifts: Gift[] = [];
      for (const proposal of proposals) {
        if (proposal.outcome !== "given") continue;
        const now = placed(proposal.quote);
        if (now === "theirs") keptOwn++;
        else if (now === undefined) moved++;
        else
          gifts.push({
            quote: now,
            speaker: proposal.speaker,
            ...(proposal.fullName ? { fullName: proposal.fullName } : {}),
          });
      }
      const regiven = giveQuotes(context.story(), gifts);
      changes = regiven.changes;
      givenNow = regiven.given.length;
    }
    if (changes.length && !context.apply(changes)) {
      progress.textContent = "The speakers couldn't be given here.";
      return;
    }
    // What each scope covers now: the quotes given no longer wait.
    sayScopes(context);
    progress.textContent = [
      changes.length
        ? `${plural(givenNow, "speaker")} given${joined.length ? `, and ${joined.join(", ")} joined the cast` : ""}: Ctrl+Z takes them back.`
        : ai === "tags"
          ? "Nothing to give: no quote waiting for a speaker has a dialogue tag naming someone (“…” asked Mara)."
          : "Nothing to give: every quote the AI was asked about stayed as it was.",
      keptOwn ? `${plural(keptOwn, "quote")} you gave meanwhile kept as you gave them.` : "",
      moved
        ? `${plural(moved, "quote")} on lines you changed meanwhile left as they are: Ctrl+Shift+K finds them.`
        : "",
      held.length ? `${plural(held.length, "quote")} held back, below.` : "",
      unknown ? `${plural(unknown, "quote")} the AI couldn't tell: Ctrl+Shift+K finds them.` : "",
      done.stopped ? `It stopped early: ${String(done.stopped)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (held.length) {
      const list = document.createElement("ul");
      list.className = "ai-held";
      for (const proposal of held.slice(0, 50)) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "link-button";
        button.textContent = `Line ${proposal.line}: “${proposal.words}”`;
        button.onclick = () => {
          context.goToLine(proposal.line);
          $<HTMLDialogElement>("#ai").close();
        };
        item.append(
          button,
          ` ${proposal.speaker}? ${proposal.outcome === "held" ? `(${proposal.confidence})` : `(${proposal.why ?? "refused"})`}`,
        );
        list.append(item);
      }
      result.append(list);
    }
    lastNaming = { said: progress.textContent ?? "", held: [...result.childNodes] };
    // Written on while it worked: what it did, as the dialog says it, the dialog there to open.
    if (changes.length)
      context.notice(
        [
          `${plural(givenNow, "speaker")} given ${ai === "tags" ? "by their dialogue tags" : "by AI"}${joined.length ? `, ${joined.join(", ")} joining the cast` : ""}.`,
          keptOwn ? `${plural(keptOwn, "quote")} you gave meanwhile kept.` : "",
          moved ? `${plural(moved, "quote")} on lines you changed left as they are.` : "",
          held.length ? `${plural(held.length, "quote")} held back.` : "",
          "Ctrl+Z takes them back; Edit › Name the speakers with AI… lists them.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    else if (behind) context.notice(progress.textContent ?? "");
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      progress.textContent = (error as Error).message;
      if (behind) context.notice((error as Error).message);
    }
  } finally {
    naming = false;
    closeSays(false);
    go.disabled = false;
    second.hidden = true;
    behind = false;
  }
}

/** Casts and prices an audiobook, then makes it (or sends it to ElevenLabs Studio). */
async function audiobook(
  pairing: Pairing,
  service: string,
  mode: "estimate" | "make" | "studio",
  context: AiContext,
  sounds: boolean,
  found: Hello,
): Promise<void> {
  const progress = $("#ai-progress");
  const result = $("#ai-result");
  const go = $<HTMLButtonElement>("#ai-go");
  const second = $<HTMLButtonElement>("#ai-second");
  running?.abort();
  running = new AbortController();
  go.disabled = true;
  closeSays(true);
  $<HTMLButtonElement>("#ai-close").focus();
  second.hidden = true;
  if (mode === "estimate") result.replaceChildren();
  progress.textContent =
    mode === "estimate" ? "Casting…" : mode === "studio" ? "Sending…" : "Making it…";
  try {
    let done: Record<string, unknown> | undefined;
    await work(
      pairing,
      "/v1/audiobook",
      {
        text: context.text(),
        name: context.name(),
        with: service,
        mode,
        sounds,
        voices: chosen.get(service) ?? {},
      },
      (event) => {
        if (event.type === "casting") {
          stopHearing();
          result.replaceChildren(castingTable(event as unknown as Cast, pairing, service));
        } else if (event.type === "estimate") {
          const cost = event.costUsd as number | undefined;
          progress.textContent = `${plural(event.requests as number, "line")} to make, ${(event.characters as number).toLocaleString()} characters${cost !== undefined ? (cost > 0 ? `, about $${cost.toFixed(2)} at list price` : ", free") : ""}, less what was made before.`;
        } else if (event.type === "progress")
          progress.textContent = `Chapter ${event.chapter} of ${event.chapters} (${String(event.title)}): ${event.done} of ${event.total} lines.`;
        else if (event.type === "done") done = event;
      },
      running.signal,
    );
    if (!done) throw new HelperError("The helper stopped before it was done.");
    if (done.result === "estimated") {
      go.textContent = "Make it";
      go.onclick = () => void audiobook(pairing, service, "make", context, sounds, found);
      if (service === "elevenlabs") {
        second.hidden = false;
        second.textContent = "Send to ElevenLabs Studio";
        second.onclick = () => void audiobook(pairing, service, "studio", context, sounds, found);
      }
    } else if (done.result === "studio") {
      const link = document.createElement("a");
      link.href = String(done.url);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open it in ElevenLabs Studio";
      progress.textContent =
        "It's in ElevenLabs Studio, each line in its character's voice: listen, change and convert it there.";
      result.replaceChildren(link);
      go.textContent = "Cast it and count the cost";
      go.onclick = () => void audiobook(pairing, service, "estimate", context, sounds, found);
    } else if (done.result === "made") {
      const minutes = Math.max(1, Math.round((done.durationMs as number) / 60_000));
      progress.textContent = `Made: ${plural(done.chapters as number, "chapter")}, ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}, in ${String(done.folder)}.`;
      const list = document.createElement("ul");
      list.className = "ai-files";
      for (const file of (done.files as string[]).slice(0, 30)) {
        const item = document.createElement("li");
        item.textContent = file.slice(String(done.folder).length + 1);
        list.append(item);
      }
      result.replaceChildren(list);
      go.textContent = "Cast it and count the cost";
      go.onclick = () => void audiobook(pairing, service, "estimate", context, sounds, found);
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") progress.textContent = (error as Error).message;
  } finally {
    closeSays(false);
    go.disabled = false;
  }
}

/**
 * Where each quote of the story as sent is now, by its number: the number it has now; "theirs"
 * if the writer gave it to someone meanwhile; undefined if its line changed, or it is gone.
 */
export function placedNow(
  sent: string,
  text: string,
  now: Story,
): (quote: number) => number | "theirs" | undefined {
  const before = quotesOf(parse(sent));
  const edits = diffChanges(sent, text);
  const there = new Map(quotesOf(now).map((quote) => [quote.from, quote]));
  /** A place in the text as sent, in the text now: moved by every change wholly before it. */
  const mapped = (at: number) => {
    let by = 0;
    for (const edit of edits) {
      if (edit.to > at) break;
      by += edit.insert.length - (edit.to - edit.from);
    }
    return at + by;
  };
  return (number) => {
    const quote = before[number - 1];
    if (!quote) return undefined;
    const found = there.get(mapped(quote.from));
    if (!found || found.text !== quote.text) return undefined;
    if (!found.narrated) return "theirs";
    // Its line as it was: a tag changed nearby could mean someone else.
    const lineFrom = sent.lastIndexOf("\n", quote.from - 1) + 1;
    const end = sent.indexOf("\n", quote.to);
    const lineTo = end < 0 ? sent.length : end;
    const touches = (edit: TextChange) => {
      if (edit.to < lineFrom || edit.from > lineTo) return false;
      // Lines put in or taken out before it, or after it, leave it as it was.
      if (edit.to === lineFrom)
        return !(edit.insert
          ? edit.insert.endsWith("\n")
          : edit.from === edit.to || sent[edit.to - 1] === "\n");
      if (edit.from === lineTo) return !edit.insert.startsWith("\n");
      return true;
    };
    if (edits.some(touches)) return undefined;
    return found.number;
  };
}
