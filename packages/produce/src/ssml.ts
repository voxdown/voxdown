/**
 * SSML (W3C Speech Synthesis Markup Language 1.1), as Azure, Google and Amazon read it: a
 * chapter as one document, each line in its character's voice, directions as Azure's speaking
 * styles where one fits, pauses as breaks. For tools that take SSML files, and for the Azure
 * adapter, which sends a line at a time.
 */
import type { ProductionLine, ProductionScript } from "./script";

/** Text for XML. */
export const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Azure's speaking styles, by words a direction may use. The first that matches is taken. */
const STYLES: ReadonlyArray<[RegExp, string]> = [
  [/whisper|hush|under (his|her|their) breath|sotto/i, "whispering"],
  [/shout|yell|bellow|roar|scream/i, "shouting"],
  [/terrif|panic|horrif/i, "terrified"],
  [/fear|scared|afraid|nervous|trembl/i, "fearful"],
  [/angr|furious|fierce|snap|irritat|cross/i, "angry"],
  [/sad|sorrow|tearful|grie|mourn|weep|sob/i, "sad"],
  [/excit|eager|thrill/i, "excited"],
  [/cheer|happ|joy|bright|delight|merr/i, "cheerful"],
  [/hope/i, "hopeful"],
  [/soft|gentl|tender|kind|warm|sooth/i, "gentle"],
  [/calm|quiet|even|steady|relax/i, "calm"],
  [/friendl/i, "friendly"],
  [/serious|grave|stern|firm/i, "serious"],
  [/embarrass|sheepish|awkward/i, "embarrassed"],
  [/disgust|contempt|scorn/i, "disgruntled"],
  [/unfriendl|cold|icy/i, "unfriendly"],
  [/affection|loving|fond/i, "affectionate"],
  [/sympath|empath|consol/i, "empathetic"],
  [/lyric|sing-?song|poetic/i, "lyrical"],
];

/** Azure's speaking style nearest a direction, if one is near. */
export function styleFor(direction: string | null): string | undefined {
  if (!direction) return undefined;
  return STYLES.find(([pattern]) => pattern.test(direction))?.[1];
}

/** One line as SSML inside a `<voice>`. */
export function lineSsml(text: string, direction: string | null): string {
  const style = styleFor(direction);
  return style ? `<mstts:express-as style="${style}">${xml(text)}</mstts:express-as>` : xml(text);
}

/** A whole SSML document for one line, as Azure's REST API takes it. */
export function ssmlDocument(
  voice: string,
  text: string,
  direction: string | null,
  language = "en-US",
): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${xml(language)}"><voice name="${xml(voice)}">${lineSsml(text, direction)}</voice></speak>`;
}

/** Silence after a line, in ms, by what follows it. */
export const GAPS: Record<ProductionLine["next"], number> = {
  part: 250,
  line: 450,
  paragraph: 800,
  heading: 1100,
  scene: 1500,
  chapter: 0,
  end: 0,
};

/**
 * A chapter as one SSML document: each speech in its voice (`casting` by speaker), breaks between
 * lines as the pacing has them, pauses as breaks. Sounds and page turns are left as comments.
 */
export function chapterSsml(
  script: ProductionScript,
  chapter: number,
  casting: Record<string, string>,
): string {
  const language = script.language ?? "en-US";
  const parts: string[] = [];
  for (const line of script.lines) {
    if (line.chapter !== chapter) continue;
    const gap = GAPS[line.next];
    if (line.kind === "speech") {
      const voice = casting[line.speaker ?? script.narrator] ?? casting[script.narrator] ?? "";
      parts.push(
        `<voice name="${xml(voice)}">${lineSsml(line.text, line.direction)}${gap ? `<break time="${gap}ms"/>` : ""}</voice>`,
      );
    } else if (line.kind === "pause") {
      parts.push(
        `<voice name="${xml(casting[script.narrator] ?? "")}"><break time="${line.ms ?? 1000}ms"/></voice>`,
      );
    } else if (line.kind === "sound" || line.kind === "vocal") {
      parts.push(
        `<!-- ${line.kind === "vocal" ? `${line.speaker}: ` : ""}[${xml(line.text).replace(/--/g, "–")}] -->`,
      );
    } else if (line.kind === "page") {
      parts.push("<!-- page turn -->");
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${xml(language)}">
${parts.join("\n")}
</speak>
`;
}
