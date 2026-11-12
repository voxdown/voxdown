# Making an audiobook

`vxd produce` reads a VoxDown story aloud with a voice service you have, each character in a voice of their own, and makes an audiobook: an **M4B** file with its chapters marked (what audiobook players take), an **MP3 a chapter** (what audiobook stores take), and when each line is heard.

```sh
npx -y @voxdown/cli produce story.vxd --dry-run
npx -y @voxdown/cli produce story.vxd
```

It needs [Node.js](https://nodejs.org) 20 or later, and [ffmpeg](https://ffmpeg.org) for MP3 and M4B (without it, each chapter is a WAV file). In the Writer, **File › Make an audiobook…** does the same, once `npx -y @voxdown/cli connect` runs on your computer ([how](ai.md#in-the-writer-vxd-connect)).

## Voice services

| Service | How it's found | Cost (list price, November 2026) | Notes |
| --- | --- | --- | --- |
| [ElevenLabs](https://elevenlabs.io) | `ELEVENLABS_API_KEY` | about $0.08 a thousand characters (a 100,000-word book: about $48), less on a plan | Directions and the sounds characters make go as audio tags (`[softly]`, `[laughs]`) on `eleven_v4` and `eleven_v3`. Every word's time is known. `--sounds` makes sounds and page turns with its sound effects. |
| [Kokoro](https://github.com/remsky/Kokoro-FastAPI), on your computer | running on port 8880 (or `KOKORO_URL`) | free | `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu` runs it on an ordinary CPU. Many voices, no acting: directions are left out. |
| [Azure AI Speech](https://learn.microsoft.com/azure/ai-services/speech-service/) | `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` | about $15 a million characters | Directions become the nearest of Azure's speaking styles (`whispering`, `sad`, `cheerful`…) on voices that have them. |
| OpenAI | `OPENAI_API_KEY` | about $15 a million characters | Directions go as instructions. OpenAI retires these voices on 6 January 2027. |
| Any OpenAI-compatible speech server | `--with http://host:port --model name` | — | LocalAI, speaches, vLLM-Omni and SGLang-Omni serve Qwen3-TTS, VoxCPM2 and other open models this way. |

With several, `vxd produce` asks which; `--with elevenlabs` chooses. Sound effects and directions a service can't take are left out, and counted, so you know.

## Where your story goes

Only to the voice service you choose, and only when you make an audiobook: VoxDown itself sends nothing anywhere.

- **A voice engine on your computer** (Kokoro, or another OpenAI-compatible server you run) keeps everything there.
- **A voice service online** (ElevenLabs, Azure, OpenAI) is sent the lines to be read, from your computer, with your own key. What it does with them is up to its terms, as when you use it yourself.
- **VoxDown has no server and no account.** In the Writer, the story goes from the page to `vxd connect` on your own computer, and from there only to the service you choose. Your keys stay in your computer's settings, and VoxDown never sees them, or your story.

## Casting

The first run writes `casting.json` in the output folder: a voice for each character, chosen from the service's voices (the narrator a storyteller's where there is one, each character a voice of their own, of the gender the cast's words suggest). Change any voice there, by its name or its id, and run again. `--dry-run` shows the casting and what the book would cost, and makes nothing.

In the Writer, **File › Make an audiobook…** shows the casting to change: choose another of the service's voices for anyone, and **Listen** to hear their first words in it (a sentence or two, at the service's price; free with a voice engine on your computer). The voices you choose are kept in `casting.json` when the cost is counted again or the book is made.

```json
{
  "elevenlabs": { "Narrator": "George", "Mara": "Lily", "Tom": "Bill" }
}
```

## What it makes

In `story.audiobook/`, beside the story (or `--out`):

| File | What it is |
| --- | --- |
| `the-title.m4b` | The book, its chapters marked, with its title and author. |
| `chapters/01-one.mp3` … | A chapter a file: 192 kbps, 44.1 kHz, mono, about -20 dB, with silence at the start and end, as audiobook stores ask. |
| `timings/01-one.json` … | When each line is heard, and each word where the service says. |
| `script.json` | The production script (below). |
| `casting.json` | The voices. |
| `about.json` | Which service, model and voices made it, and a line saying it is narrated by synthetic voices. |
| `.clips/` | Every line made, kept: making the book again only asks for lines that changed. |

Its chapters are the story's headings of the highest level used at least twice, as the Writer's and the ebook's are ([SPEC.md](../spec/SPEC.md), §4.4): `#` chapters with the title in the front matter, or `##` chapters under a single `# Title`. What comes before the first chapter, the title read aloud with it, is a chapter of its own, named by the title. A story with no level used twice is one chapter.

**ElevenLabs Studio.** `vxd produce story.vxd --with elevenlabs --studio` makes nothing here: it sends the book to [ElevenLabs Studio](https://elevenlabs.io/docs/product-guides/products/studio) as a new project, each chapter a chapter, each paragraph a block and each line in its character's voice (directions as audio tags). You listen, change and convert it there, and nothing is converted, or paid for, until you do. From Studio a book can be published where only books made in ElevenLabs are taken.

`--chapters 1` makes one chapter to listen to first. `--script-only` writes the production script and an SSML file a chapter, with no service, for other tools.

**Where an AI-narrated book can go.** Google Play Books, Kobo and Spotify for Authors take audiobooks narrated by synthetic voices, each with a label saying so. ACX (Audible) takes only human narration. Each store's terms change; check them before you publish.

## The production script

`script.json` is plain data, so a tool that knows nothing of VoxDown can make an audiobook from it:

```json
{
  "format": "voxdown-production/1",
  "title": "The Owl",
  "narrator": "Narrator",
  "chapters": [{ "number": 1, "title": "One", "first": "c01-l0001", "last": "c01-l0009" }],
  "lines": [
    {
      "id": "c01-l0004", "hash": "9a1f…", "chapter": 1, "scene": 1, "page": "1",
      "kind": "speech", "speaker": "Mara", "direction": "softly", "text": "Who’s there?",
      "next": "part", "from": 120, "line": 14, "column": 1
    }
  ]
}
```

- `kind` is `speech`, `vocal` (a sound a character makes), `sound`, `pause` (with `ms`) or `page`.
- `next` says what follows the line: `part` (more on its line), `line`, `paragraph`, `heading`, `scene`, `chapter` or `end`. The silence after it is set by that: 250, 450, 800, 1,100 and 1,500 ms.
- `id` stays the same while the story is edited elsewhere in its chapter; `hash` changes only when what the line sounds like does.
- A character's sound beside their own words has `with`: the id of the speech it is voiced with.

## Writing an adapter

An adapter connects one voice service. It lists the voices, and turns one line into sound; [`@voxdown/produce`](../packages/produce) does everything else the same way for every service: what to send, the silence between lines, joining chapters, loudness, the files. The [OpenAI-compatible adapter](../packages/produce/src/adapters/openai-speech.ts) is about a hundred lines.

```ts
import { type Adapter, failure, produce, productionScript } from "@voxdown/produce";

export function myService(key: string): Adapter {
  return {
    id: "my-service",
    name: "My Service",
    model: "v1",
    capabilities: {
      maxCharacters: 5000,
      directions: "instructions", // or "tags", "styles", "none"
      vocalTags: false,
      sounds: false,
      timings: "none",
      concurrency: 2,
    },
    async voices() {
      return [{ id: "anna", name: "Anna", gender: "female", language: "en-GB" }];
    },
    async speak({ text, voice, direction }) {
      const response = await fetch("https://api.example.com/speak", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify({ text, voice, style: direction }),
      });
      if (!response.ok) throw await failure("My Service", response);
      return { audio: new Uint8Array(await response.arrayBuffer()), format: "wav" };
    },
  };
}
```

`speak` returns 16-bit PCM (with its rate), a WAV file, or an MP3 (which Node turns into PCM with ffmpeg). Return `words` when the service says when each word was said, and throw `AdapterError` with `retry` set when trying again later may work (busy, rate limited). Then:

```ts
import { folderStore, wavFile } from "@voxdown/produce/node";

const made = await produce(productionScript(parse(text)), {
  adapter: myService(process.env.MY_KEY!),
  voices: { Narrator: "anna", Mara: "lena" },
  store: folderStore(".clips"),
  output: (chapter) => wavFile(`chapter-${chapter.number}.wav`, 24000),
});
```

Publish it as `voxdown-voice-<service>` on npm, so it's easy to find.
