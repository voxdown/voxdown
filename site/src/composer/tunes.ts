import { fieldOf, lineKind, tokenizeMusic } from "./abc";

/**
 * One tune in a file: from its X: line to its first blank line after the header (where abcjs, as
 * ABC 2.1 says, ends it), or else to the next X: line or the end.
 */
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

/** Music outside every tune: after a blank line ended the tune above, or before the first X:. */
export type Orphan = {
  from: number;
  to: number;
  /** The tune a blank line ended, or null before the first X:. */
  tune: TuneInfo | null;
  /** The blank lines between that tune and this music, when nothing else is between. */
  blank: { from: number; to: number } | null;
};

export type FileIndex = {
  /** Fields before the first X:, which apply to every tune (ABC 2.1 §2.2.2). */
  header: { from: number; to: number } | null;
  tunes: TuneInfo[];
  orphans: Orphan[];
};

/** A line that reads as music (notes, no stray words), or lyrics, or a voice line. */
function looksLikeMusic(line: string): boolean {
  const kind = lineKind(line, true);
  if (kind === "lyrics") return true;
  if (kind === "field") return /^[VP]:/.test(line);
  if (kind !== "music") return false;
  const tokens = tokenizeMusic(line);
  return (
    tokens.some((token) => token.kind === "note") &&
    !tokens.some((token) => token.kind === "unknown")
  );
}

/** Scans the file's line starts only; cheap enough to run on every edit. */
export function indexFile(text: string): FileIndex {
  const tunes: TuneInfo[] = [];
  const orphans: Orphan[] = [];
  let current: TuneInfo | null = null;
  /** Set once a blank line has ended the current tune. */
  let ended = false;
  let blank: { from: number; to: number } | null = null;
  let position = 0;
  let firstTune = -1;
  const lines = text.split("\n");
  for (const line of lines) {
    const from = position;
    position += line.length + 1;
    const field = fieldOf(line);
    if (field?.key !== "X" && (ended || !current)) {
      // Outside every tune: note music that abcjs will not draw.
      if (!line.trim()) {
        if (ended && blank && blank.to === from) blank.to = Math.min(position, text.length);
        continue;
      }
      if (!looksLikeMusic(line)) {
        blank = null;
        continue;
      }
      const last = orphans[orphans.length - 1];
      if (
        last &&
        text.slice(last.to, from).trim() === "" &&
        !text.slice(last.to, from).includes("\n\n")
      )
        last.to = from + line.length;
      else
        orphans.push({
          from,
          to: from + line.length,
          tune: ended ? current : null,
          blank: ended && blank && blank.to === from ? { ...blank } : null,
        });
      blank = null;
      continue;
    }
    if (current && !ended && current.bodyFrom >= 0 && !line.trim() && field?.key !== "X") {
      current.to = from;
      ended = true;
      blank = { from, to: Math.min(position, text.length) };
      continue;
    }
    if (field?.key === "X") {
      if (current && !ended) current.to = from;
      ended = false;
      blank = null;
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
  return { header, tunes, orphans };
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

/** The voice in force at a position: the last `V:` line or inline `[V:…]` before it. */
export function voiceAt(text: string, position: number): string {
  const before = text.slice(0, position);
  const found = [...before.matchAll(/^V:\s*(\S+)|\[V:\s*([^\]\s]+)/gm)].at(-1);
  return found ? (found[1] ?? found[2] ?? "") : "";
}
