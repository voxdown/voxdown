/**
 * Sound as numbers: 16-bit mono PCM, the one form every clip is brought to before it joins a
 * chapter. Silence, trimming a clip's quiet edges, evening out how loud each clip is, joining them,
 * and WAV files in and out: no library, and nothing here needs a browser or Node.
 */

/** Mono sound: samples from -1 to 1, and how many a second. */
export type Sound = { samples: Float32Array; rate: number };

/** 16-bit little-endian PCM bytes as a sound. */
export function fromPcm16(bytes: Uint8Array, rate: number): Sound {
  const count = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++)
    samples[index] = view.getInt16(index * 2, true) / 32768;
  return { samples, rate };
}

/** A sound as 16-bit little-endian PCM bytes. */
export function toPcm16(sound: Sound): Uint8Array {
  const bytes = new Uint8Array(sound.samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < sound.samples.length; index++) {
    const value = Math.max(-1, Math.min(1, sound.samples[index] as number));
    view.setInt16(index * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return bytes;
}

/** A sound as a WAV file (16-bit mono). */
export function toWav(sound: Sound): Uint8Array {
  const pcm = toPcm16(sound);
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++) out[at + index] = value.charCodeAt(index);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sound.rate, true);
  view.setUint32(28, sound.rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** A WAV file's sound: 16-bit PCM, mono or stereo (mixed down). */
export function fromWav(bytes: Uint8Array): Sound {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("This isn't a WAV file.");
  let at = 12;
  let rate = 0;
  let channels = 1;
  let bits = 16;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === "data") {
      if (bits !== 16) throw new Error("Only 16-bit WAV files can be read.");
      // A streamed WAV may say its data is longer than it is.
      const data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
      const mono = fromPcm16(data, rate);
      if (channels === 1) return mono;
      const frames = Math.floor(mono.samples.length / channels);
      const mixed = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++)
          sum += mono.samples[frame * channels + channel] as number;
        mixed[frame] = sum / channels;
      }
      return { samples: mixed, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("This WAV file has no sound in it.");
}

/** Silence, so long. */
export function silence(ms: number, rate: number): Sound {
  return { samples: new Float32Array(Math.max(0, Math.round((ms / 1000) * rate))), rate };
}

/** A sound at another rate (linear interpolation: plenty for speech going to a lossy encoder). */
export function resample(sound: Sound, rate: number): Sound {
  if (sound.rate === rate) return sound;
  const length = Math.round((sound.samples.length * rate) / sound.rate);
  const out = new Float32Array(length);
  const step = sound.rate / rate;
  for (let index = 0; index < length; index++) {
    const at = index * step;
    const left = Math.floor(at);
    const right = Math.min(left + 1, sound.samples.length - 1);
    const fraction = at - left;
    out[index] =
      (sound.samples[left] ?? 0) * (1 - fraction) + (sound.samples[right] ?? 0) * fraction;
  }
  return { samples: out, rate };
}

/** In decibels, from a level from 0 to 1. */
const decibels = (level: number) => (level > 0 ? 20 * Math.log10(level) : Number.NEGATIVE_INFINITY);

/** The sound with its quiet edges cut: where it stays below `threshold` dB, in 10 ms windows. */
export function trimmed(sound: Sound, threshold = -45): { sound: Sound; from: number; to: number } {
  const window = Math.max(1, Math.round(sound.rate / 100));
  const loud = (start: number) => {
    let peak = 0;
    for (let index = start; index < Math.min(start + window, sound.samples.length); index++)
      peak = Math.max(peak, Math.abs(sound.samples[index] as number));
    return decibels(peak) > threshold;
  };
  let from = 0;
  while (from < sound.samples.length && !loud(from)) from += window;
  let to = sound.samples.length;
  while (to > from && !loud(Math.max(from, to - window))) to -= window;
  // A little air either side, so a breath's tail isn't clipped.
  const pad = Math.round(sound.rate * 0.02);
  from = Math.max(0, from - pad);
  to = Math.min(sound.samples.length, to + pad);
  return { sound: { samples: sound.samples.subarray(from, to), rate: sound.rate }, from, to };
}

/**
 * How loud a sound is: the root mean square of its 50 ms windows that are louder than -50 dB (so
 * pauses within it don't count), in dB. -Infinity for silence.
 */
export function loudness(sound: Sound): number {
  const window = Math.max(1, Math.round(sound.rate / 20));
  let sum = 0;
  let counted = 0;
  for (let start = 0; start < sound.samples.length; start += window) {
    let squares = 0;
    const end = Math.min(start + window, sound.samples.length);
    for (let index = start; index < end; index++) squares += (sound.samples[index] as number) ** 2;
    const rms = Math.sqrt(squares / Math.max(1, end - start));
    if (decibels(rms) > -50) {
      sum += squares;
      counted += end - start;
    }
  }
  return counted ? decibels(Math.sqrt(sum / counted)) : Number.NEGATIVE_INFINITY;
}

/** The highest sample level, in dB. */
export function peak(sound: Sound): number {
  let highest = 0;
  for (const sample of sound.samples) highest = Math.max(highest, Math.abs(sample));
  return decibels(highest);
}

/**
 * The sound made `target` dB loud with one gain for the whole of it, so a whisper stays a whisper
 * beside a shout, its peaks held under `ceiling` dB.
 */
export function leveled(sound: Sound, target: number, ceiling = -3): Sound {
  const now = loudness(sound);
  if (!Number.isFinite(now)) return sound;
  let gain = target - now;
  const top = peak(sound);
  if (top + gain > ceiling) gain = ceiling - top;
  const factor = 10 ** (gain / 20);
  const samples = new Float32Array(sound.samples.length);
  for (let index = 0; index < samples.length; index++)
    samples[index] = (sound.samples[index] as number) * factor;
  return { samples, rate: sound.rate };
}

/** Sounds one after another, at the rate of the first (the others brought to it). */
export function joined(sounds: readonly Sound[], rate = sounds[0]?.rate ?? 24000): Sound {
  const parts = sounds.map((sound) => resample(sound, rate));
  const samples = new Float32Array(parts.reduce((sum, part) => sum + part.samples.length, 0));
  let at = 0;
  for (const part of parts) {
    samples.set(part.samples, at);
    at += part.samples.length;
  }
  return { samples, rate };
}

/** How long a sound lasts, in milliseconds. */
export const lengthMs = (sound: Sound) => (sound.samples.length / sound.rate) * 1000;
