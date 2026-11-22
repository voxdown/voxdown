/** The music of an abcjs parse, for comparing tunes by what they play and show, not bytes. */
// biome-ignore lint/suspicious/noExplicitAny: abcjs's parse has no published types.
type Any = any;

const STEP_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
const ALTER: Record<string, number> = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
/** Synonyms that mean the same mark. */
const SAME: Record<string, string> = {
  "<(": "crescendo(",
  "<)": "crescendo)",
  ">(": "diminuendo(",
  ">)": "diminuendo)",
  roll: "irishroll",
  emphasis: "accent",
  ">": "accent",
  mordent: "lowermordent",
  pralltriller: "uppermordent",
  dacapo: "D.C.",
  umarcato: "marcato",
};

export type Music = {
  voices: {
    events: string[];
    bars: number;
    repeats: string[];
    lyrics: string[][];
  }[];
  title: string;
};

export function musicOf(tune: Any): Music {
  const voices = new Map<string, { elements: Any[]; key: Any; clef: Any }>();
  for (const line of tune.lines ?? []) {
    for (const [staffIndex, staff] of (line.staff ?? []).entries())
      for (const [voiceIndex, voice] of (staff.voices ?? []).entries()) {
        const id = `${staffIndex}.${voiceIndex}`;
        const entry = voices.get(id) ?? { elements: [], key: staff.key, clef: staff.clef };
        entry.elements.push(...voice);
        voices.set(id, entry);
      }
  }
  const result: Music["voices"] = [];
  for (const { elements, key, clef } of voices.values()) {
    // Pitches as heard: an octave clef, or else transpose= on the voice, moves them.
    const transpose = Number(clef?.transpose ?? 0);
    const shiftOf = (each: Any) => {
      const octave = /([-+])8$/.exec(String(each?.type ?? ""));
      return octave ? (octave[1] === "-" ? -12 : 12) : transpose;
    };
    let shift = shiftOf(clef);
    let keyAlters: Record<string, number> = {};
    const setKey = (k: Any) => {
      keyAlters = {};
      for (const accidental of k?.accidentals ?? [])
        keyAlters[String(accidental.note).toUpperCase()] = ALTER[accidental.acc] ?? 0;
    };
    setKey(key);
    let bar = new Map<number, number>();
    let multiplier = 1;
    let left = 0;
    const events: string[] = [];
    const repeats: string[] = [];
    const lyrics: string[][] = [];
    let bars = 0;
    let pendingNotes = false;
    for (const element of elements) {
      if (element.el_type === "key") setKey(element);
      if (element.el_type === "clef") shift = shiftOf(element);
      if (element.el_type === "bar") {
        bar = new Map();
        if (pendingNotes) bars += 1;
        pendingNotes = false;
        const kind = /repeat/.test(element.type) ? element.type : "";
        const ending = element.startEnding ? `[${element.startEnding}` : "";
        if (kind || ending) repeats.push(`${kind}${ending}`);
        continue;
      }
      if (element.el_type !== "note") continue;
      if (element.rest?.type === "spacer") continue;
      if (element.startTriplet) {
        multiplier = element.tripletMultiplier ?? 1;
        left = element.tripletR ?? element.startTriplet;
      }
      const length = Number(element.duration ?? 0) * (left > 0 ? multiplier : 1);
      if (left > 0) left -= 1;
      const rounded = Math.round(length * 3840);
      const pitches = element.rest
        ? [
            element.rest.type === "multimeasure"
              ? `Z${element.rest.text}`
              : element.rest.type === "invisible"
                ? "x"
                : "z",
          ]
        : (element.pitches ?? [])
            .map((pitch: Any) => {
              const place = pitch.pitch as number;
              const step = ((place % 7) + 7) % 7;
              let alter: number;
              if (pitch.accidental && pitch.accidental in ALTER) {
                alter = ALTER[pitch.accidental] as number;
                bar.set(place, alter);
              } else alter = bar.get(place) ?? keyAlters["CDEFGAB"[step] as string] ?? 0;
              return String(
                60 + 12 * Math.floor(place / 7) + (STEP_SEMITONE[step] as number) + alter + shift,
              );
            })
            .sort();
      const graces = (element.gracenotes ?? []).map((grace: Any) => `g${grace.pitch}`).join("");
      const marks = (element.decoration ?? []).map((name: string) => SAME[name] ?? name).sort();
      const chords = (element.chord ?? [])
        .flatMap((chord: Any) =>
          String(chord.name)
            .split("\n")
            .map(
              (name: string) =>
                `${chord.position === "default" || !chord.position ? "" : chord.position[0]}"${name}"`,
            ),
        )
        .sort();
      const ties = (element.pitches ?? []).some((pitch: Any) => pitch.startTie) ? "-" : "";
      const slurs = (element.pitches ?? []).reduce(
        (sum: number, pitch: Any) =>
          sum + (pitch.startSlur?.length ?? 0) * 10 + (pitch.endSlur?.length ?? 0),
        0,
      );
      events.push(
        `${pitches.join("+")}:${rounded}${ties}${graces ? `{${graces}}` : ""}${marks.length ? `!${marks.join("!")}` : ""}${chords.join("")}${slurs ? `(${slurs})` : ""}`,
      );
      if (!element.rest || element.rest.type !== "invisible") pendingNotes = true;
      (element.lyric ?? []).forEach((lyric: Any, verse: number) => {
        lyrics[verse] ??= [];
        if (lyric?.syllable)
          (lyrics[verse] as string[]).push(`${lyric.syllable}${lyric.divider === "-" ? "-" : ""}`);
      });
    }
    if (pendingNotes) bars += 1;
    result.push({ events, bars, repeats, lyrics });
  }
  return { voices: result, title: String(tune.metaText?.title ?? "") };
}
