/**
 * Casting: a voice for each character, from those a service offers. A first casting is made for
 * the writer to change: the narrator gets a voice made for telling stories where there is one,
 * each character a voice of their own, of the gender the cast's words suggest (`Mrs.`, `she`,
 * `the old king`), in the story's language where the service says.
 */
import type { Story } from "voxdown";
import type { Voice } from "./adapter";

/** A voice for each character, by their name in the story: the voice's id, or its name. */
export type Casting = Record<string, string>;

/** Who needs a voice: everyone the story gives words or sounds to, the narrator first. */
export function speakersOf(
  story: Story,
  speakers: Iterable<string>,
): Array<{
  name: string;
  words: string;
}> {
  const seen = new Set<string>();
  const out: Array<{ name: string; words: string }> = [];
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const member = story.cast.find((other) => other.handle.toLowerCase() === key);
    out.push({
      name,
      words: [member?.name, member?.about].filter(Boolean).join(". ") || name,
    });
  };
  add(story.meta.narrator);
  for (const name of speakers) add(name);
  return out;
}

/** The gender a character's description suggests, if it does. */
export function genderOf(words: string): "female" | "male" | undefined {
  const female =
    /\b(she|her|hers|herself|woman|women|girl|lady|mother|mum|mom|mama|grandmother|granny|aunt|queen|princess|duchess|wife|daughter|sister|widow|witch|mrs|miss|ms|madam|madame|sra|frau|mme)\b/i;
  const male =
    /\b(he|him|his|himself|man|men|boy|gentleman|father|dad|papa|grandfather|grandpa|uncle|king|prince|duke|husband|son|brother|widower|wizard|mr|sir|lord|monsieur|herr|sr)\b/i;
  // `fisherwoman`, `washerwoman`; `fisherman`, `ferryman`, but not `human` or `German`.
  const isFemale = female.test(words) || /\w+wom[ae]n\b/i.test(words);
  const rest = words.replace(/\w*wom[ae]n\b/gi, "");
  const isMale = male.test(rest) || /\b\w+(?<!hu|ger|ro|wo|shaman|o)m[ae]n\b/i.test(rest);
  if (isFemale && !isMale) return "female";
  if (isMale && !isFemale) return "male";
  return undefined;
}

const fits = (voice: Voice, language: string | undefined) =>
  !language ||
  !voice.language ||
  voice.language.toLowerCase().startsWith(language.slice(0, 2).toLowerCase());

/**
 * A first casting: keeps what `kept` already gives, and gives everyone else a voice of their own
 * while there are voices left (then voices are shared, the narrator's last).
 */
export function castVoices(
  people: ReadonlyArray<{ name: string; words: string }>,
  voices: readonly Voice[],
  options: { language?: string; kept?: Casting } = {},
): Casting {
  const casting: Casting = {};
  const known = new Map(
    voices.flatMap(
      (voice) =>
        [
          [voice.id, voice],
          [voice.name, voice],
        ] as const,
    ),
  );
  const used = new Set<string>();
  for (const [name, voice] of Object.entries(options.kept ?? {})) {
    casting[name] = voice;
    used.add(known.get(voice)?.id ?? voice);
  }
  const suited = voices.filter((voice) => fits(voice, options.language));
  const pool = suited.length ? suited : [...voices];
  const narration = /narrat|storytell|audiobook|calm|warm/i;
  // Characters whose words say no gender are given voices of both, by turns.
  const genders = { female: 0, male: 0 };
  for (const [index, person] of people.entries()) {
    if (casting[person.name]) continue;
    const said = genderOf(person.words);
    const gender =
      said ?? (index === 0 ? undefined : genders.female <= genders.male ? "female" : "male");
    const free = pool.filter((voice) => !used.has(voice.id));
    const ranked = (candidates: Voice[]) =>
      [...candidates].sort((a, b) => {
        const score = (voice: Voice) =>
          (gender && voice.gender === gender ? (said ? 3 : 1.5) : 0) +
          (index === 0 && narration.test(voice.description ?? "") ? 1 : 0) +
          (voice.quality ?? 0.5) +
          // The story's own accent where the service has it: en-GB voices for an en-GB story.
          (options.language && voice.language?.toLowerCase() === options.language.toLowerCase()
            ? 0.5
            : 0);
        return score(b) - score(a);
      });
    const choice =
      ranked(
        free.length ? free : pool.filter((voice) => voice.id !== casting[people[0]?.name ?? ""]),
      )[0] ?? pool[0];
    if (!choice) continue;
    if (choice.gender === "female" || choice.gender === "male") genders[choice.gender]++;
    casting[person.name] =
      choice.name && pool.filter((voice) => voice.name === choice.name).length === 1
        ? choice.name
        : choice.id;
    used.add(choice.id);
  }
  return casting;
}

/** A casting's voice as the service's id: given as an id, or by a voice's name. */
export function voiceId(voices: readonly Voice[], given: string): string | undefined {
  return (
    voices.find((voice) => voice.id === given)?.id ??
    voices.find((voice) => voice.name.toLowerCase() === given.toLowerCase())?.id ??
    voices.find((voice) => voice.name.toLowerCase().split(/\s+[-–—]\s+/)[0] === given.toLowerCase())
      ?.id
  );
}
