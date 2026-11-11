# @voxdown/produce

Make a [VoxDown](https://voxdown.github.io/) story into an audiobook with the voice service you choose: each character in a voice of their own, directions followed where the service can, the same pacing whatever the service, and chapters as WAV, MP3 and M4B.

```sh
npm install @voxdown/produce voxdown
```

Most people use it through the command, `npx -y @voxdown/cli produce story.vxd`; [docs/produce.md](https://github.com/voxdown/voxdown/blob/main/docs/produce.md) explains it.

```ts
import { parse } from "voxdown";
import { elevenlabs, productionScript, produce } from "@voxdown/produce";
import { folderStore, wavFile } from "@voxdown/produce/node";

const script = productionScript(parse(text));
const made = await produce(script, {
  adapter: elevenlabs({ key: process.env.ELEVENLABS_API_KEY! }),
  voices: { Narrator: "JBFqnCBsd6RMkjVDRZzb", Mother: "XrExE9yKIg1WjnnlVkGX" },
  store: folderStore(".clips"),
  output: (chapter) => wavFile(`chapter-${chapter.number}.wav`, 24000),
});
// made.chapters[i].cues: when each line, and each word, is heard.
```

- `productionScript(story)`: everything heard, as plain data (ids, chapters, scenes, pauses, what follows each line).
- Adapters: `elevenlabs`, `openaiSpeech` (OpenAI-compatible servers: Kokoro, LocalAI, vLLM-Omni, OpenAI; see `PRESETS`) and `azure`. Writing your own takes one function: see [Writing an adapter](https://github.com/voxdown/voxdown/blob/main/docs/produce.md#writing-an-adapter).
- `estimate(script, …)`: characters, requests and cost, before anything is made.
- `castVoices(people, voices)`: a first casting, a voice for each character.
- `chapterSsml(script, chapter, voices)`: a chapter as SSML, for tools that take it.
- `@voxdown/produce/node`: clips kept on disk (`folderStore`), chapters as WAV (`wavFile`), and with ffmpeg, MP3 chapters (`chapterMp3`) and an M4B with its chapters marked (`bookM4b`).

The core (`productionScript`, the adapters, `produce`) only uses `fetch`, so it runs in browsers too.

## License

MIT
