/**
 * What a voice service needs to be to make an audiobook from a VoxDown story: an adapter. It
 * lists its voices, and turns one stretch of text, in one voice, said one way, into sound. Every
 * thing else (which lines to send, the silence between them, joining them into chapters, how loud
 * they are, the files at the end) is done the same way for every service, so an adapter is small:
 * see adapters/openai-speech.ts for one in about a hundred lines.
 *
 * An adapter only uses `fetch`, so it runs in Node and, for services that allow it, in a browser.
 * Keys are given to it; it never looks for them itself.
 */

/** A voice a service offers. */
export type Voice = {
  /** What the service calls it in a request. */
  id: string;
  /** As a person knows it. */
  name: string;
  /** Words about it: gender, age, accent, what it suits (from the service, if it says). */
  description?: string;
  gender?: "female" | "male" | "neutral";
  /** A language tag, such as `en-GB`, if the service says. */
  language?: string;
  /** A sample to listen to. */
  preview?: string;
  /** How good the service says it is, from 0 to 1, where it says. */
  quality?: number;
};

/** A stretch of words to say, in one voice. */
export type SpeakRequest = {
  text: string;
  voice: string;
  /** How it is said, in the writer's words: `softly`, `with a sigh`. */
  direction: string | null;
  /** A character's sounds beside the words, before and after them (`[laughs]`). */
  before?: string;
  after?: string;
  /** The story's language, such as `en-GB`. */
  language?: string;
  /** What is said just before and after, by anyone, so the voice keeps the flow. */
  previous?: string;
  next?: string;
  /** The request ids of the clips just before, where the service can carry on from them. */
  previousRequests?: string[];
  signal?: AbortSignal;
};

/** When a word was said, from the start of its clip. */
export type WordTime = { text: string; startMs: number; endMs: number };

/** The sound a request made. */
export type Clip = {
  /** 16-bit mono PCM, a WAV file, or something else (MP3) that only Node can turn into PCM. */
  audio: Uint8Array;
  format: "pcm16" | "wav" | "mp3";
  /** For PCM: samples a second. */
  rate?: number;
  /** When each word was said, if the service says. */
  words?: WordTime[];
  /** The service's id for the request, for carrying on from it. */
  requestId?: string;
};

/** What a service can do, so the lines sent to it are cut and worded right. */
export type Capabilities = {
  /** The most characters one request may hold. */
  maxCharacters: number;
  /** How a direction reaches the voice: as a tag in the text, as instructions, as a style, or not. */
  directions: "tags" | "instructions" | "styles" | "none";
  /** Whether a character's sounds (`[laughs]`) can be voiced with their words. */
  vocalTags: boolean;
  /** Whether it can make sound effects. */
  sounds: boolean;
  /** When words are said: per word, or not at all. */
  timings: "words" | "none";
  /** How many requests may run at once. */
  concurrency: number;
};

/** A voice service, ready to be asked. */
export interface Adapter {
  /** `elevenlabs`, `openai-speech`, `azure`, or a package's own. */
  readonly id: string;
  /** As a person knows it. */
  readonly name: string;
  /** The model, or the settings that decide the sound, for the clip cache. */
  readonly model: string;
  readonly capabilities: Capabilities;
  voices(): Promise<Voice[]>;
  speak(request: SpeakRequest): Promise<Clip>;
  /** A sound effect, `seconds` long, from its description. */
  sound?(request: { description: string; seconds: number; signal?: AbortSignal }): Promise<Clip>;
  /** What a request of so many characters costs, in US dollars, if known. */
  cost?(characters: number): number;
}

/** A service's answer that went wrong, said in a writer's terms. */
export class AdapterError extends Error {
  constructor(
    message: string,
    /** Whether trying again later may work (busy, rate limited, a network failure). */
    readonly retry = false,
  ) {
    super(message);
  }
}

/** A response that failed, as an AdapterError: what the service said, and whether to try again. */
export async function failure(service: string, response: Response): Promise<AdapterError> {
  let said = "";
  try {
    said = (await response.text()).slice(0, 400);
  } catch {}
  const status = response.status;
  if (status === 401 || status === 403)
    return new AdapterError(`${service} didn't accept the key (${status}): ${said}`);
  if (status === 429)
    return new AdapterError(
      `${service} is busy or the plan's limit is reached (429): ${said}`,
      true,
    );
  if (status >= 500) return new AdapterError(`${service} had a problem (${status}): ${said}`, true);
  return new AdapterError(`${service} answered ${status}: ${said}`);
}

/** Base64 to bytes, in Node and browsers alike. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
