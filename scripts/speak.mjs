// Records the stories on the listening page: each line in its character's voice and as its marks
// direct, with the sounds and pauses between, stitched into one MP3 per story (site/public/listen/)
// and the timings the page plays it by (site/src/recordings/).
//
//   ELEVENLABS_API_KEY=… node scripts/speak.mjs [story.vxd …] [--dry-run]
//
// The casting is in scripts/speak.json: a voice for each character, by its name in ElevenLabs,
// one of theirs ("George") or one of the account's own. A voice can be shown on the page under
// another name: { "voice": "N1 — Kinu Comedy Narrator", "as": "Steve" }.
// It needs `pnpm build` first (the parser is read from packages/core/dist) and ffmpeg. Each clip is
// kept in ~/.cache/voxdown-speak, so recording again only pays for lines or voices that changed.
// --dry-run prints what each voice would be sent, and the characters it would cost, and stops.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../packages/core/dist/index.js";

const root = join(import.meta.dirname, "..");
const casting = JSON.parse(readFileSync(join(import.meta.dirname, "speak.json"), "utf8"));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const chosen = args.filter((arg) => !arg.startsWith("--"));
const stories = chosen.length ? chosen : Object.keys(casting.stories);
const cache = process.env.VOXDOWN_SPEAK_CACHE ?? join(homedir(), ".cache", "voxdown-speak");
const API = "https://api.elevenlabs.io";
/** A casting's voice by its ElevenLabs name, and the name the page shows it by. */
const voiceName = (cast) => (typeof cast === "string" ? cast : cast.voice);
const shownName = (cast) => (typeof cast === "string" ? cast : (cast.as ?? cast.voice));

/** Silence between parts: on one line, from line to line, between paragraphs, after a heading. */
const GAP = { part: 0.25, line: 0.45, block: 0.8, heading: 1.1 };
/** How loud each kind of clip is made, in LUFS: voices first, the world behind them. */
const LOUDNESS = { voice: -17, sound: -24, page: -28 };
const PAGE_TURN = "a single page of a book turning, soft paper, close and quiet";

// What a listener hears

/** In order: speech, a character's sounds, sounds, pauses and page turns, as the page lights them. */
function cuesOf(story) {
  const cues = [];
  story.blocks.forEach((block, blockIndex) => {
    if (block.kind === "break" || block.visibility === "book" || block.visibility === "hidden")
      return;
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    lines.forEach((line, lineIndex) => {
      const at = (item) => ({
        from: item.range.from,
        line: [line.range.from, line.range.to],
        block: blockIndex,
        heading: block.kind === "heading",
        lineIndex,
      });
      for (const item of [...line.items].sort((a, b) => a.range.from - b.range.from)) {
        if (item.kind === "speech" && /[\p{L}\p{N}]/u.test(item.text))
          cues.push({
            ...at(item),
            kind: "speech",
            speaker: item.speaker,
            direction: item.direction,
            text: item.text,
          });
        else if (item.kind === "vocal")
          cues.push({
            ...at(item),
            kind: "vocal",
            speaker: item.speaker,
            direction: item.direction,
            text: item.description,
          });
        else if (item.kind === "sound")
          cues.push({
            ...at(item),
            kind: "sound",
            speaker: null,
            direction: null,
            text: item.description,
          });
        else if (item.kind === "instruction" && item.name === "pause")
          cues.push({
            ...at(item),
            kind: "pause",
            speaker: null,
            direction: null,
            text: item.value ?? "",
          });
        else if (item.kind === "instruction" && item.name === "page")
          cues.push({ ...at(item), kind: "page", speaker: null, direction: null, text: "" });
      }
    });
  });
  // A character's sound beside their own words on the same line is voiced with those words.
  cues.forEach((cue, index) => {
    if (cue.kind !== "vocal") return;
    const sameLine = (other) =>
      other?.kind === "speech" && other.speaker === cue.speaker && other.line[0] === cue.line[0];
    const next = cues[index + 1];
    const previous = cues[index - 1];
    if (sameLine(next) && !next.before) next.before = cue;
    else if (sameLine(previous) && !previous.after) previous.after = cue;
    else return;
    cue.joined = sameLine(next) && next.before === cue ? next : previous;
  });
  return cues;
}

/** Markdown's own signs are for the page; a voice gets the words. Square brackets would read as tags. */
function plain(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*{1,3}|_{1,3})(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[[\]]/g, "");
}

const tag = (text) => `[${text}]`;
const vocalTag = (cue) => tag(cue.direction ? `${cue.text}, ${cue.direction}` : cue.text);

/** The text a voice is sent: the direction as a tag, and any sound of theirs beside it. */
function voiceText(cue) {
  return [
    cue.before ? vocalTag(cue.before) : "",
    cue.direction ? tag(cue.direction) : "",
    plain(cue.text),
    cue.after ? vocalTag(cue.after) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A character's sound on its own, described for the sound generator by who makes it. */
function soundOfCharacter(cue, story) {
  const member = story.cast.find((candidate) => candidate.handle === cue.speaker);
  const who = member?.about ?? member?.name ?? cue.speaker;
  return `${cue.direction ? `${cue.text}, ${cue.direction}` : cue.text}: ${who}`;
}

/** What a part was made from: the text a voice was sent, or what the sound generator was asked. */
function sentFor(cue, story) {
  if (cue.kind === "speech") return voiceText(cue);
  if (cue.kind === "vocal")
    return cue.joined ? voiceText(cue.joined) : soundOfCharacter(cue, story);
  if (cue.kind === "sound") return cue.text;
  if (cue.kind === "page") return PAGE_TURN;
  return null;
}

function seconds(value) {
  const match = value?.match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/);
  if (!match) return 1;
  return match[2] === "ms" ? Number(match[1]) / 1000 : Number(match[1]);
}

// ElevenLabs

const key = process.env.ELEVENLABS_API_KEY;

async function call(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}

/** Whatever `make` returns, kept on disk by what was asked, so it is only paid for once. */
async function cached(request, extension, make) {
  mkdirSync(cache, { recursive: true });
  const file = join(
    cache,
    `${createHash("sha256").update(JSON.stringify(request)).digest("hex")}.${extension}`,
  );
  if (!existsSync(file)) writeFileSync(file, await make());
  return file;
}

/**
 * Every voice the account can use, by name: ElevenLabs' own (named by their first word, "George"),
 * and the account's own designed, cloned or saved voices, by their full name.
 */
async function voiceIds() {
  const ids = new Map();
  let token = "";
  do {
    const page = token ? `&next_page_token=${encodeURIComponent(token)}` : "";
    const response = await fetch(`${API}/v2/voices?page_size=100${page}`, {
      headers: { "xi-api-key": key },
    });
    if (!response.ok) throw new Error(`voices: ${response.status} ${await response.text()}`);
    const { voices, has_more: more, next_page_token: next } = await response.json();
    for (const voice of voices) {
      // The account's own voices take a name before a built-in voice of the same first word.
      if (voice.category !== "premade") ids.set(voice.name.trim(), voice.voice_id);
      const short = voice.name.split(" - ")[0].trim();
      if (!ids.has(short)) ids.set(short, voice.voice_id);
    }
    token = more ? next : "";
  } while (token);
  return ids;
}

/** A line in a voice, with when each character of the text is spoken. */
function speak(voice, text, context) {
  const request = { kind: "speech", model: casting.model, voice, text, ...context };
  return cached(request, "json", async () => {
    const response = await call(
      `/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
      {
        text,
        model_id: casting.model,
        ...context,
      },
    );
    return Buffer.from(JSON.stringify(await response.json()));
  });
}

function sound(text, duration) {
  return cached({ kind: "sound", text, duration }, "mp3", async () => {
    const response = await call("/v1/sound-generation?output_format=mp3_44100_128", {
      text,
      duration_seconds: duration,
    });
    return Buffer.from(await response.arrayBuffer());
  });
}

// Sound files

function ffmpeg(...options) {
  return execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...options], {
    encoding: "utf8",
  });
}

function duration(file) {
  return Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    ),
  );
}

/** How loud a clip is (integrated LUFS) after `filters`, as ffmpeg's loudness filter measures it. */
function loudnessOf(input, filters) {
  const run = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      input,
      "-af",
      [...filters, "loudnorm=print_format=json"].join(","),
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const report = run.stderr.slice(run.stderr.lastIndexOf("{"));
  try {
    return Number(JSON.parse(report).input_i);
  } catch {
    return Number.NaN;
  }
}

/**
 * A clip as mono WAV: cut to [from, to), its silent edges trimmed, and brought to `loudness` with
 * one gain for the whole clip, so a whisper stays a whisper and a roar a roar.
 */
function prepare(input, output, loudness, from, to, trimmed = true) {
  const cut =
    from !== undefined
      ? [`atrim=start=${from}${to !== undefined ? `:end=${to}` : ""}`, "asetpts=PTS-STARTPTS"]
      : [];
  const edge = "silenceremove=start_periods=1:start_threshold=-45dB";
  // A voice's silent edges go, as the gaps between parts are set here; a sound keeps all of itself.
  const filters = [...cut, ...(trimmed ? [edge, "areverse", edge, "areverse"] : [])];
  const measured = loudnessOf(input, filters);
  const gain = Number.isFinite(measured) ? loudness - measured : 0;
  ffmpeg(
    "-i",
    input,
    "-af",
    [...filters, `volume=${gain.toFixed(2)}dB`, "alimiter=limit=0.9"].join(","),
    "-ac",
    "1",
    "-ar",
    "44100",
    output,
  );
  return output;
}

function silence(output, length) {
  ffmpeg("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(length), output);
  return output;
}

// One story

async function record(name, voicesByName) {
  const text = readFileSync(join(root, "examples", name), "utf8");
  const story = parse(text);
  const voices = casting.stories[name];
  const cues = cuesOf(story);
  const missing = [
    ...new Set(cues.filter((cue) => cue.speaker && !voices[cue.speaker]).map((cue) => cue.speaker)),
  ];
  if (missing.length)
    throw new Error(`${name}: no voice for ${missing.join(", ")} in scripts/speak.json`);

  const spoken = cues.filter((cue) => cue.kind === "speech");
  const characters = spoken.reduce((sum, cue) => sum + voiceText(cue).length, 0);
  if (dryRun) {
    console.log(`\n== ${name}: ${cues.length} parts, ${characters} characters of speech`);
    for (const cue of cues) {
      if (cue.joined) continue;
      const what =
        cue.kind === "speech"
          ? `${voiceName(voices[cue.speaker])}: ${voiceText(cue)}`
          : cue.kind === "vocal"
            ? `sound effect: ${soundOfCharacter(cue, story)}`
            : cue.kind === "sound"
              ? `sound effect: ${cue.text}`
              : cue.kind === "pause"
                ? `silence: ${seconds(cue.text)}s`
                : "page turn";
      console.log(`  ${what}`);
    }
    return;
  }

  const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "voxdown-speak-"));
  const pieces = [];
  let time = 0;
  const add = (file, cue) => {
    const length = duration(file);
    if (cue) Object.assign(cue, { start: time, duration: length });
    pieces.push(file);
    time += length;
  };
  const gap = (length) => add(silence(join(work, `gap-${pieces.length}.wav`), length));
  try {
    for (const [index, cue] of cues.entries()) {
      const piece = (suffix) => join(work, `${String(index).padStart(3, "0")}${suffix}.wav`);
      if (cue.kind === "speech") {
        const neighbor = (step) => spoken[spoken.indexOf(cue) + step]?.text;
        const context = Object.fromEntries(
          [
            ["previous_text", neighbor(-1)],
            ["next_text", neighbor(1)],
          ].filter(([, value]) => value),
        );
        const sent = voiceText(cue);
        const result = JSON.parse(
          readFileSync(
            await speak(voicesByName.get(voiceName(voices[cue.speaker])), sent, context),
            "utf8",
          ),
        );
        const mp3 = join(work, `${index}.mp3`);
        writeFileSync(mp3, Buffer.from(result.audio_base64, "base64"));
        // Where the words begin and end, to cut a character's sound beside them into its own part.
        const { characters: chars, character_start_times_seconds: starts } = result.alignment;
        const at = (offset) => starts[Math.min(offset, chars.length - 1)] ?? 0;
        const wordsFrom = sent.indexOf(plain(cue.text));
        const wordsTo = wordsFrom + plain(cue.text).length;
        if (cue.before) {
          add(prepare(mp3, piece("a"), LOUDNESS.voice, 0, at(wordsFrom)), cue.before);
          gap(0.15);
        }
        add(
          prepare(
            mp3,
            piece("b"),
            LOUDNESS.voice,
            cue.before ? at(wordsFrom) : 0,
            cue.after ? at(wordsTo) : undefined,
          ),
          cue,
        );
        if (cue.after) {
          gap(0.15);
          add(prepare(mp3, piece("c"), LOUDNESS.voice, at(wordsTo)), cue.after);
        }
      } else if (cue.kind === "vocal" && !cue.joined) {
        add(
          prepare(
            await sound(soundOfCharacter(cue, story), 2),
            piece(""),
            LOUDNESS.voice,
            undefined,
            undefined,
            false,
          ),
          cue,
        );
      } else if (cue.kind === "sound") {
        add(
          prepare(
            await sound(cue.text, 2.5),
            piece(""),
            LOUDNESS.sound,
            undefined,
            undefined,
            false,
          ),
          cue,
        );
      } else if (cue.kind === "pause") {
        add(silence(piece(""), seconds(cue.text)), cue);
      } else if (cue.kind === "page") {
        add(
          prepare(await sound(PAGE_TURN, 1), piece(""), LOUDNESS.page, undefined, undefined, false),
          cue,
        );
      }
      if (cue.joined) continue;
      const next = cues.slice(index + 1).find((other) => !other.joined);
      if (!next) break;
      gap(
        next.block !== cue.block
          ? cue.heading
            ? GAP.heading
            : GAP.block
          : next.lineIndex !== cue.lineIndex
            ? GAP.line
            : GAP.part,
      );
    }

    const out = join(root, "site", "public", "listen");
    mkdirSync(out, { recursive: true });
    const base = name.replace(/\.vxd$/, "");
    const list = join(work, "list.txt");
    writeFileSync(list, pieces.map((file) => `file '${file}'`).join("\n"));
    ffmpeg(
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-ac",
      "1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "96k",
      join(out, `${base}.mp3`),
    );
    const manifest = {
      story: name,
      audio: `${base}.mp3`,
      source: createHash("sha256").update(text).digest("hex"),
      model: casting.model,
      voices: Object.fromEntries(
        Object.entries(voices).map(([character, cast]) => [character, shownName(cast)]),
      ),
      duration: Number(time.toFixed(3)),
      cues: cues.map((cue) => ({
        kind: cue.kind,
        from: cue.from,
        line: cue.line,
        speaker: cue.speaker,
        direction: cue.direction,
        text: cue.text,
        // Exactly what was asked for, so the page can show it.
        sent: sentFor(cue, story),
        start: Number(cue.start.toFixed(3)),
        duration: Number(cue.duration.toFixed(3)),
      })),
    };
    const timings = join(root, "site", "src", "recordings");
    mkdirSync(timings, { recursive: true });
    writeFileSync(join(timings, `${base}.json`), `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(
      `${name}: ${cues.length} parts, ${time.toFixed(1)}s, ${characters} characters of speech`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (!dryRun && !key) {
  console.error("Set ELEVENLABS_API_KEY, or use --dry-run.");
  process.exit(1);
}
const voicesByName = dryRun ? new Map() : await voiceIds();
for (const name of stories) {
  if (!casting.stories[name]) throw new Error(`${name} isn't in scripts/speak.json`);
  if (!dryRun) {
    const unknown = Object.values(casting.stories[name])
      .map(voiceName)
      .filter((voice) => !voicesByName.has(voice));
    if (unknown.length) throw new Error(`No ElevenLabs voice named ${unknown.join(", ")}`);
  }
  await record(name, voicesByName);
}
