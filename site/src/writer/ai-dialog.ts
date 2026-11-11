/**
 * Naming the speakers with AI, and making an audiobook: both done by the writer's own computer,
 * through `vxd connect`. The dialog says how to connect when the Writer isn't; once it is, it
 * offers what the computer has (Claude Code, Codex, a local model…; ElevenLabs, Kokoro…), the
 * choice remembered, and shows the work as it goes. Speakers come back as changes to the story,
 * one step to undo; an audiobook is made in a folder on the computer.
 */
import { type Story, type TextChange, bookText, giveQuotes, parse, quotesOf } from "voxdown";
import {
  type Found,
  type Hello,
  HelperError,
  type Pairing,
  forgetPairing,
  hello,
  keptPairing,
  work,
} from "./helper";

export type AiContext = {
  /** The story as the editor has it now. */
  text(): string;
  /** Makes the changes as one step to undo; false if they can't be made. */
  apply(changes: TextChange[]): boolean;
  notice(message: string): void;
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
/** A run the writer went back to writing beside: closing the dialog doesn't stop it. */
let behind = false;

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
  bookOptions.hidden = mode !== "audiobook";
  $("#ai-scope-options").hidden = mode !== "speakers";
  const selected = context.selection();
  ($("#ai-scope").querySelector('option[value="selection"]') as HTMLOptionElement).disabled =
    selected.from === selected.to;
  $("#ai-connect-how").hidden = false;
  progress.textContent = "";
  result.replaceChildren();
  second.hidden = true;
  go.disabled = false;
  connect.hidden = true;
  ready.hidden = true;
  if (!dialog.open) dialog.showModal();
  dialog.onclose = () => {
    if (behind) return;
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
    const levels = story.blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));
    const top = Math.min(...levels);
    const tops = story.blocks.filter((block) => block.kind === "heading" && block.level === top);
    start = [...tops].reverse().find((heading) => heading.range.from <= from)?.range.from ?? 0;
    end = tops.find((heading) => heading.range.from > from)?.range.from ?? story.source.length;
  }
  return quotesOf(story)
    .filter((quote) => quote.from >= start && quote.from < end)
    .map((quote) => quote.number);
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
  running?.abort();
  running = new AbortController();
  behind = false;
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
  second.onclick = () => {
    behind = true;
    $<HTMLDialogElement>("#ai").close();
    context.notice("Naming the speakers while you write: it says here when it's done.");
  };
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
    let changes = (done.changes ?? []) as TextChange[];
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
    // Written on meanwhile: given by number to the story as it is now, if its words are the same.
    if (context.text() !== sent && changes.length) {
      const now = context.story();
      if (bookText(parse(sent)) !== bookText(now)) {
        const said =
          "The story's words changed while the AI worked, so nothing was given: run it again when you're ready.";
        progress.textContent = said;
        if (behind) context.notice(said);
        return;
      }
      changes = giveQuotes(
        now,
        proposals
          .filter((proposal) => proposal.outcome === "given")
          .map((proposal) => ({
            quote: proposal.quote,
            speaker: proposal.speaker,
            ...(proposal.fullName ? { fullName: proposal.fullName } : {}),
          })),
      ).changes;
    }
    if (changes.length && !context.apply(changes)) {
      progress.textContent = "The speakers couldn't be given here.";
      return;
    }
    progress.textContent = [
      changes.length
        ? `${plural(given, "speaker")} given${joined.length ? `, and ${joined.join(", ")} joined the cast` : ""}: Ctrl+Z takes them back.`
        : ai === "tags"
          ? "Nothing to give: no quote waiting for a speaker has a dialogue tag naming someone (“…” asked Mara)."
          : "Nothing to give: every quote the AI was asked about stayed as it was.",
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
    if (changes.length)
      context.notice(
        `${plural(given, "speaker")} given by AI${held.length ? `, ${held.length} held back` : ""}: Ctrl+Z takes them back.`,
      );
    else if (behind) context.notice(progress.textContent ?? "");
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      progress.textContent = (error as Error).message;
      if (behind) context.notice((error as Error).message);
    }
  } finally {
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
  second.hidden = true;
  if (mode === "estimate") result.replaceChildren();
  progress.textContent =
    mode === "estimate" ? "Casting…" : mode === "studio" ? "Sending…" : "Making it…";
  try {
    let done: Record<string, unknown> | undefined;
    await work(
      pairing,
      "/v1/audiobook",
      { text: context.text(), name: context.name(), with: service, mode, sounds },
      (event) => {
        if (event.type === "casting") {
          const table = document.createElement("table");
          table.className = "ai-casting";
          const caption = document.createElement("caption");
          caption.textContent = `The voices (change them in ${String(event.file)})`;
          table.append(caption);
          for (const person of event.people as Array<{
            name: string;
            voice: string;
            description?: string;
          }>) {
            const row = table.insertRow();
            row.insertCell().textContent = person.name;
            row.insertCell().textContent = `${person.voice}${person.description ? ` (${person.description})` : ""}`;
          }
          result.replaceChildren(table);
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
    go.disabled = false;
  }
}
