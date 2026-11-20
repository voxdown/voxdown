import { fieldOf } from "./abc";

/** One tune in a file: from its X: line to just before the next X: line (or the end). */
export type TuneInfo = {
  index: number;
  from: number;
  to: number;
  /** End of the K: line, where the body begins; equal to `to` while the header is unfinished. */
  bodyFrom: number;
  number: string;
  title: string;
  subtitle: string;
  key: string;
  meter: string;
  unit: string;
  tempo: string;
  composer: string;
  rhythm: string;
  voices: VoiceInfo[];
  parts: { label: string; from: number }[];
};
export type VoiceInfo = { id: string; name: string; from: number };

export type FileIndex = {
  /** Fields before the first X:, which apply to every tune (ABC 2.1 §2.2.2). */
  header: { from: number; to: number } | null;
  tunes: TuneInfo[];
};

/** Scans the file's line starts only; cheap enough to run on every edit. */
export function indexFile(text: string): FileIndex {
  const tunes: TuneInfo[] = [];
  let current: TuneInfo | null = null;
  let position = 0;
  let firstTune = -1;
  const lines = text.split("\n");
  for (const line of lines) {
    const from = position;
    position += line.length + 1;
    const field = fieldOf(line);
    if (field?.key === "X") {
      if (current) current.to = from;
      if (firstTune < 0) firstTune = from;
      current = {
        index: tunes.length,
        from,
        to: text.length,
        bodyFrom: -1,
        number: field.value.trim(),
        title: "",
        subtitle: "",
        key: "",
        meter: "",
        unit: "",
        tempo: "",
        composer: "",
        rhythm: "",
        voices: [],
        parts: [],
      };
      tunes.push(current);
      continue;
    }
    if (!current || !field) continue;
    const value = field.value.replace(/\s%.*$/, "").trim();
    const inHeader = current.bodyFrom < 0;
    switch (field.key) {
      case "T":
        if (!current.title) current.title = value;
        else if (inHeader && !current.subtitle) current.subtitle = value;
        break;
      case "K":
        if (inHeader) {
          current.key = value;
          current.bodyFrom = Math.min(position, text.length);
        }
        break;
      case "M":
        if (inHeader) current.meter = value;
        break;
      case "L":
        if (inHeader) current.unit = value;
        break;
      case "Q":
        if (inHeader) current.tempo = value;
        break;
      case "C":
        if (inHeader && !current.composer) current.composer = value;
        break;
      case "R":
        if (inHeader) current.rhythm = value;
        break;
      case "P":
        if (!inHeader) current.parts.push({ label: value, from });
        break;
      case "V": {
        const id = value.split(/\s+/)[0] ?? "";
        if (id && !current.voices.some((voice) => voice.id === id)) {
          const name =
            /\b(?:name|nm)\s*=\s*"([^"]*)"/.exec(value)?.[1] ??
            /\b(?:name|nm)\s*=\s*(\S+)/.exec(value)?.[1] ??
            "";
          current.voices.push({ id, name, from });
        }
        break;
      }
    }
  }
  for (const tune of tunes) if (tune.bodyFrom < 0) tune.bodyFrom = tune.to;
  const header =
    firstTune > 0 && /^[A-Za-z]:|^%%/m.test(text.slice(0, firstTune))
      ? { from: 0, to: firstTune }
      : null;
  return { header, tunes };
}

export function tuneAt(index: FileIndex, position: number): TuneInfo | null {
  let found: TuneInfo | null = null;
  for (const tune of index.tunes) {
    if (tune.from <= position) found = tune;
    else break;
  }
  return found ?? index.tunes[0] ?? null;
}

/** A tune's name for lists: "1. The Kesh" or "Untitled tune". */
export function tuneLabel(tune: TuneInfo): string {
  return tune.title || (tune.number ? `Tune ${tune.number}` : "Untitled tune");
}

export function nextTuneNumber(index: FileIndex): number {
  let highest = 0;
  for (const tune of index.tunes) {
    const number = Number.parseInt(tune.number, 10);
    if (Number.isFinite(number)) highest = Math.max(highest, number);
  }
  return highest + 1;
}
