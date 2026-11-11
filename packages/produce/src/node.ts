/**
 * What making an audiobook needs from Node: clips kept on disk between runs, each chapter written
 * to a WAV file as it is joined, and ffmpeg, where it is installed, for an MP3 a chapter (at the
 * levels audiobook stores ask for) and one M4B file with its chapters marked, the way audiobook
 * players take a book.
 */
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Clip } from "./adapter";
import { type Sound, fromWav } from "./audio";
import type { ChapterSink, ClipStore } from "./render";

const run = promisify(execFile);

/** Clips kept in a folder: each as its sound and, beside it, what is known of it. */
export function folderStore(folder: string): ClipStore {
  const path = (key: string) => join(folder, key.slice(0, 2), key);
  return {
    async get(key) {
      try {
        const about = JSON.parse(await readFile(`${path(key)}.json`, "utf8")) as Omit<
          Clip,
          "audio"
        >;
        return { ...about, audio: new Uint8Array(await readFile(`${path(key)}.audio`)) };
      } catch {
        return undefined;
      }
    },
    async set(key, clip) {
      await mkdir(dirname(path(key)), { recursive: true });
      const { audio, ...about } = clip;
      await writeFile(`${path(key)}.audio`, audio);
      await writeFile(`${path(key)}.json`, JSON.stringify(about));
    },
  };
}

/** A WAV file written a piece at a time, its sizes filled in when it closes. */
export async function wavFile(path: string, rate: number): Promise<ChapterSink> {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, "w");
  await file.write(new Uint8Array(44));
  let length = 0;
  return {
    async write(pcm) {
      await file.write(pcm);
      length += pcm.length;
    },
    async close() {
      const header = new Uint8Array(44);
      const view = new DataView(header.buffer);
      const text = (at: number, value: string) => {
        for (let index = 0; index < value.length; index++)
          header[at + index] = value.charCodeAt(index);
      };
      text(0, "RIFF");
      view.setUint32(4, 36 + length, true);
      text(8, "WAVE");
      text(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, "data");
      view.setUint32(40, length, true);
      await file.write(header, 0, 44, 0);
      await file.close();
    },
  };
}

/** Whether ffmpeg is installed. */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-hide_banner", "-version"]);
    return true;
  } catch {
    return false;
  }
}

const ffmpeg = (args: string[]) =>
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });

/** A clip ffmpeg can read (MP3 and others) as sound: for `produce`'s `decode`. */
export async function decodeWithFfmpeg(clip: Clip): Promise<Sound> {
  const folder = join(tmpdir(), `vxd-decode-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await mkdir(folder, { recursive: true });
  try {
    const input = join(folder, `in.${clip.format}`);
    const output = join(folder, "out.wav");
    await writeFile(input, clip.audio);
    await ffmpeg(["-i", input, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", output]);
    return fromWav(new Uint8Array(await readFile(output)));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Loudness as audiobook stores ask for it (about -20 dB, peaks under -3 dB), in one pass. */
const LOUDNORM = "loudnorm=I=-20:TP=-3.5:LRA=11";

/** A chapter's WAV as an MP3 the way audiobook stores take them: 192 kbps CBR, 44.1 kHz, mono. */
export async function chapterMp3(
  wav: string,
  mp3: string,
  tags: { title: string; album: string; artist?: string; track: number; tracks: number },
): Promise<void> {
  await ffmpeg([
    "-i",
    wav,
    "-af",
    LOUDNORM,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-metadata",
    `title=${tags.title}`,
    "-metadata",
    `album=${tags.album}`,
    ...(tags.artist ? ["-metadata", `artist=${tags.artist}`] : []),
    "-metadata",
    `track=${tags.track}/${tags.tracks}`,
    "-metadata",
    "genre=Audiobook",
    mp3,
  ]);
}

/** Text for ffmpeg's metadata file: its signs escaped. */
const metadataText = (text: string) => text.replace(/[=;#\\\n]/g, (sign) => `\\${sign}`);

/**
 * The chapters' WAV files as one M4B audiobook (AAC), each chapter marked where it starts, with
 * the book's title and author, and its cover, if one is given.
 */
export async function bookM4b(
  chapters: ReadonlyArray<{ wav: string; title: string; durationMs: number }>,
  m4b: string,
  book: { title: string; author?: string; cover?: string },
): Promise<void> {
  const folder = join(tmpdir(), `vxd-m4b-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await mkdir(folder, { recursive: true });
  try {
    const list = join(folder, "list.txt");
    await writeFile(
      list,
      chapters.map((chapter) => `file '${chapter.wav.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    let at = 0;
    const marks = chapters.map((chapter) => {
      const mark = `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${at}\nEND=${at + chapter.durationMs}\ntitle=${metadataText(chapter.title)}\n`;
      at += chapter.durationMs;
      return mark;
    });
    const metadata = join(folder, "chapters.txt");
    await writeFile(
      metadata,
      `;FFMETADATA1\ntitle=${metadataText(book.title)}\nalbum=${metadataText(book.title)}\n${book.author ? `artist=${metadataText(book.author)}\nalbum_artist=${metadataText(book.author)}\n` : ""}genre=Audiobook\n\n${marks.join("\n")}`,
    );
    await mkdir(dirname(m4b), { recursive: true });
    await ffmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-i",
      metadata,
      ...(book.cover ? ["-i", book.cover] : []),
      "-map",
      "0:a",
      ...(book.cover ? ["-map", "2:v", "-c:v", "copy", "-disposition:v", "attached_pic"] : []),
      "-map_metadata",
      "1",
      "-map_chapters",
      "1",
      "-af",
      LOUDNORM,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      m4b,
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The chapters an audio file is marked with, as ffprobe reads them. */
export async function chaptersOf(
  file: string,
): Promise<Array<{ title: string; startMs: number; endMs: number }>> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_chapters", "-of", "json", file]);
  const data = JSON.parse(stdout) as {
    chapters?: Array<{ start_time: string; end_time: string; tags?: { title?: string } }>;
  };
  return (data.chapters ?? []).map((chapter) => ({
    title: chapter.tags?.title ?? "",
    startMs: Math.round(Number(chapter.start_time) * 1000),
    endMs: Math.round(Number(chapter.end_time) * 1000),
  }));
}

export { folderStore as diskStore };
