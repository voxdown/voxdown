/**
 * Music copied in Composer remembers where it came from (its unit, key and meter). Pasted into a
 * place with another unit or key, its lengths are rewritten for the new unit and its notes spelled
 * for the new key, so it sounds as it did: a bar from `L:1/8 K:D` pasted under `L:1/4 K:C` keeps
 * its eighth notes and its F♯s. Music from outside Composer is pasted as it is.
 */
import {
  type Fraction,
  type Key,
  accidentalText,
  accidentalValue,
  alterationOf,
  formatLength,
  frac,
  mul,
  parseLength,
  staffPlace,
  tokenizeMusic,
} from "./abc";

/** Where a copy came from: the unit and key in force at its start. */
export type ClipSource = { unit: Fraction; key: Key; meter: string };

const sameKey = (a: Key, b: Key) =>
  Object.keys({ ...a.accidentals, ...b.accidentals }).every(
    (letter) => (a.accidentals[letter] ?? 0) === (b.accidentals[letter] ?? 0),
  );

/** How a key is written after K: ("D", "Am", "G Dorian" as "Gdor"). */
export function keyLabel(key: Key): string {
  if (!key.tonic) return "none";
  return `${key.tonic}${key.mode === "maj" ? "" : key.mode}`;
}

/**
 * The copy rewritten for a place with this unit and key (with the accidentals already written in
 * its bar there). Lines that aren't music (a `V:` line) are left as they are.
 */
export function convertClip(
  clip: string,
  source: ClipSource,
  target: { unit: Fraction; key: Key; bar: Map<string, number> },
): { text: string; lengths: boolean; accidentals: boolean } {
  const ratio = mul(source.unit, frac(target.unit.den, target.unit.num));
  const rescale = ratio.num !== ratio.den;
  const respell = !sameKey(source.key, target.key);
  if (!rescale && !respell) return { text: clip, lengths: false, accidentals: false };
  let fromBar = new Map<string, number>();
  let toBar = new Map(target.bar);
  let accidentals = false;
  const scaled = (length: string) => formatLength(mul(parseLength(length), ratio));
  const lines = clip.split("\n").map((line) => {
    if (/^[A-Za-z]:/.test(line) || line.startsWith("%")) return line;
    const tokens = tokenizeMusic(line, 0);
    let out = "";
    let at = 0;
    let innerLengths = false;
    const write = (from: number, to: number, text: string) => {
      out += line.slice(at, from) + text;
      at = to;
    };
    for (const token of tokens) {
      if (token.kind === "bar") {
        fromBar = new Map();
        toBar = new Map();
      } else if (token.kind === "chord-open") innerLengths = false;
      else if (token.kind === "note") {
        const { alter } = alterationOf(token, source.key, fromBar);
        const place = staffPlace(token.letter, token.octave);
        if (token.accidental && !token.inGrace) fromBar.set(place, alter);
        let accidental = token.accidental;
        if (respell) {
          const implied =
            toBar.get(place) ?? target.key.accidentals[token.letter.toUpperCase()] ?? 0;
          // A courtesy accidental that still says the same thing stays.
          const kept = token.accidental && accidentalValue(token.accidental) === alter;
          accidental = alter !== implied ? accidentalText(alter) : kept ? token.accidental : "";
          if (accidental !== token.accidental) accidentals = true;
          if (accidental && !token.inGrace) toBar.set(place, alter);
        }
        let length = token.length;
        if (rescale && (!token.inChord || token.length)) length = scaled(token.length);
        if (token.inChord && token.length) innerLengths = true;
        write(token.from, token.to, `${accidental}${token.letter}${token.octave}${length}`);
      } else if (token.kind === "rest" && rescale && /[zx]/.test(token.letter))
        write(token.from, token.to, `${token.letter}${scaled(token.length)}`);
      else if (token.kind === "chord-close" && rescale && token.text && !innerLengths)
        write(token.from, token.to, `]${scaled(token.length ?? "")}`);
    }
    return out + line.slice(at);
  });
  return { text: lines.join("\n"), lengths: rescale, accidentals };
}
