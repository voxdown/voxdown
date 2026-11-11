/**
 * ElevenLabs: each line in its character's voice with `with-timestamps` (so every word's time is
 * known), the direction and the character's own sounds as audio tags on the models that take them
 * (`[softly] Come here. [laughs]`), the lines around it sent for flow, and sound effects from
 * their descriptions. Audio comes back as 24 kHz PCM, which every plan can ask for.
 *
 * API: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
 */
import {
  type Adapter,
  AdapterError,
  type Clip,
  type SpeakRequest,
  type Voice,
  type WordTime,
  failure,
  fromBase64,
} from "../adapter";

export type ElevenLabsOptions = {
  key: string;
  /** `eleven_v4` (the default), `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`… */
  model?: string;
  /** Another region's host, such as `https://api.eu.residency.elevenlabs.io`. */
  base?: string;
  /** Requests at once: the plan's limit (Starter 3, Creator 5, Pro 10). Default 3. */
  concurrency?: number;
  fetch?: typeof fetch;
};

/** The longest text each model takes in one request. */
const LIMITS: Record<string, number> = {
  eleven_v4: 10_000,
  eleven_v3: 5_000,
  eleven_multilingual_v2: 10_000,
  eleven_flash_v2_5: 40_000,
};

/** Models that read `[tags]` as how to say it, not as words. */
const TAGGED = /^eleven_v[34]/;

const RATE = 24_000;

/** When each word was said, from ElevenLabs' times for each character, for the words at `from`–`to`. */
export function wordsFromAlignment(
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  },
  from = 0,
  to = alignment.characters.length,
): WordTime[] {
  const words: WordTime[] = [];
  let current: WordTime | undefined;
  for (let index = from; index < Math.min(to, alignment.characters.length); index++) {
    const char = alignment.characters[index] ?? "";
    const start = (alignment.character_start_times_seconds[index] ?? 0) * 1000;
    const end = (alignment.character_end_times_seconds[index] ?? 0) * 1000;
    if (/\s/.test(char)) {
      current = undefined;
      continue;
    }
    if (!current) {
      current = { text: "", startMs: start, endMs: end };
      words.push(current);
    }
    current.text += char;
    current.endMs = end;
  }
  return words.map((word) => ({
    text: word.text,
    startMs: Math.round(word.startMs),
    endMs: Math.round(word.endMs),
  }));
}

export function elevenlabs(options: ElevenLabsOptions): Adapter {
  const model = options.model ?? "eleven_v4";
  const base = (options.base ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const tagged = TAGGED.test(model);
  const headers = { "xi-api-key": options.key, "content-type": "application/json" };
  const name = "ElevenLabs";
  return {
    id: "elevenlabs",
    name,
    model,
    capabilities: {
      maxCharacters: LIMITS[model] ?? 5_000,
      directions: tagged ? "tags" : "none",
      vocalTags: tagged,
      sounds: true,
      timings: "words",
      concurrency: options.concurrency ?? 3,
    },
    async voices() {
      const voices: Voice[] = [];
      let token = "";
      do {
        const page = token ? `&next_page_token=${encodeURIComponent(token)}` : "";
        const response = await call(`${base}/v2/voices?page_size=100${page}`, { headers });
        if (!response.ok) throw await failure(name, response);
        const data = (await response.json()) as {
          voices: Array<{
            voice_id: string;
            name: string;
            description?: string | null;
            labels?: Record<string, string>;
            preview_url?: string | null;
          }>;
          has_more?: boolean;
          next_page_token?: string | null;
        };
        for (const voice of data.voices) {
          const labels = voice.labels ?? {};
          const gender = labels.gender?.toLowerCase();
          const about = [
            labels.gender,
            labels.age,
            labels.accent,
            labels.descriptive ?? labels.description,
            labels.use_case,
            voice.description,
          ]
            .filter(Boolean)
            .join(", ");
          voices.push({
            id: voice.voice_id,
            name: voice.name,
            ...(about ? { description: about } : {}),
            ...(gender === "female" || gender === "male" || gender === "neutral" ? { gender } : {}),
            ...(labels.language ? { language: labels.language } : {}),
            ...(voice.preview_url ? { preview: voice.preview_url } : {}),
          });
        }
        token = data.has_more && data.next_page_token ? data.next_page_token : "";
      } while (token);
      return voices;
    },
    async speak(request: SpeakRequest): Promise<Clip> {
      const tag = (text: string) => `[${text.replace(/[[\]]/g, "")}]`;
      const lead = [
        request.before ? tag(request.before) : "",
        tagged && request.direction ? tag(request.direction) : "",
      ]
        .filter(Boolean)
        .join(" ");
      const text = [lead, request.text, request.after ? tag(request.after) : ""]
        .filter(Boolean)
        .join(" ");
      const wordsFrom = lead ? lead.length + 1 : 0;
      const language = request.language?.slice(0, 2).toLowerCase();
      const body = {
        text,
        model_id: model,
        ...(language && model !== "eleven_multilingual_v2" ? { language_code: language } : {}),
        ...(request.previous ? { previous_text: request.previous.slice(-500) } : {}),
        ...(request.next ? { next_text: request.next.slice(0, 500) } : {}),
        ...(request.previousRequests?.length && model !== "eleven_v3"
          ? { previous_request_ids: request.previousRequests.slice(-3) }
          : {}),
      };
      const response = await call(
        `${base}/v1/text-to-speech/${encodeURIComponent(request.voice)}/with-timestamps?output_format=pcm_${RATE}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          ...(request.signal ? { signal: request.signal } : {}),
        },
      );
      if (!response.ok) throw await failure(name, response);
      const data = (await response.json()) as {
        audio_base64?: string;
        alignment?: Parameters<typeof wordsFromAlignment>[0] | null;
      };
      if (!data.audio_base64) throw new AdapterError(`${name} sent no sound`);
      const requestId = response.headers.get("request-id") ?? response.headers.get("x-request-id");
      return {
        audio: fromBase64(data.audio_base64),
        format: "pcm16",
        rate: RATE,
        ...(data.alignment
          ? {
              words: wordsFromAlignment(data.alignment, wordsFrom, wordsFrom + request.text.length),
            }
          : {}),
        ...(requestId ? { requestId } : {}),
      };
    },
    async sound(request) {
      const response = await call(`${base}/v1/sound-generation?output_format=pcm_${RATE}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: request.description, duration_seconds: request.seconds }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!response.ok) throw await failure(name, response);
      return { audio: new Uint8Array(await response.arrayBuffer()), format: "pcm16", rate: RATE };
    },
    cost(characters) {
      // Pay-as-you-go list prices, November 2026: Flash and Turbo cost half.
      return (characters / 1000) * (/flash|turbo/.test(model) ? 0.04 : 0.08);
    },
  };
}
