import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import {
  type Adapter,
  type Clip,
  type SpeakRequest,
  azure,
  castVoices,
  chapterSsml,
  elevenlabs,
  estimate,
  fromWav,
  genderOf,
  leveled,
  loudness,
  memoryStore,
  openaiSpeech,
  pieces,
  produce,
  productionScript,
  resample,
  silence,
  speakersOf,
  styleFor,
  toPcm16,
  toWav,
  trimmed,
  voiceId,
} from "../src/index";
import { bookM4b, chaptersOf, folderStore, hasFfmpeg, wavFile } from "../src/node";

const root = join(import.meta.dirname, "..", "..", "..");
const ffmpegHere = await hasFfmpeg();
const peter = readFileSync(join(root, "examples", "peter-rabbit.vxd"), "utf8");

const STORY = `---
title: The Owl
author: A. Teller
language: en-GB
cast:
  Mara: Mara Stone, a fisherwoman
  Tom:
    name: Tom Hale
    about: An old ferryman, gruff.
---

# One

Night fell. {pause 2s}

@Mara (softly) “Who’s there?” @Mara [gasps]

@Tom “Only me.” [door creaks]

* * *

{page} The next day.

# Two

@Tom [laughs] “Again!”
`;

describe("the production script", () => {
  const script = productionScript(parse(STORY));

  it("lists what is heard, by chapter, with ids, scenes, pauses and what follows each", () => {
    expect(script).toMatchObject({
      format: "voxdown-production/1",
      title: "The Owl",
      author: "A. Teller",
      language: "en-GB",
      narrator: "Narrator",
    });
    expect(script.chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    const brief = script.lines.map((line) => [
      line.id,
      line.kind,
      line.speaker,
      line.direction,
      line.text,
      line.next,
      line.scene,
    ]);
    expect(brief).toEqual([
      // A heading starts a scene, and belongs to it.
      ["c01-l0001", "speech", "Narrator", null, "One", "heading", 1],
      ["c01-l0002", "speech", "Narrator", null, "Night fell.", "part", 1],
      ["c01-l0003", "pause", null, null, "", "paragraph", 1],
      ["c01-l0004", "speech", "Mara", "softly", "Who’s there?", "part", 1],
      ["c01-l0005", "vocal", "Mara", null, "gasps", "paragraph", 1],
      ["c01-l0006", "speech", "Tom", null, "Only me.", "part", 1],
      ["c01-l0007", "sound", null, null, "door creaks", "scene", 1],
      ["c01-l0008", "page", null, null, "", "part", 2],
      ["c01-l0009", "speech", "Narrator", null, "The next day.", "chapter", 2],
      ["c02-l0001", "speech", "Narrator", null, "Two", "heading", 3],
      ["c02-l0002", "vocal", "Tom", null, "laughs", "part", 3],
      ["c02-l0003", "speech", "Tom", null, "Again!", "end", 3],
    ]);
    expect(script.lines[2]?.ms).toBe(2000);
    expect(script.lines[0]?.heading).toBe(1);
    // A character's sound beside their words is voiced with them.
    expect(script.lines[4]?.with).toBe("c01-l0004");
    expect(script.lines[10]?.with).toBe("c02-l0003");
    expect(script.lines[8]?.page).toBe("2");
  });

  it("keeps a line's id and hash while the story changes elsewhere", () => {
    const edited = productionScript(parse(STORY.replace("Night fell.", "Night fell, slowly.")));
    const before = script.lines.find((line) => line.text === "Only me.");
    const after = edited.lines.find((line) => line.text === "Only me.");
    expect(after?.id).toBe(before?.id);
    expect(after?.hash).toBe(before?.hash);
    expect(edited.lines[1]?.hash).not.toBe(script.lines[1]?.hash);
  });

  it("is a whole chapter when the story has no chapter headings", () => {
    const one = productionScript(parse(peter));
    expect(one.chapters.length).toBe(1);
    expect(one.lines.every((line) => line.chapter === 1)).toBe(true);
    expect(one.lines.some((line) => line.speaker === "Mother")).toBe(true);
  });
});

describe("sound", () => {
  const tone = (ms: number, level = 0.5, rate = 24000) => {
    const samples = new Float32Array(Math.round((ms / 1000) * rate));
    for (let index = 0; index < samples.length; index++)
      samples[index] = level * Math.sin((2 * Math.PI * 220 * index) / rate);
    return { samples, rate };
  };

  it("goes to WAV and back", () => {
    const sound = tone(100);
    const back = fromWav(toWav(sound));
    expect(back.rate).toBe(24000);
    expect(back.samples.length).toBe(sound.samples.length);
    expect(Math.abs((back.samples[100] as number) - (sound.samples[100] as number))).toBeLessThan(
      1e-4,
    );
    expect(toPcm16(sound).length).toBe(sound.samples.length * 2);
  });

  it("has its quiet edges trimmed, keeping a little air", () => {
    const padded = {
      samples: new Float32Array([
        ...silence(300, 24000).samples,
        ...tone(200).samples,
        ...silence(300, 24000).samples,
      ]),
      rate: 24000,
    };
    const cut = trimmed(padded);
    expect(cut.sound.samples.length / 24).toBeGreaterThan(200);
    expect(cut.sound.samples.length / 24).toBeLessThan(260);
  });

  it("is brought to a loudness, its peaks held", () => {
    expect(loudness(leveled(tone(500, 0.05), -20))).toBeCloseTo(-20, 0);
    expect(loudness(silence(100, 24000))).toBe(Number.NEGATIVE_INFINITY);
    expect(resample(tone(1000), 48000).samples.length).toBe(48000);
  });
});

/** A voice service that answers every request with a tone as long as the text, and its words. */
function toneService(options: { tags?: boolean; sounds?: boolean } = {}) {
  const asked: SpeakRequest[] = [];
  const clip = (text: string, spoken = text): Clip => {
    const words = spoken.split(/\s+/).filter(Boolean);
    const ms = Math.max(200, text.split(/\s+/).length * 300);
    const samples = new Float32Array((ms / 1000) * 24000);
    for (let index = 0; index < samples.length; index++)
      samples[index] = 0.3 * Math.sin((2 * Math.PI * 200 * index) / 24000);
    return {
      audio: toPcm16({ samples, rate: 24000 }),
      format: "pcm16",
      rate: 24000,
      words: words.map((word, index) => ({
        text: word,
        startMs: index * 300,
        endMs: index * 300 + 250,
      })),
    };
  };
  const adapter: Adapter = {
    id: "tone",
    name: "Tones",
    model: "sine",
    capabilities: {
      maxCharacters: 400,
      directions: options.tags ? "tags" : "none",
      vocalTags: Boolean(options.tags),
      sounds: Boolean(options.sounds),
      timings: "words",
      concurrency: 3,
    },
    voices: async () => [
      { id: "v1", name: "Ada", gender: "female", description: "warm narrator" },
      { id: "v2", name: "Bo", gender: "male" },
      { id: "v3", name: "Cy", gender: "female" },
    ],
    async speak(request) {
      asked.push(request);
      return clip(
        [request.before, request.text, request.after].filter(Boolean).join(" "),
        request.text,
      );
    },
    ...(options.sounds
      ? { sound: async ({ description }: { description: string }) => clip(description) }
      : {}),
    cost: (characters) => characters / 1000,
  };
  return { adapter, asked };
}

describe("making an audiobook", () => {
  const script = productionScript(parse(STORY));
  const voices = { Narrator: "v1", Mara: "v3", Tom: "v2" };

  it("makes each chapter in order, with pacing, timings and words", async () => {
    const { adapter, asked } = toneService({ tags: true });
    const written = new Map<number, number>();
    const made = await produce(script, {
      adapter,
      voices,
      wait: async () => {},
      output: (chapter) => ({
        write: async (pcm) =>
          void written.set(chapter.number, (written.get(chapter.number) ?? 0) + pcm.length),
        close: async () => {},
      }),
    });
    expect(made.chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    const one = made.chapters[0];
    // Every byte written is accounted for in the chapter's length.
    expect(((written.get(1) ?? 0) / 2 / 24000) * 1000).toBeCloseTo(one?.durationMs ?? 0, -1);
    const cues = one?.cues ?? [];
    expect(cues[0]?.startMs).toBe(1000);
    for (const [index, cue] of cues.entries()) {
      const next = cues[index + 1];
      if (next && next.kind !== "vocal" && cue.kind !== "vocal")
        expect(next.startMs).toBeGreaterThanOrEqual(cue.startMs + cue.durationMs);
    }
    const pause = cues.find((cue) => cue.kind === "pause");
    expect(pause?.durationMs).toBeCloseTo(2000, -1);
    // Mara's gasp is voiced with her words, as a tag after them, and placed after them.
    const mara = asked.find((request) => request.text === "Who’s there?");
    expect(mara).toMatchObject({ voice: "v3", direction: "softly", after: "gasps" });
    const gasp = cues.find((cue) => cue.kind === "vocal");
    const said = cues.find((cue) => cue.text === "Who’s there?");
    expect(gasp?.startMs).toBeGreaterThan(said?.startMs ?? 0);
    expect(said?.words?.map((word) => word.text)).toEqual(["Who’s", "there?"]);
    // No sound effects: the creak is left out, and counted.
    expect(made.left).toEqual({ sounds: 1, vocals: 0, directions: 0 });
    // Neighbours are sent for flow.
    expect(asked.find((request) => request.text === "Only me.")?.previous).toBe("Who’s there?");
  });

  it("asks only for what it hasn't made before", async () => {
    const store = memoryStore();
    const sink = () => ({ write: async () => {}, close: async () => {} });
    const first = toneService();
    await produce(script, { adapter: first.adapter, voices, store, output: sink });
    const second = toneService();
    const again = await produce(
      productionScript(parse(STORY.replace("Only me.", "Only me, Mara."))),
      {
        adapter: second.adapter,
        voices,
        store,
        output: sink,
      },
    );
    expect(second.asked.map((request) => request.text)).toEqual(["Only me, Mara."]);
    expect(again.fromStore).toBeGreaterThan(3);
  });

  it("says what a production would cost, and what it would leave out", () => {
    const { adapter } = toneService();
    const cost = estimate(script, { adapter, voices });
    // Seven speeches; the two sounds characters make can't be voiced here.
    expect(cost.requests).toBe(7);
    expect(cost.left).toEqual({ sounds: 1, vocals: 2, directions: 1 });
    expect(cost.costUsd).toBeGreaterThan(0);
    const withSounds = estimate(script, {
      adapter: toneService({ sounds: true, tags: true }).adapter,
      voices,
      sounds: true,
    });
    expect(withSounds.left).toEqual({ sounds: 0, vocals: 0, directions: 0 });
  });

  it("refuses a speaker with no voice", async () => {
    const { adapter } = toneService();
    await expect(
      produce(script, {
        adapter,
        voices: { Narrator: "v1" },
        output: () => ({ write: async () => {}, close: async () => {} }),
      }),
    ).rejects.toThrow("No voice is cast for Mara.");
  });

  it("cuts a long line at sentence ends", () => {
    expect(pieces("One. Two two. Three three three.", 20)).toEqual([
      "One. Two two.",
      "Three three three.",
    ]);
    expect(pieces("Abcdefghij", 4)).toEqual(["Abcd", "efgh", "ij"]);
  });
});

describe("casting", () => {
  it("gives the narrator a storyteller and each character a voice of their own, by gender", () => {
    const story = parse(STORY);
    const people = speakersOf(story, ["Mara", "Tom"]);
    expect(people.map((person) => person.name)).toEqual(["Narrator", "Mara", "Tom"]);
    expect(genderOf(people[1]?.words ?? "")).toBe("female");
    expect(genderOf(people[2]?.words ?? "")).toBe("male");
    const voices = [
      { id: "a", name: "Ada", gender: "female" as const, description: "warm, narration" },
      { id: "b", name: "Bo", gender: "male" as const },
      { id: "c", name: "Cy", gender: "female" as const },
    ];
    expect(castVoices(people, voices)).toEqual({ Narrator: "Ada", Mara: "Cy", Tom: "Bo" });
    // A voice already chosen stays; Mara still gets the other woman's voice.
    expect(castVoices(people, voices, { kept: { Tom: "a" } })).toEqual({
      Tom: "a",
      Narrator: "Bo",
      Mara: "Cy",
    });
    expect(voiceId(voices, "cy")).toBe("c");
  });
});

/** A stand-in for a service's API: what was asked, and an answer. */
function stand(answer: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(String(url), init ?? {});
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("ElevenLabs", () => {
  it("sends a line with its direction and sounds as tags, and reads back its words", async () => {
    const pcm = toPcm16(silence(500, 24000));
    const sent = "[softly] Who’s there? [gasps]";
    const chars = [...sent];
    const { fetch, calls } = stand(
      () =>
        new Response(
          JSON.stringify({
            audio_base64: Buffer.from(pcm).toString("base64"),
            alignment: {
              characters: chars,
              character_start_times_seconds: chars.map((_, index) => index * 0.01),
              character_end_times_seconds: chars.map((_, index) => index * 0.01 + 0.01),
            },
          }),
          { headers: { "request-id": "req-1" } },
        ),
    );
    const adapter = elevenlabs({ key: "k", fetch });
    const clip = await adapter.speak({
      text: "Who’s there?",
      voice: "voice id",
      direction: "softly",
      after: "gasps",
      language: "en-GB",
      previous: "Night fell.",
    });
    expect(calls[0]?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice%20id/with-timestamps?output_format=pcm_24000",
    );
    expect((calls[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      text: sent,
      model_id: "eleven_v4",
      language_code: "en",
      previous_text: "Night fell.",
    });
    expect(clip.words?.map((word) => word.text)).toEqual(["Who’s", "there?"]);
    expect(clip.words?.[0]?.startMs).toBe(90);
    expect(clip.requestId).toBe("req-1");
    expect(clip.audio.length).toBe(pcm.length);
  });

  it("lists the account's voices, page after page", async () => {
    const { fetch, calls } = stand(
      (url) =>
        new Response(
          JSON.stringify(
            url.includes("next_page_token")
              ? {
                  voices: [{ voice_id: "2", name: "Bo", labels: { gender: "male" } }],
                  has_more: false,
                }
              : {
                  voices: [
                    {
                      voice_id: "1",
                      name: "Ada",
                      labels: { gender: "female", accent: "british" },
                      preview_url: "p",
                    },
                  ],
                  has_more: true,
                  next_page_token: "t",
                },
          ),
        ),
    );
    const voices = await elevenlabs({ key: "k", fetch }).voices();
    expect(voices).toEqual([
      { id: "1", name: "Ada", description: "female, british", gender: "female", preview: "p" },
      { id: "2", name: "Bo", description: "male", gender: "male" },
    ]);
    expect(calls.length).toBe(2);
  });

  it("says a refused key plainly, and a busy service as worth trying again", async () => {
    const refused = elevenlabs({
      key: "k",
      fetch: stand(() => new Response("bad key", { status: 401 })).fetch,
    });
    await expect(refused.speak({ text: "Hi", voice: "v", direction: null })).rejects.toThrow(
      "didn't accept the key",
    );
    const busy = elevenlabs({
      key: "k",
      fetch: stand(() => new Response("slow down", { status: 429 })).fetch,
    });
    await expect(busy.speak({ text: "Hi", voice: "v", direction: null })).rejects.toMatchObject({
      retry: true,
    });
  });
});

describe("OpenAI-compatible speech", () => {
  it("asks for WAV, with the direction as instructions where the server takes them", async () => {
    const wav = toWav(silence(100, 24000));
    const { fetch, calls } = stand(() => new Response(new Uint8Array(wav)));
    const adapter = openaiSpeech({
      base: "http://127.0.0.1:8880/v1",
      model: "kokoro",
      instructions: true,
      fetch,
    });
    const clip = await adapter.speak({ text: "Hello.", voice: "bf_emma", direction: "softly" });
    expect(calls[0]?.url).toBe("http://127.0.0.1:8880/v1/audio/speech");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "kokoro",
      input: "Hello.",
      voice: "bf_emma",
      response_format: "wav",
      instructions: "Say this softly.",
    });
    expect(clip.format).toBe("wav");
  });

  it("reads Kokoro's voice names as language and gender", async () => {
    const { fetch } = stand(() => new Response(JSON.stringify({ voices: ["bf_emma", "am_adam"] })));
    const voices = await openaiSpeech({ base: "http://x", model: "kokoro", fetch }).voices();
    expect(voices).toEqual([
      {
        id: "bf_emma",
        name: "Emma",
        gender: "female",
        language: "en-GB",
        description: "female, en-GB",
      },
      {
        id: "am_adam",
        name: "Adam",
        gender: "male",
        language: "en-US",
        description: "male, en-US",
      },
    ]);
  });

  it("says when the server isn't running", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expect(
      openaiSpeech({ base: "http://127.0.0.1:8880", model: "kokoro", name: "Kokoro", fetch }).speak(
        {
          text: "Hi",
          voice: "af_bella",
          direction: null,
        },
      ),
    ).rejects.toThrow("Kokoro at http://127.0.0.1:8880 can't be reached: is it running?");
  });
});

describe("Azure and SSML", () => {
  it("sends SSML in the voice, the direction as the nearest speaking style", async () => {
    const { fetch, calls } = stand(() => new Response(new Uint8Array(toWav(silence(100, 24000)))));
    await azure({ key: "k", region: "westeurope", fetch }).speak({
      text: "Don’t <go>!",
      voice: "en-GB-SoniaNeural",
      direction: "in a whisper",
    });
    expect(calls[0]?.url).toBe("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(String(calls[0]?.init.body)).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-GB"><voice name="en-GB-SoniaNeural"><mstts:express-as style="whispering">Don’t &lt;go&gt;!</mstts:express-as></voice></speak>',
    );
    expect(styleFor("angrily")).toBe("angry");
    expect(styleFor("with a shrug")).toBeUndefined();
  });

  it("writes a chapter as one SSML document, with breaks", () => {
    const ssml = chapterSsml(productionScript(parse(STORY)), 1, {
      Narrator: "en-GB-RyanNeural",
      Mara: "en-GB-SoniaNeural",
      Tom: "en-GB-ThomasNeural",
    });
    expect(ssml).toContain('xml:lang="en-GB"');
    expect(ssml).toContain('<voice name="en-GB-RyanNeural"><break time="2000ms"/></voice>');
    expect(ssml).toContain(
      '<voice name="en-GB-SoniaNeural"><mstts:express-as style="gentle">Who’s there?</mstts:express-as><break time="250ms"/></voice>',
    );
    expect(ssml).toContain("<!-- [door creaks] -->");
  });
});

describe("files", () => {
  it("keeps clips on disk, and writes a chapter as WAV a piece at a time", async () => {
    const folder = await mkdtemp(join(tmpdir(), "vxd-produce-"));
    try {
      const store = folderStore(join(folder, "clips"));
      const clip: Clip = {
        audio: new Uint8Array([1, 2, 3, 4]),
        format: "pcm16",
        rate: 24000,
        requestId: "r",
      };
      await store.set("abcdef", clip);
      expect(await store.get("abcdef")).toEqual(clip);
      expect(await store.get("nothing")).toBeUndefined();
      const sink = await wavFile(join(folder, "one.wav"), 24000);
      await sink.write(toPcm16(silence(100, 24000)));
      await sink.write(toPcm16(silence(150, 24000)));
      await sink.close();
      const back = fromWav(new Uint8Array(await readFile(join(folder, "one.wav"))));
      expect(back.samples.length).toBe(6000);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it.runIf(ffmpegHere)("makes an M4B with its chapters marked", async () => {
    const folder = await mkdtemp(join(tmpdir(), "vxd-produce-"));
    try {
      const { adapter } = toneService();
      const wavs: Array<{ wav: string; title: string; durationMs: number }> = [];
      const made = await produce(productionScript(parse(STORY)), {
        adapter,
        voices: { Narrator: "v1", Mara: "v3", Tom: "v2" },
        output: async (chapter) => {
          const wav = join(folder, `${chapter.number}.wav`);
          wavs.push({ wav, title: chapter.title, durationMs: 0 });
          return wavFile(wav, 24000);
        },
      });
      made.chapters.forEach((chapter, index) => {
        (wavs[index] as { durationMs: number }).durationMs = chapter.durationMs;
      });
      const m4b = join(folder, "book.m4b");
      await bookM4b(wavs, m4b, { title: "The Owl", author: "A. Teller" });
      const marks = await chaptersOf(m4b);
      expect(marks.map((mark) => mark.title)).toEqual(["One", "Two"]);
      expect(marks[1]?.startMs).toBeCloseTo(made.chapters[0]?.durationMs ?? 0, -2);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
