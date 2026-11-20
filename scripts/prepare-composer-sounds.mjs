#!/usr/bin/env node
/**
 * Prepares VoxDown Composer's self-hosted instrument samples (one-off; the results are committed).
 *
 * Sources, both freely licensed with attribution (see site/public/composer/sounds/LICENSE.md):
 * - Piano: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), as published by Tone.js.
 * - Fiddle, flute, strings, nylon guitar: FluidR3_GM by Frank Wen (CC BY 3.0), as rendered by
 *   gleitz/midi-js-soundfonts.
 *
 * Every third semitone is kept (the player pitch-shifts at most a semitone and a half), mono,
 * 64 kbit/s MP3. Piano notes are trimmed by register with a gentle fade; sustained instruments
 * keep their steady 3 s rendering, which the player loops at a matched point while held.
 *
 * Usage: node scripts/prepare-composer-sounds.mjs   (needs ffmpeg and a network connection)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site/public/composer/sounds");
const cache = join(process.env.TMPDIR ?? "/tmp", "composer-sound-sources");
mkdirSync(cache, { recursive: true });

const SHARP = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const octave = (midi) => Math.floor(midi / 12) - 1;
const grid = (low, high) => {
  const notes = [];
  for (let midi = low; midi <= high; midi++) if (midi % 3 === 0) notes.push(midi);
  return notes;
};

const instruments = [
  {
    id: "piano",
    notes: grid(21, 108),
    url: (m) => `https://tonejs.github.io/audio/salamander/${SHARP[m % 12]}${octave(m)}.mp3`,
    // Low strings ring for longer; the top of the keyboard is short anyway.
    seconds: (m) => (m < 48 ? 6 : m < 72 ? 4.5 : m < 90 ? 3 : 2),
    fade: true,
  },
  ...[
    ["fiddle", "violin", 54, 99],
    ["flute", "flute", 60, 96],
    ["strings", "string_ensemble_1", 36, 96],
    ["guitar", "acoustic_guitar_nylon", 39, 84],
  ].map(([id, name, low, high]) => ({
    id,
    notes: grid(low, high),
    url: (m) =>
      `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${name}-mp3/${FLAT[m % 12]}${octave(m)}.mp3`,
    seconds: () => 3,
    fade: id === "guitar",
  })),
];

const manifest = {};
for (const instrument of instruments) {
  const dir = join(out, instrument.id);
  mkdirSync(dir, { recursive: true });
  for (const midi of instrument.notes) {
    const source = join(cache, `${instrument.id}-${midi}.mp3`);
    if (!existsSync(source)) {
      const response = await fetch(instrument.url(midi));
      if (!response.ok) throw new Error(`${instrument.url(midi)}: ${response.status}`);
      writeFileSync(source, Buffer.from(await response.arrayBuffer()));
    }
    const seconds = instrument.seconds(midi);
    const filters = [`atrim=0:${seconds}`, "asetpts=N/SR/TB"];
    if (instrument.fade)
      filters.push(`afade=t=out:st=${seconds * 0.6}:d=${seconds * 0.4}:curve=exp`);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-af",
      filters.join(","),
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      join(dir, `${midi}.mp3`),
    ]);
  }
  const bytes = readdirSync(dir)
    .filter((file) => file.endsWith(".mp3"))
    .reduce((sum, file) => sum + statSync(join(dir, file)).size, 0);
  manifest[instrument.id] = { notes: instrument.notes, bytes };
  console.log(
    `${instrument.id}: ${instrument.notes.length} samples, ${(bytes / 1024).toFixed(0)} KB`,
  );
}
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
