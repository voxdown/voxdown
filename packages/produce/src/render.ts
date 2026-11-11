/**
 * Making the audiobook: each line asked of the voice service once (a clip already made is taken
 * from the store), then each chapter joined in order, its clips' quiet edges trimmed and each
 * brought to the same loudness, with the silence between lines set by what follows them, so the
 * pacing is the same whichever service speaks. A chapter is written out as it is joined, so a
 * long book never has to fit in memory, and when each line is heard is noted as it goes.
 */
import { type Adapter, AdapterError, type Clip, type SpeakRequest, type WordTime } from "./adapter";
import {
  type Sound,
  fromPcm16,
  fromWav,
  lengthMs,
  leveled,
  resample,
  silence,
  toPcm16,
  trimmed,
} from "./audio";
import { type Chapter, type ProductionLine, type ProductionScript, hashOf } from "./script";
import { GAPS } from "./ssml";

/** Where made clips are kept between runs, by a key of what made them. */
export type ClipStore = {
  get(key: string): Promise<Clip | undefined>;
  set(key: string, clip: Clip): Promise<void>;
};

/** A store that keeps clips while the program runs. */
export function memoryStore(): ClipStore {
  const clips = new Map<string, Clip>();
  return {
    get: async (key) => clips.get(key),
    set: async (key, clip) => void clips.set(key, clip),
  };
}

/** Where a chapter's sound goes, a piece at a time, as 16-bit mono PCM. */
export type ChapterSink = {
  write(pcm: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

/** When a line is heard in its chapter's sound. */
export type Cue = {
  id: string;
  kind: ProductionLine["kind"];
  speaker: string | null;
  direction: string | null;
  text: string;
  /** What the service was sent. */
  sent?: string;
  startMs: number;
  durationMs: number;
  words?: WordTime[];
  /** Where it is in the story. */
  from: number;
  line: number;
};

export type ChapterMade = {
  number: number;
  title: string;
  durationMs: number;
  rate: number;
  cues: Cue[];
};

/** What a line couldn't have, and why: a sound with no sound effects, a direction the voice can't take. */
export type Left = { sounds: number; vocals: number; directions: number };

export type Progress = {
  chapter: Chapter;
  /** Lines with sound to make in it, and how many are made. */
  done: number;
  total: number;
  fromStore: number;
};

export type ProduceOptions = {
  adapter: Adapter;
  /** The service's voice id for each speaker, the narrator's included. */
  voices: Record<string, string>;
  store?: ClipStore;
  /** Make sounds and page turns with the service's sound effects (they cost too). */
  sounds?: boolean;
  /** Only these chapters (by number). */
  chapters?: readonly number[];
  /** Samples a second in the chapters made. Default 24,000. */
  rate?: number;
  /** Turns a clip in a format only Node can read (MP3) into sound. */
  decode?: (clip: Clip) => Promise<Sound>;
  /** Where each chapter's sound goes. */
  output: (chapter: Chapter) => Promise<ChapterSink> | ChapterSink;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
  /** Waits between tries when a service is busy (tests give one that doesn't wait). */
  wait?: (ms: number) => Promise<void>;
};

/** How loud each kind of clip is made, in dB: voices first, the world behind them. */
const LEVEL = { voice: -20, sound: -27, page: -32 };
/** Silence at a chapter's start and end, as audiobook stores ask for. */
export const ROOM = { headMs: 1000, tailMs: 1500 };
const PAGE_TURN = "a single page of a book turning, soft paper, close and quiet";

type Job =
  | { kind: "speak"; key: string; request: SpeakRequest; parts?: undefined }
  | { kind: "speak-parts"; key: string; parts: Array<{ key: string; request: SpeakRequest }> }
  | { kind: "sound"; key: string; description: string; seconds: number }
  | { kind: "silence"; ms: number };

/** A text cut into pieces of at most `max` characters, at sentence ends where it can be. */
export function pieces(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”’»)]*\s*|$)/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > max && current) {
      out.push(current.trim());
      current = "";
    }
    if (sentence.length > max) {
      for (let at = 0; at < sentence.length; at += max)
        out.push(sentence.slice(at, at + max).trim());
      continue;
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/** The voice a line is said in. */
function voiceOf(
  line: ProductionLine,
  script: ProductionScript,
  voices: Record<string, string>,
): string {
  const speaker = line.speaker ?? script.narrator;
  const found =
    voices[speaker] ??
    Object.entries(voices).find(([name]) => name.toLowerCase() === speaker.toLowerCase())?.[1];
  if (!found) throw new AdapterError(`No voice is cast for ${speaker}.`);
  return found;
}

/** The jobs a chapter's lines need, and what was left out. */
export function plan(
  script: ProductionScript,
  chapter: number,
  options: Pick<ProduceOptions, "adapter" | "voices" | "sounds">,
): { jobs: Map<string, Job>; left: Left; characters: number } {
  const { adapter, voices } = options;
  const can = adapter.capabilities;
  const lines = script.lines.filter((line) => line.chapter === chapter);
  const speech = lines.filter((line) => line.kind === "speech");
  const jobs = new Map<string, Job>();
  const left: Left = { sounds: 0, vocals: 0, directions: 0 };
  let characters = 0;
  const key = (parts: unknown[]) => hashOf(JSON.stringify([adapter.id, adapter.model, ...parts]));
  const soundsOn = Boolean(options.sounds && can.sounds && adapter.sound);
  for (const line of lines) {
    if (line.kind === "speech") {
      const vocals = lines.filter((other) => other.kind === "vocal" && other.with === line.id);
      const before = can.vocalTags
        ? vocals.find((vocal) => vocal.from < line.from)?.text
        : undefined;
      const after = can.vocalTags
        ? vocals.find((vocal) => vocal.from > line.from)?.text
        : undefined;
      const direction = can.directions === "none" ? null : line.direction;
      if (line.direction && can.directions === "none") left.directions++;
      const index = speech.indexOf(line);
      const base = {
        voice: voiceOf(line, script, voices),
        direction,
        ...(script.language ? { language: script.language } : {}),
      };
      const texts = pieces(line.text, Math.max(200, can.maxCharacters - 200));
      const requests = texts.map((text, part) => {
        const request: SpeakRequest = {
          ...base,
          text,
          ...(part === 0 && before ? { before } : {}),
          ...(part === texts.length - 1 && after ? { after } : {}),
          ...(part > 0
            ? { previous: texts[part - 1] as string }
            : speech[index - 1]
              ? { previous: (speech[index - 1] as ProductionLine).text }
              : {}),
          ...(part < texts.length - 1
            ? { next: texts[part + 1] as string }
            : speech[index + 1]
              ? { next: (speech[index + 1] as ProductionLine).text }
              : {}),
        };
        characters +=
          text.length +
          (request.before?.length ?? 0) +
          (request.after?.length ?? 0) +
          (direction?.length ?? 0);
        // The lines around it help the flow, but don't decide which clip it is: a neighbour
        // changed doesn't make it again.
        return {
          key: key([
            "speak",
            base.voice,
            text,
            direction,
            request.before,
            request.after,
            base.language,
          ]),
          request,
        };
      });
      const [only] = requests;
      jobs.set(
        line.id,
        requests.length === 1 && only
          ? { kind: "speak", key: only.key, request: only.request }
          : {
              kind: "speak-parts",
              key: key(requests.map((request) => request.key)),
              parts: requests,
            },
      );
    } else if (line.kind === "vocal") {
      if (line.with && can.vocalTags) continue;
      if (can.vocalTags) {
        const request: SpeakRequest = {
          text: "",
          before: line.text,
          voice: voiceOf(line, script, voices),
          direction: can.directions === "none" ? null : line.direction,
        };
        characters += line.text.length + 2;
        jobs.set(line.id, {
          kind: "speak",
          key: key(["vocal", request.voice, line.text, request.direction]),
          request,
        });
      } else if (soundsOn) {
        const member = line.speaker ?? "";
        jobs.set(line.id, {
          kind: "sound",
          key: key(["sound", `${line.text}: ${member}`, 2]),
          description: `${line.direction ? `${line.text}, ${line.direction}` : line.text}: ${member}`,
          seconds: 2,
        });
      } else left.vocals++;
    } else if (line.kind === "sound") {
      if (soundsOn)
        jobs.set(line.id, {
          kind: "sound",
          key: key(["sound", line.text, 2.5]),
          description: line.text,
          seconds: 2.5,
        });
      else left.sounds++;
    } else if (line.kind === "pause") {
      jobs.set(line.id, { kind: "silence", ms: line.ms ?? 1000 });
    } else if (line.kind === "page") {
      jobs.set(
        line.id,
        soundsOn
          ? { kind: "sound", key: key(["sound", PAGE_TURN, 1]), description: PAGE_TURN, seconds: 1 }
          : { kind: "silence", ms: 600 },
      );
    }
  }
  return { jobs, left, characters };
}

/** Runs `work` on each item, `limit` at a time, in order of starting. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed: unknown;
  const worker = async () => {
    while (next < items.length && failed === undefined) {
      const item = items[next++] as T;
      try {
        await work(item);
      } catch (error) {
        failed ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed !== undefined) throw failed;
}

/** Makes the audiobook's chapters, as `options.output` takes them. */
export async function produce(
  script: ProductionScript,
  options: ProduceOptions,
): Promise<{
  chapters: ChapterMade[];
  requests: number;
  fromStore: number;
  characters: number;
  left: Left;
}> {
  const { adapter } = options;
  const store = options.store ?? memoryStore();
  const rate = options.rate ?? 24_000;
  const wait = options.wait ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const made: ChapterMade[] = [];
  const left: Left = { sounds: 0, vocals: 0, directions: 0 };
  let requests = 0;
  let fromStore = 0;
  let characters = 0;

  /** One clip: from the store, or asked for (again, when the service is busy), then kept. */
  const clip = async (key: string, ask: () => Promise<Clip>): Promise<Clip> => {
    const kept = await store.get(key);
    if (kept) {
      fromStore++;
      return kept;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        requests++;
        const fresh = await ask();
        await store.set(key, fresh);
        return fresh;
      } catch (error) {
        if (
          !(error instanceof AdapterError && error.retry) ||
          attempt >= 3 ||
          options.signal?.aborted
        )
          throw error;
        await wait([2_000, 6_000, 15_000][attempt] as number);
      }
    }
  };

  const toSound = async (made: Clip): Promise<Sound> => {
    if (made.format === "pcm16") return fromPcm16(made.audio, made.rate ?? 24_000);
    if (made.format === "wav") return fromWav(made.audio);
    if (!options.decode) throw new AdapterError(`A ${made.format} clip can't be read here.`);
    return options.decode(made);
  };

  for (const chapter of script.chapters) {
    if (options.chapters && !options.chapters.includes(chapter.number)) continue;
    const {
      jobs,
      left: chapterLeft,
      characters: chapterCharacters,
    } = plan(script, chapter.number, options);
    left.sounds += chapterLeft.sounds;
    left.vocals += chapterLeft.vocals;
    left.directions += chapterLeft.directions;
    characters += chapterCharacters;
    // Every clip first, several at once.
    const clips = new Map<string, Clip[]>();
    const asked = [...jobs.entries()].filter(([, job]) => job.kind !== "silence");
    let done = 0;
    const startedFromStore = fromStore;
    options.onProgress?.({ chapter, done, total: asked.length, fromStore: 0 });
    await eachLimited(asked, adapter.capabilities.concurrency, async ([id, job]) => {
      const signal = options.signal ? { signal: options.signal } : {};
      if (job.kind === "speak")
        clips.set(id, [await clip(job.key, () => adapter.speak({ ...job.request, ...signal }))]);
      else if (job.kind === "speak-parts") {
        const parts: Clip[] = [];
        for (const part of job.parts)
          parts.push(await clip(part.key, () => adapter.speak({ ...part.request, ...signal })));
        clips.set(id, parts);
      } else if (job.kind === "sound") {
        const make = adapter.sound;
        if (!make) return;
        clips.set(id, [
          await clip(job.key, () =>
            make.call(adapter, { description: job.description, seconds: job.seconds, ...signal }),
          ),
        ]);
      }
      done++;
      options.onProgress?.({
        chapter,
        done,
        total: asked.length,
        fromStore: fromStore - startedFromStore,
      });
    });

    // Then the chapter, in order.
    const sink = await options.output(chapter);
    let samples = 0;
    const write = async (sound: Sound) => {
      const at = resample(sound, rate);
      samples += at.samples.length;
      await sink.write(toPcm16(at));
    };
    const now = () => (samples / rate) * 1000;
    const cues: Cue[] = [];
    await write(silence(ROOM.headMs, rate));
    const lines = script.lines.filter((line) => line.chapter === chapter.number);
    let gapAfterLast = 0;
    for (const line of lines) {
      const job = jobs.get(line.id);
      const cue: Cue = {
        id: line.id,
        kind: line.kind,
        speaker: line.speaker,
        direction: line.direction,
        text: line.text,
        startMs: 0,
        durationMs: 0,
        from: line.from,
        line: line.line,
      };
      // A character's sound voiced with their words: placed once those words are (below).
      if (!job && line.kind === "vocal" && line.with) {
        cues.push(cue);
        continue;
      }
      if (!job) continue;
      if (gapAfterLast) await write(silence(gapAfterLast, rate));
      cue.startMs = now();
      if (job.kind === "silence") {
        await write(silence(job.ms, rate));
      } else {
        const parts = clips.get(line.id) ?? [];
        const words: WordTime[] = [];
        let offset = 0;
        for (const part of parts) {
          const sound = await toSound(part);
          const isVoice = job.kind !== "sound";
          const cut = isVoice ? trimmed(sound) : { sound, from: 0 };
          const level = isVoice ? LEVEL.voice : line.kind === "page" ? LEVEL.page : LEVEL.sound;
          const ready = leveled(cut.sound, level);
          const shift = offset - (cut.from / sound.rate) * 1000;
          for (const word of part.words ?? [])
            words.push({
              text: word.text,
              startMs: Math.max(0, Math.round(word.startMs + shift)),
              endMs: Math.max(0, Math.round(word.endMs + shift)),
            });
          await write(ready);
          offset += lengthMs(ready);
        }
        if (words.length) cue.words = words;
        if (job.kind === "speak")
          cue.sent = [job.request.before, job.request.text, job.request.after]
            .filter(Boolean)
            .join(" ");
      }
      cue.durationMs = now() - cue.startMs;
      cues.push(cue);
      gapAfterLast = GAPS[line.next];
    }
    // A character's sound voiced with their words is heard at the edge of them.
    for (const cue of cues) {
      const line = lines.find((other) => other.id === cue.id);
      if (!line?.with || jobs.has(cue.id)) continue;
      const host = cues.find((other) => other.id === line.with);
      if (!host) continue;
      const words = host.words ?? [];
      if (line.from < host.from) {
        cue.startMs = host.startMs;
        cue.durationMs = words[0] ? words[0].startMs : 0;
      } else {
        const end = words.at(-1)?.endMs;
        cue.startMs = end !== undefined ? host.startMs + end : host.startMs + host.durationMs;
        cue.durationMs = end !== undefined ? Math.max(0, host.durationMs - end) : 0;
      }
    }
    await write(silence(ROOM.tailMs, rate));
    await sink.close();
    made.push({
      number: chapter.number,
      title: chapter.title,
      durationMs: Math.round(now()),
      rate,
      cues: cues.map((cue) => ({
        ...cue,
        startMs: Math.round(cue.startMs),
        durationMs: Math.round(cue.durationMs),
      })),
    });
  }
  return { chapters: made, requests, fromStore, characters, left };
}

/** What a production would cost and send, without making anything: for a writer to agree to. */
export function estimate(
  script: ProductionScript,
  options: Pick<ProduceOptions, "adapter" | "voices" | "sounds" | "chapters">,
): { characters: number; requests: number; costUsd?: number; left: Left } {
  let characters = 0;
  let requests = 0;
  const left: Left = { sounds: 0, vocals: 0, directions: 0 };
  for (const chapter of script.chapters) {
    if (options.chapters && !options.chapters.includes(chapter.number)) continue;
    const planned = plan(script, chapter.number, options);
    characters += planned.characters;
    for (const job of planned.jobs.values())
      requests += job.kind === "speak-parts" ? job.parts.length : job.kind === "silence" ? 0 : 1;
    left.sounds += planned.left.sounds;
    left.vocals += planned.left.vocals;
    left.directions += planned.left.directions;
  }
  const cost = options.adapter.cost?.(characters);
  return {
    characters,
    requests,
    ...(cost !== undefined ? { costUsd: Math.round(cost * 100) / 100 } : {}),
    left,
  };
}
