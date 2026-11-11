/**
 * OpenAI-compatible speech (`POST /v1/audio/speech`): the shape most local speech servers now
 * take, so one adapter reaches many engines. Kokoro-FastAPI (Kokoro, free, on a CPU), speaches,
 * LocalAI, vLLM-Omni and SGLang-Omni (Qwen3-TTS, VoxCPM2, Higgs and more), and OpenAI itself. A
 * direction goes as `instructions` where the server takes them.
 */
import { type Adapter, AdapterError, type Clip, type Voice, failure } from "../adapter";

export type OpenAiSpeechOptions = {
  /** The server, such as `http://127.0.0.1:8880` for Kokoro-FastAPI. */
  base: string;
  model: string;
  key?: string;
  /** Whether the server follows `instructions` (OpenAI's gpt-4o-mini-tts, LocalAI for some engines). */
  instructions?: boolean;
  /** The voices, where the server can't list them. */
  voices?: readonly string[];
  /** As a person knows it. */
  name?: string;
  /** The id shown and kept in the casting file. Default `openai-speech`. */
  id?: string;
  maxCharacters?: number;
  concurrency?: number;
  /** US dollars a million characters, if it costs anything. */
  pricePerMillion?: number;
  fetch?: typeof fetch;
};

/** A ready-made server: its address, model and what it can do. */
export const PRESETS = {
  /** Kokoro-FastAPI: `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`. Free. */
  kokoro: {
    id: "kokoro",
    name: "Kokoro",
    base: "http://127.0.0.1:8880",
    model: "kokoro",
    instructions: false,
    maxCharacters: 4_000,
    concurrency: 2,
  },
  /** OpenAI's own speech: its models are retired on 6 January 2027. */
  openai: {
    id: "openai",
    name: "OpenAI",
    base: "https://api.openai.com",
    model: "gpt-4o-mini-tts",
    instructions: true,
    maxCharacters: 4_000,
    concurrency: 4,
    pricePerMillion: 15,
    voices: [
      "alloy",
      "ash",
      "ballad",
      "cedar",
      "coral",
      "echo",
      "fable",
      "marin",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
    ],
  },
  /** LocalAI, on its usual port: the model is the one it is set up to serve. */
  localai: {
    id: "localai",
    name: "LocalAI",
    base: "http://127.0.0.1:8080",
    model: "tts-1",
    instructions: true,
    maxCharacters: 4_000,
    concurrency: 1,
  },
} satisfies Record<string, Omit<OpenAiSpeechOptions, "fetch">>;

/** Kokoro's voice names say their language and gender: `bf_emma` is a British English woman. */
function kokoroVoice(id: string): Voice {
  const languages: Record<string, string> = {
    a: "en-US",
    b: "en-GB",
    e: "es",
    f: "fr",
    h: "hi",
    i: "it",
    j: "ja",
    p: "pt-BR",
    z: "zh",
  };
  const match = /^([a-z])([fm])_(.+)$/.exec(id);
  if (!match) return { id, name: id };
  const [, language = "", gender, name = id] = match;
  return {
    id,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    gender: gender === "f" ? "female" : "male",
    ...(languages[language] ? { language: languages[language] } : {}),
    description: `${gender === "f" ? "female" : "male"}, ${languages[language] ?? language}`,
  };
}

/** A school grade (`A-`, `C+`) as a quality from 0 to 1. */
function gradeQuality(grade: string): number | undefined {
  const match = /^([A-F])([+-])?$/.exec(grade.trim().toUpperCase());
  if (!match) return undefined;
  const base = { A: 4, B: 3, C: 2, D: 1, E: 0.5, F: 0 }[match[1] as "A"] ?? 0;
  const step = match[2] === "+" ? 0.3 : match[2] === "-" ? -0.3 : 0;
  return Math.max(0, Math.min(1, (base + step) / 4.3));
}

/** How a direction is put to a voice that takes instructions. */
export const instructionsFor = (direction: string) =>
  `Say this ${direction.replace(/[.!]+$/, "")}.`;

export function openaiSpeech(options: OpenAiSpeechOptions): Adapter {
  const base = options.base.replace(/\/$/, "").replace(/\/v1$/, "");
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const name = options.name ?? "OpenAI-compatible speech";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
  };
  return {
    id: options.id ?? "openai-speech",
    name,
    model: options.model,
    capabilities: {
      maxCharacters: options.maxCharacters ?? 4_000,
      directions: options.instructions ? "instructions" : "none",
      vocalTags: false,
      sounds: false,
      timings: "none",
      concurrency: options.concurrency ?? 2,
    },
    async voices() {
      if (options.voices) return options.voices.map((id) => kokoroVoice(id));
      // Kokoro-FastAPI and others list them here; a server that doesn't must be given them.
      const response = await call(`${base}/v1/audio/voices`, { headers });
      if (!response.ok)
        throw new AdapterError(
          `${name} at ${base} didn't list its voices (${response.status}): name them in the casting file`,
        );
      const data = (await response.json()) as {
        voices?: Array<string | { id?: string; name?: string; overall_grade?: string }>;
      };
      return (data.voices ?? []).flatMap((voice) => {
        const id = typeof voice === "string" ? voice : (voice.id ?? voice.name ?? "");
        if (!id) return [];
        const found = kokoroVoice(id);
        // Kokoro grades its voices, A to F.
        const grade = typeof voice === "string" ? undefined : voice.overall_grade;
        const quality = grade ? gradeQuality(grade) : undefined;
        return [
          {
            ...found,
            ...(quality !== undefined ? { quality } : {}),
            ...(grade
              ? { description: `${found.description ?? ""}, grade ${grade}`.replace(/^, /, "") }
              : {}),
          },
        ];
      });
    },
    async speak(request): Promise<Clip> {
      let response: Response;
      try {
        response = await call(`${base}/v1/audio/speech`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: options.model,
            input: request.text,
            voice: request.voice,
            response_format: "wav",
            ...(options.instructions && request.direction
              ? { instructions: instructionsFor(request.direction) }
              : {}),
          }),
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        throw new AdapterError(
          `${name} at ${base} can't be reached: is it running? (${(error as Error).message})`,
          true,
        );
      }
      if (!response.ok) throw await failure(name, response);
      return { audio: new Uint8Array(await response.arrayBuffer()), format: "wav" };
    },
    ...(options.pricePerMillion !== undefined
      ? {
          cost: (characters: number) =>
            (characters / 1_000_000) * (options.pricePerMillion as number),
        }
      : { cost: () => 0 }),
  };
}
