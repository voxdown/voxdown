/**
 * Naming the speakers with AI, and making an audiobook: both done by the writer's own computer,
 * through `vxd connect`. The dialog says how to connect when the Writer isn't; once it is, it
 * offers what the computer has (Claude Code, Codex, a local model…; ElevenLabs, Kokoro…), the
 * choice remembered, and shows the work as it goes. Speakers come back as changes to the story,
 * one step to undo; an audiobook is made in a folder on the computer.
 */
import type { TextChange } from "voxdown";
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
};

type Mode = "speakers" | "audiobook";

const CHOICE = { speakers: "voxdown-writer-ai", audiobook: "voxdown-writer-voices" } as const;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

let running: AbortController | undefined;

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
  progress.textContent = "";
  result.replaceChildren();
  second.hidden = true;
  go.disabled = false;
  connect.hidden = true;
  ready.hidden = true;
  if (!dialog.open) dialog.showModal();
  dialog.onclose = () => {
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
    connect.hidden = false;
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
    localStorage.setItem(CHOICE[mode], choice.value);
  };
  choice.onchange = describe;
  describe();

  if (mode === "speakers") {
    go.textContent = "Name the speakers";
    go.onclick = () => void nameSpeakers(pairing, choice.value, context);
  } else {
    go.textContent = "Cast it and count the cost";
    go.onclick = () =>
      void audiobook(pairing, choice.value, "estimate", context, sounds.checked, found);
  }
}

/** Names the speakers with the AI chosen, and gives them, one step to undo. */
async function nameSpeakers(pairing: Pairing, ai: string, context: AiContext): Promise<void> {
  const progress = $("#ai-progress");
  const result = $("#ai-result");
  const go = $<HTMLButtonElement>("#ai-go");
  const sent = context.text();
  running?.abort();
  running = new AbortController();
  go.disabled = true;
  result.replaceChildren();
  progress.textContent = "Asking…";
  try {
    let done: Record<string, unknown> | undefined;
    await work(
      pairing,
      "/v1/tag",
      { text: sent, with: ai },
      (event) => {
        if (event.type === "start") progress.textContent = `Asking ${String(event.ai)}…`;
        else if (event.type === "passage" && event.named !== undefined)
          progress.textContent = `Passage ${event.index} of ${event.of}${event.heading ? ` (${String(event.heading)})` : ""}: ${event.named} of ${event.asked} named.`;
        else if (event.type === "done") done = event;
      },
      running.signal,
    );
    if (!done) throw new HelperError("The helper stopped before it was done.");
    const changes = (done.changes ?? []) as TextChange[];
    const proposals = (done.proposals ?? []) as Array<{
      line: number;
      words: string;
      speaker: string;
      confidence: string;
      outcome: string;
      why?: string;
    }>;
    const given = proposals.filter((proposal) => proposal.outcome === "given").length;
    const held = proposals.filter((proposal) => proposal.outcome !== "given");
    const unknown = (done.unknown as number[] | undefined)?.length ?? 0;
    const joined = (done.joined as string[] | undefined) ?? [];
    if (context.text() !== sent) {
      progress.textContent =
        "The story changed while the AI worked, so nothing was given: run it again when you're ready.";
      return;
    }
    if (changes.length && !context.apply(changes)) {
      progress.textContent = "The speakers couldn't be given here.";
      return;
    }
    progress.textContent = [
      changes.length
        ? `${plural(given, "speaker")} given${joined.length ? `, and ${joined.join(", ")} joined the cast` : ""}: Ctrl+Z takes them back.`
        : "Nothing to give.",
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
      context.notice(`${plural(given, "speaker")} given by AI: Ctrl+Z takes them back.`);
  } catch (error) {
    if ((error as Error).name !== "AbortError") progress.textContent = (error as Error).message;
  } finally {
    go.disabled = false;
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
