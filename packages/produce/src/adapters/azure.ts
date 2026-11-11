/**
 * Azure AI Speech: each line as SSML, in its voice, its direction as the nearest of Azure's
 * speaking styles (`whispering`, `sad`, `cheerful`…) on the voices that have them. Hundreds of
 * voices in many languages; the SSML reference among the adapters.
 *
 * API: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 */
import { type Adapter, type Clip, type Voice, failure } from "../adapter";
import { ssmlDocument } from "../ssml";

export type AzureOptions = {
  key: string;
  /** The Speech resource's region, such as `westeurope` or `eastus`. */
  region: string;
  concurrency?: number;
  fetch?: typeof fetch;
};

export function azure(options: AzureOptions): Adapter {
  const host = `https://${options.region}.tts.speech.microsoft.com`;
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const name = "Azure AI Speech";
  return {
    id: "azure",
    name,
    model: "neural",
    capabilities: {
      maxCharacters: 3_000,
      directions: "styles",
      vocalTags: false,
      sounds: false,
      timings: "none",
      concurrency: options.concurrency ?? 4,
    },
    async voices() {
      const response = await call(`${host}/cognitiveservices/voices/list`, {
        headers: { "Ocp-Apim-Subscription-Key": options.key },
      });
      if (!response.ok) throw await failure(name, response);
      const list = (await response.json()) as Array<{
        ShortName: string;
        DisplayName?: string;
        LocalName?: string;
        Gender?: string;
        Locale?: string;
        StyleList?: string[];
        VoiceType?: string;
      }>;
      return list.map((voice): Voice => {
        const gender = voice.Gender?.toLowerCase();
        return {
          id: voice.ShortName,
          name: voice.DisplayName ?? voice.ShortName,
          ...(gender === "female" || gender === "male" || gender === "neutral" ? { gender } : {}),
          ...(voice.Locale ? { language: voice.Locale } : {}),
          description: [
            voice.Gender,
            voice.Locale,
            voice.StyleList?.length ? `styles: ${voice.StyleList.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(", "),
        };
      });
    },
    async speak(request): Promise<Clip> {
      const language = request.language ?? /^[a-z]{2}-[A-Z]{2}/.exec(request.voice)?.[0] ?? "en-US";
      const response = await call(`${host}/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": options.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
          "User-Agent": "voxdown",
        },
        body: ssmlDocument(request.voice, request.text, request.direction, language),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!response.ok) throw await failure(name, response);
      return { audio: new Uint8Array(await response.arrayBuffer()), format: "wav" };
    },
    // Neural voices, list price: $15 a million characters (HD voices $22).
    cost: (characters) => (characters / 1_000_000) * 15,
  };
}
