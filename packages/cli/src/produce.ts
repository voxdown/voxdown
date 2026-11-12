/**
 * `vxd produce`: a story made into an audiobook with the voice service the writer has. The
 * production script is written first (it needs no service), then a casting: a voice for each
 * character, chosen for the writer to change in `casting.json`. Then what it would cost, and, once
 * agreed, every line, joined into chapters, as MP3 files and one M4B with its chapters marked when
 * ffmpeg is installed (WAV files when it isn't), with when each line is heard. Clips already made
 * are kept, so making it again only asks for what changed.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  type Adapter,
  type ChapterMade,
  PRESETS,
  type ProductionScript,
  azure,
  castVoices,
  chapterSsml,
  createStudioProject,
  elevenlabs,
  estimate,
  fromPcm16,
  openaiSpeech,
  produce,
  productionScript,
  speakersOf,
  toWav,
  voiceId,
} from "@voxdown/produce";
import {
  bookM4b,
  chapterMp3,
  decodeWithFfmpeg,
  folderStore,
  hasFfmpeg,
  wavFile,
} from "@voxdown/produce/node";
import { type Story, parse } from "voxdown";
import type { Machine } from "./ai";
import { ERROR, Failure, OK } from "./errors";

/** A voice service vxd can use, found on this computer or named with --with. */
type Service = {
  id: string;
  label: string;
  note?: string;
  make: (model: string | undefined) => Adapter;
};

/** The voice services this computer offers, the best first. */
export async function speechServices(machine: Machine): Promise<Service[]> {
  const env = machine.env;
  const found: Service[] = [];
  const fetch = machine.fetch;
  if (env.ELEVENLABS_API_KEY) {
    const key = env.ELEVENLABS_API_KEY;
    found.push({
      id: "elevenlabs",
      label: "ElevenLabs (ELEVENLABS_API_KEY)",
      note: "billed to that key's plan",
      make: (model) => elevenlabs({ key, fetch, ...(model ? { model } : {}) }),
    });
  }
  if (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) {
    const key = env.AZURE_SPEECH_KEY;
    const region = env.AZURE_SPEECH_REGION;
    found.push({
      id: "azure",
      label: `Azure AI Speech (${region})`,
      note: "billed to that resource",
      make: () => azure({ key, region, fetch }),
    });
  }
  const kokoro = env.KOKORO_URL ?? PRESETS.kokoro.base;
  try {
    const response = await fetch(`${kokoro.replace(/\/$/, "")}/v1/audio/voices`, {
      signal: AbortSignal.timeout(500),
    });
    if (response.ok)
      found.push({
        id: "kokoro",
        label: `Kokoro (${kokoro})`,
        note: "free, on this computer",
        make: (model) =>
          openaiSpeech({ ...PRESETS.kokoro, base: kokoro, fetch, ...(model ? { model } : {}) }),
      });
  } catch {}
  if (env.OPENAI_API_KEY) {
    const key = env.OPENAI_API_KEY;
    found.push({
      id: "openai",
      label: "OpenAI speech (OPENAI_API_KEY)",
      note: "OpenAI retires these voices on 6 January 2027",
      make: (model) => openaiSpeech({ ...PRESETS.openai, key, fetch, ...(model ? { model } : {}) }),
    });
  }
  return found;
}

const NO_SERVICE = [
  "set ELEVENLABS_API_KEY, or AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, or OPENAI_API_KEY;",
  "or run Kokoro on this computer (docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu);",
  "or name any OpenAI-compatible speech server: --with http://127.0.0.1:8000 --model <model>.",
  "--script-only writes the production script and SSML, with no service.",
].join(" ");

/** The service --with names, or the one found, or the one chosen. */
export async function chooseService(
  machine: Machine,
  named: string | undefined,
  model: string | undefined,
  ask: ((question: string) => Promise<string>) | undefined,
  say: (text: string) => void,
): Promise<{ id: string; adapter: Adapter }> {
  if (named && /^https?:\/\//.test(named)) {
    if (!model) throw new Failure("an OpenAI-compatible server needs --model, the model it serves");
    return {
      id: "speech",
      adapter: openaiSpeech({
        base: named,
        model,
        id: "speech",
        name: named,
        instructions: true,
        fetch: machine.fetch,
        ...(machine.env.SPEECH_API_KEY ? { key: machine.env.SPEECH_API_KEY } : {}),
      }),
    };
  }
  const found = await speechServices(machine);
  if (named) {
    const service = found.find((candidate) => candidate.id === named.toLowerCase());
    if (!service) {
      if (named.toLowerCase() === "kokoro")
        throw new Failure(
          "Kokoro isn't running: docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu (or set KOKORO_URL)",
        );
      throw new Failure(
        found.length
          ? `${named} isn't set up here. Found: ${found.map((other) => other.id).join(", ")}`
          : `${named} isn't set up here: ${NO_SERVICE}`,
      );
    }
    return { id: service.id, adapter: service.make(model) };
  }
  if (found.length === 0) throw new Failure(`no voice service found: ${NO_SERVICE}`);
  if (found.length === 1 || !ask) {
    if (found.length > 1)
      throw new Failure(
        `several voice services are here: choose one with --with ${found.map((s) => s.id).join("|")}`,
      );
    const only = found[0] as Service;
    return { id: only.id, adapter: only.make(model) };
  }
  say("Which voice service should read it?\n");
  found.forEach((service, index) =>
    say(`  ${index + 1}. ${service.label}${service.note ? `: ${service.note}` : ""}\n`),
  );
  for (;;) {
    const answer = (await ask(`Choose 1–${found.length} [1]: `)).trim();
    const choice = answer === "" ? 1 : Number(answer);
    const service = found[choice - 1];
    if (Number.isInteger(choice) && service)
      return { id: service.id, adapter: service.make(model) };
  }
}

/** `1,3-5` as chapter numbers. */
export function chapterList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!match)
      throw new Failure(
        `--chapters takes numbers and ranges, such as 1,3-5, not ${JSON.stringify(text)}`,
      );
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    for (let number = from; number <= to; number++) out.push(number);
  }
  return out;
}

/** A file name stores take: ASCII letters, digits and dashes. */
export function fileName(number: number, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${String(number).padStart(2, "0")}${slug ? `-${slug}` : ""}`;
}

const seconds = (ms: number) => Math.round(ms) / 1000;

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
    : `${Math.max(1, minutes)} min`;
}

/** Who needs a voice: the narrator, and everyone the script gives words or sounds to. */
/** At most this many characters are said to hear a voice. */
const SAMPLE = 220;

/**
 * Words someone says in the story, to hear a voice say them: their first line of ten words or
 * more that isn't a heading (a chapter's "One" says little of a voice), else their longest; cut
 * at a sentence's end where it runs long.
 */
export function firstWords(script: ProductionScript, name: string): string | undefined {
  const key = name.toLowerCase();
  const theirs = script.lines.filter(
    (line) => line.kind === "speech" && line.speaker?.toLowerCase() === key && line.text.trim(),
  );
  const count = (text: string) => text.split(/\s+/).filter(Boolean).length;
  const told = theirs.filter((line) => line.heading === undefined);
  const line =
    told.find((candidate) => count(candidate.text) >= 10) ??
    [...(told.length ? told : theirs)].sort((a, b) => count(b.text) - count(a.text))[0];
  if (!line) return undefined;
  const text = line.text.trim();
  if (text.length <= SAMPLE) return text;
  // Cut at the end of a sentence, else of a word.
  const cut = text.slice(0, SAMPLE);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return sentence > SAMPLE / 3
    ? cut.slice(0, sentence + 1)
    : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/**
 * Words said in a voice, to hear it before choosing it: a WAV or an MP3, and its type. Costs what
 * the service charges for so many characters (at most a sentence or two).
 */
export async function sampleIn(
  service: { id: string; adapter: Adapter },
  voice: string,
  words: string,
  language?: string,
): Promise<{ audio: Uint8Array; type: string }> {
  const voices = await service.adapter.voices();
  const id = voiceId(voices, voice);
  if (!id) throw new Failure(`“${voice}” isn't one of ${service.adapter.name}'s voices`);
  const clip = await service.adapter.speak({
    text: words.slice(0, SAMPLE),
    voice: id,
    direction: null,
    ...(language ? { language } : {}),
  });
  if (clip.format === "mp3") return { audio: clip.audio, type: "audio/mpeg" };
  if (clip.format === "wav") return { audio: clip.audio, type: "audio/wav" };
  return { audio: toWav(fromPcm16(clip.audio, clip.rate ?? 24_000)), type: "audio/wav" };
}

function peopleOf(story: Story, script: ProductionScript) {
  const speakers = script.lines
    .filter((line) => line.speaker && (line.kind === "speech" || line.kind === "vocal"))
    .map((line) => line.speaker as string);
  return speakersOf(story, speakers);
}

export type ProduceContext = {
  machine: Machine;
  cwd: string;
  input: { name: string; path: string | null; text: string };
  values: Record<string, string | boolean | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  interactive: boolean;
  question?: (text: string) => Promise<string>;
};

export async function produceCommand(context: ProduceContext): Promise<number> {
  const { input, values } = context;
  const flag = (name: string) => values[name] === true;
  const value = (name: string) =>
    typeof values[name] === "string" ? (values[name] as string) : undefined;
  const story = parse(input.text);
  const script = productionScript(story);
  if (script.lines.every((line) => line.kind !== "speech"))
    throw new Failure(`${input.name} has nothing to read aloud`);
  const where = input.path ? dirname(input.path) : context.cwd;
  const out = resolve(
    context.cwd,
    value("out") ?? join(where, `${basename(input.name).replace(/\.[^.]+$/, "")}.audiobook`),
  );
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "script.json"), `${JSON.stringify(script, null, 1)}\n`);
  const castingFile = join(out, "casting.json");
  const allCasting: Record<string, Record<string, string>> = existsSync(castingFile)
    ? (JSON.parse(await readFile(castingFile, "utf8")) as Record<string, Record<string, string>>)
    : {};
  const chapters = value("chapters") ? chapterList(value("chapters") as string) : undefined;

  if (flag("script-only")) {
    const casting = Object.values(allCasting)[0] ?? {};
    await mkdir(join(out, "ssml"), { recursive: true });
    for (const chapter of script.chapters)
      await writeFile(
        join(out, "ssml", `${fileName(chapter.number, chapter.title)}.ssml`),
        chapterSsml(script, chapter.number, casting),
      );
    context.stdout(
      `Wrote the production script (${script.lines.length} lines, ${script.chapters.length} chapter${script.chapters.length === 1 ? "" : "s"}) and SSML to ${out}.\n`,
    );
    return OK;
  }

  const service = await chooseService(
    context.machine,
    value("with"),
    value("model"),
    context.interactive ? context.question : undefined,
    context.stderr,
  );
  const mode = flag("studio") ? "studio" : flag("dry-run") ? "estimate" : "make";
  const asks = context.interactive && context.question && !flag("yes");
  const result = await makeAudiobook({
    machine: context.machine,
    story,
    script,
    name: input.name,
    out,
    service,
    mode,
    sounds: flag("sounds"),
    keepWav: flag("keep-wav"),
    ...(value("model") ? { model: value("model") as string } : {}),
    ...(chapters ? { chapters } : {}),
    ...(asks
      ? {
          confirm: async () =>
            !(
              await (context.question as (text: string) => Promise<string>)(
                mode === "studio"
                  ? "Send it to ElevenLabs Studio as a new project? [Y/n] "
                  : "Make it? [Y/n] ",
              )
            )
              .trim()
              .toLowerCase()
              .startsWith("n"),
        }
      : {}),
    onEvent: (event) => {
      if (event.type === "casting") {
        const width = Math.max(...event.people.map((person) => person.name.length));
        context.stderr(`Casting (${event.file}):\n`);
        for (const person of event.people)
          context.stderr(
            `  ${person.name.padEnd(width)}  ${person.voice}${person.description ? ` (${person.description})` : ""}\n`,
          );
      } else if (event.type === "estimate") context.stderr(`${estimateText(event)}\n`);
      else if (event.type === "progress" && (event.done === event.total || event.done % 20 === 0))
        context.stderr(
          `  ${event.chapter}/${event.chapters} ${event.title}: ${event.done} of ${event.total}\n`,
        );
    },
  });
  if (result.type === "estimated") {
    context.stderr(
      `Nothing ${mode === "studio" ? "sent" : "made"} (--dry-run). Change the voices in casting.json, then run it again.\n`,
    );
    return OK;
  }
  if (result.type === "declined") return OK;
  if (result.type === "studio") {
    context.stdout(
      `${script.title} is in ElevenLabs Studio, each line in its character's voice: ${result.url}\nListen, change and convert it there; nothing is converted (or paid for) until you do.\n`,
    );
    return OK;
  }
  context.stdout(
    `${script.title}: ${result.chapters} chapter${result.chapters === 1 ? "" : "s"}, ${duration(result.durationMs)}, in ${out}${result.ffmpeg ? (chapters ? " (MP3 a chapter)" : " (an M4B, and an MP3 a chapter)") : " (WAV a chapter: install ffmpeg for MP3 and M4B)"}.\n` +
      `${result.requests} line${result.requests === 1 ? "" : "s"} asked of ${result.service}, ${result.fromStore} already made.\n`,
  );
  return OK;
}

/** What making a book would cost and leave out, in a line. */
export function estimateText(event: Extract<AudiobookEvent, { type: "estimate" }>): string {
  const parts = [
    `${event.requests} request${event.requests === 1 ? "" : "s"}, ${event.characters.toLocaleString("en")} characters`,
    event.costUsd !== undefined
      ? event.costUsd > 0
        ? `about $${event.costUsd.toFixed(2)} at list price`
        : "free"
      : "",
  ].filter(Boolean);
  const left: string[] = [];
  if (event.left.sounds)
    left.push(
      `${event.left.sounds} sound${event.left.sounds === 1 ? "" : "s"}${event.canSound ? " (--sounds makes them)" : ""}`,
    );
  if (event.left.vocals)
    left.push(`${event.left.vocals} sound${event.left.vocals === 1 ? "" : "s"} characters make`);
  if (event.left.directions)
    left.push(
      `${event.left.directions} direction${event.left.directions === 1 ? "" : "s"} (${event.service} can't follow them)`,
    );
  return `${event.service}: ${parts.join(", ")}, before any already made.${left.length ? `\nLeft out: ${left.join("; ")}.` : ""}`;
}

/** What happens while a book is made, for whoever shows it. */
export type AudiobookEvent =
  | {
      type: "casting";
      file: string;
      /** Each voice, the voice's id, and the first words they say, to hear in a voice. */
      people: Array<{
        name: string;
        voice: string;
        id: string;
        description?: string;
        sample?: string;
      }>;
      /** The service's voices, to choose from. */
      voices: Array<{ id: string; name: string; description?: string; language?: string }>;
    }
  | {
      type: "estimate";
      service: string;
      requests: number;
      characters: number;
      costUsd?: number;
      left: { sounds: number; vocals: number; directions: number };
      canSound: boolean;
    }
  | {
      type: "progress";
      chapter: number;
      chapters: number;
      title: string;
      done: number;
      total: number;
    };

export type AudiobookResult =
  | { type: "estimated" }
  | { type: "declined" }
  | { type: "studio"; url: string }
  | {
      type: "made";
      folder: string;
      files: string[];
      chapters: number;
      durationMs: number;
      requests: number;
      fromStore: number;
      service: string;
      ffmpeg: boolean;
    };

/**
 * Casts a story's voices (kept in `casting.json` in `out`), says what the book would cost, and
 * then, as `mode` says, stops there, sends it to ElevenLabs Studio, or makes it: chapters, an M4B,
 * timings and what made it. For `vxd produce` and for the Writer, through `vxd connect`.
 */
export async function makeAudiobook(options: {
  machine: Machine;
  story: Story;
  script: ProductionScript;
  /** The story's file name. */
  name: string;
  out: string;
  service: { id: string; adapter: Adapter };
  mode: "estimate" | "make" | "studio";
  model?: string;
  chapters?: number[];
  sounds?: boolean;
  keepWav?: boolean;
  /** Voices the writer chose (by id or name), by character: kept in `casting.json`. */
  recast?: Record<string, string>;
  /** Asked before anything is paid for; no answer, and it goes ahead. */
  confirm?: () => Promise<boolean>;
  onEvent?: (event: AudiobookEvent) => void;
  signal?: AbortSignal;
}): Promise<AudiobookResult> {
  const { story, script, out, mode, chapters } = options;
  const { id, adapter } = options.service;
  const emit = options.onEvent ?? (() => {});
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "script.json"), `${JSON.stringify(script, null, 1)}\n`);
  const castingFile = join(out, "casting.json");
  const allCasting: Record<string, Record<string, string>> = existsSync(castingFile)
    ? (JSON.parse(await readFile(castingFile, "utf8")) as Record<string, Record<string, string>>)
    : {};
  // The casting: kept from before, and a voice for anyone without one.
  const voices = await adapter.voices();
  if (voices.length === 0) throw new Failure(`${adapter.name} offers no voices to cast`);
  const people = peopleOf(story, script);
  const kept: Record<string, string> = { ...(allCasting[id] ?? {}) };
  for (const [name, voice] of Object.entries(options.recast ?? {})) {
    if (!people.some((person) => person.name === name)) continue;
    if (!voiceId(voices, voice))
      throw new Failure(`${name}'s voice “${voice}” isn't one of ${adapter.name}'s`);
    kept[name] = voice;
  }
  const casting = castVoices(people, voices, {
    ...(script.language ? { language: script.language } : {}),
    kept,
  });
  const unknown = Object.entries(casting).filter(([, voice]) => !voiceId(voices, voice));
  if (unknown.length)
    throw new Failure(
      `${unknown.map(([name, voice]) => `${name}'s voice “${voice}”`).join(", ")} isn't one of ${adapter.name}'s: change it in ${castingFile}`,
    );
  if (JSON.stringify(casting) !== JSON.stringify(allCasting[id] ?? {})) {
    allCasting[id] = casting;
    await writeFile(castingFile, `${JSON.stringify(allCasting, null, 2)}\n`);
  }
  const ids = Object.fromEntries(
    Object.entries(casting).map(([name, voice]) => [name, voiceId(voices, voice) as string]),
  );
  emit({
    type: "casting",
    file: castingFile,
    people: people.map((person) => {
      const voice = voices.find((candidate) => candidate.id === ids[person.name]);
      const sample = firstWords(script, person.name);
      return {
        name: person.name,
        voice: voice?.name ?? (casting[person.name] as string),
        id: ids[person.name] as string,
        ...(voice?.description ? { description: voice.description } : {}),
        ...(sample ? { sample } : {}),
      };
    }),
    voices: voices.map((voice) => ({
      id: voice.id,
      name: voice.name,
      ...(voice.description ? { description: voice.description } : {}),
      ...(voice.language ? { language: voice.language } : {}),
    })),
  });
  const sounds = Boolean(options.sounds);
  const cost = estimate(script, {
    adapter,
    voices: ids,
    sounds,
    ...(chapters ? { chapters } : {}),
  });
  emit({
    type: "estimate",
    service: adapter.name,
    requests: cost.requests,
    characters: cost.characters,
    ...(cost.costUsd !== undefined ? { costUsd: cost.costUsd } : {}),
    left: cost.left,
    canSound: adapter.capabilities.sounds,
  });
  if (mode === "studio" && id !== "elevenlabs")
    throw new Failure(
      "--studio sends the book to ElevenLabs Studio: use it with --with elevenlabs",
    );
  if (mode === "estimate") return { type: "estimated" };
  if (options.confirm && !(await options.confirm())) return { type: "declined" };
  if (mode === "studio") {
    const project = await createStudioProject(script, ids, {
      key: options.machine.env.ELEVENLABS_API_KEY as string,
      fetch: options.machine.fetch,
      ...(options.model ? { model: options.model } : {}),
    });
    return { type: "studio", url: project.url };
  }

  // Making it.
  const ffmpeg = await hasFfmpeg();
  const folder = join(out, "chapters");
  await mkdir(folder, { recursive: true });
  const rate = 24_000;
  const files = new Map<number, string>();
  let made: Awaited<ReturnType<typeof produce>>;
  try {
    made = await produce(script, {
      adapter,
      voices: ids,
      sounds,
      store: folderStore(join(out, ".clips", id)),
      rate,
      ...(chapters ? { chapters } : {}),
      ...(ffmpeg ? { decode: decodeWithFfmpeg } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      output: async (chapter) => {
        const wav = join(folder, `${fileName(chapter.number, chapter.title)}.wav`);
        files.set(chapter.number, wav);
        return wavFile(wav, rate);
      },
      onProgress: ({ chapter, done, total }) =>
        emit({
          type: "progress",
          chapter: chapter.number,
          chapters: script.chapters.length,
          title: chapter.title,
          done,
          total,
        }),
    });
  } catch (error) {
    throw new Failure(
      `${(error as Error).message} (what was made is kept: run it again to go on)`,
      ERROR,
    );
  }
  // Each chapter's timings, as the Listen page reads them.
  await mkdir(join(out, "timings"), { recursive: true });
  for (const chapter of made.chapters)
    await writeTimings(out, script, chapter, id, adapter, casting, ffmpeg);
  const title = script.title;
  const written: string[] = [];
  if (ffmpeg) {
    for (const chapter of made.chapters) {
      const wav = files.get(chapter.number) as string;
      const mp3 = wav.replace(/\.wav$/, ".mp3");
      await chapterMp3(wav, mp3, {
        title: chapter.title,
        album: title,
        ...(script.author ? { artist: script.author } : {}),
        track: chapter.number,
        tracks: script.chapters.length,
      });
      written.push(mp3);
    }
    if (!chapters) {
      const m4b = join(out, `${fileName(0, title).slice(3) || "book"}.m4b`);
      await bookM4b(
        made.chapters.map((chapter) => ({
          wav: files.get(chapter.number) as string,
          title: chapter.title,
          durationMs: chapter.durationMs,
        })),
        m4b,
        { title, ...(script.author ? { author: script.author } : {}) },
      );
      written.unshift(m4b);
    }
    if (!options.keepWav) for (const wav of files.values()) await rm(wav, { force: true });
    else written.push(...files.values());
  } else written.push(...files.values());
  await writeFile(
    join(out, "about.json"),
    `${JSON.stringify(
      {
        story: basename(options.name),
        title,
        ...(script.author ? { author: script.author } : {}),
        service: adapter.name,
        model: adapter.model,
        voices: casting,
        made: new Date().toISOString(),
        // What stores ask an AI-narrated book to say about its narrator.
        disclosure: `This audiobook is narrated by synthetic (AI) voices from ${adapter.name}.`,
        narrator: "Synthesised voice",
      },
      null,
      2,
    )}\n`,
  );
  return {
    type: "made",
    folder: out,
    files: written,
    chapters: made.chapters.length,
    durationMs: made.chapters.reduce((sum, chapter) => sum + chapter.durationMs, 0),
    requests: made.requests,
    fromStore: made.fromStore,
    service: adapter.name,
    ffmpeg,
  };
}

async function writeTimings(
  out: string,
  script: ProductionScript,
  chapter: ChapterMade,
  service: string,
  adapter: Adapter,
  casting: Record<string, string>,
  ffmpeg: boolean,
): Promise<void> {
  const name = fileName(chapter.number, chapter.title);
  const timings = {
    title: script.title,
    chapter: chapter.number,
    chapterTitle: chapter.title,
    audio: `chapters/${name}.${ffmpeg ? "mp3" : "wav"}`,
    service,
    model: adapter.model,
    voices: casting,
    duration: seconds(chapter.durationMs),
    cues: chapter.cues.map((cue) => ({
      id: cue.id,
      kind: cue.kind,
      from: cue.from,
      line: cue.line,
      speaker: cue.speaker,
      direction: cue.direction,
      text: cue.text,
      ...(cue.sent ? { sent: cue.sent } : {}),
      start: seconds(cue.startMs),
      duration: seconds(cue.durationMs),
      ...(cue.words
        ? {
            words: cue.words.map((word) => [word.text, seconds(word.startMs), seconds(word.endMs)]),
          }
        : {}),
    })),
  };
  await writeFile(join(out, "timings", `${name}.json`), `${JSON.stringify(timings, null, 1)}\n`);
}
