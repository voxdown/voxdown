import { type FountainElement, parseFountain } from "./fountain";
import { fountainRuns } from "./inline";

export const MAX_PRACTICE_LENGTH = 5_000;
export const PRACTICE_LESSONS = [
  {
    title: "Set the scene",
    instruction:
      "Type a scene heading: INT. for inside or EXT. for outside, then a place and a time. Your own location is welcome.",
    starter: "",
    example: "INT. LIGHTHOUSE - NIGHT",
    hint: "Start a line with INT. or EXT. and add a location. For an unusual heading, a leading period can force it: .UNDER THE SEA",
    success: "This is a scene heading. It tells the reader where the scene happens.",
  },
  {
    title: "Show an action",
    instruction:
      "Keep a blank line after the heading and write something the audience can see or hear. Ordinary sentences become action.",
    starter: "INT. LIGHTHOUSE - NIGHT\n\n",
    example: "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.",
    hint: "Below the heading, leave a blank line and describe an action. Try a sentence such as A light moves across the water.",
    success:
      "The heading and action are separate elements. Blank lines help Fountain recognize the next element.",
  },
  {
    title: "Give someone a voice",
    instruction:
      "After a blank line, type a character name in capitals, then their speech directly underneath. Do not leave a blank line between the name and speech. @ can force a mixed-case name.",
    starter: "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.\n\n",
    example:
      "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.\n\nMARA\nSomeone is out there.",
    hint: "Put a name and speech on consecutive lines: MARA, then Someone is out there. Use @Mara if you prefer mixed case.",
    success:
      "Fountain recognizes a character cue followed by spoken dialogue. A blank line ends that speech.",
  },
  {
    title: "Add a brief direction",
    instruction:
      "Insert a short direction in parentheses between MARA and her speech. Keep it on its own line, with no blank lines inside the speech.",
    starter: "MARA\nSomeone is out there.",
    example: "MARA\n(quietly)\nSomeone is out there.",
    hint: "Put a direction such as (quietly) between the character name and spoken words. Parentheses in ordinary action are not speech directions.",
    success:
      "That direction is a parenthetical inside the speech. The words after it remain dialogue.",
  },
  {
    title: "Keep a note off the page",
    instruction:
      "Add a reminder between [[ and ]]. Close both brackets. The note stays in Fountain source but is omitted from the screenplay preview below.",
    starter: "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.\n\n",
    example:
      "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.\n\n[[Check the lighthouse timetable.]]",
    hint: "Add a nonempty [[reminder]] and close it with ]]. Keep the public action too, so you can see the note disappear from the preview.",
    success:
      "The completed note is absent from the preview. It stays in your Fountain file; sharing that source also shares its notes.",
  },
  {
    title: "Let two voices overlap (optional)",
    instruction:
      "These two speeches follow each other. Add ^ after JONAH on the character line to pair them as simultaneous dialogue.",
    starter: "MARA\nI saw it.\n\nJONAH\nSo did I.",
    example: "MARA\nI saw it.\n\nJONAH ^\nSo did I.",
    hint: "Add ^ at the end of the second character cue. Both characters need spoken lines, with a blank line between the two speeches.",
    success:
      "The second cue links these two speeches as dual dialogue. Page preview shows them in two columns; this practice preview only labels them.",
  },
] as const;
export interface PracticeAssessment {
  complete: boolean;
  message: string;
  preview: { label: string; text: string }[];
  shortened: boolean;
  privatePassages: number;
}
const plain = (value: string) =>
  fountainRuns(value)
    .map((run) => run.text)
    .join("");
const labels: Record<string, string> = {
  scene: "Scene heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
  centered: "Centered action",
  lyric: "Lyric",
};

/** Small, pure exercises. The source is scratch text, never the real screenplay. */
export function assessPractice(lesson: number, source: string): PracticeAssessment {
  const result: PracticeAssessment = {
    complete: false,
    message: "",
    preview: [],
    shortened: false,
    privatePassages: 0,
  };
  const exercise = PRACTICE_LESSONS[lesson];
  if (!Number.isInteger(lesson) || !exercise)
    return { ...result, message: "Choose a practice lesson." };
  if (source.length > MAX_PRACTICE_LENGTH)
    return {
      ...result,
      message: "Keep this practice under 5,000 characters. Your screenplay is separate.",
    };
  if (source.includes("\0"))
    return { ...result, message: "Use ordinary text for this practice; remove the NUL character." };
  const document = parseFountain(source);
  if (document.warnings.length)
    return {
      ...result,
      message:
        "A private comment is unfinished. Close [[notes]] with ]] or /* omitted passages */ with */ before checking the preview.",
    };
  for (const span of document.omissions) {
    const inner = source.slice(span.from + 2, span.to - 2);
    for (const match of inner.matchAll(/\[\[|\/\*/g)) {
      let slashes = 0;
      for (let at = match.index - 1; at >= 0 && inner[at] === "\\"; at--) slashes++;
      if (slashes % 2 === 0)
        return {
          ...result,
          message:
            "Private comments do not nest. Use one pair of opening and closing delimiters for each note.",
        };
    }
  }
  result.privatePassages = document.omissions.length;
  const visible = document.elements.filter(
    (element) => labels[element.kind] && plain(element.text).trim(),
  );
  result.preview = visible.slice(0, 12).map((element) => ({
    label: element.dual ? "Character · dual cue" : (labels[element.kind] as string),
    text: plain(element.text).slice(0, 200),
  }));
  result.shortened =
    visible.length > 12 || visible.some((element) => plain(element.text).length > 200);
  const filtered = document.elements.filter(
    (element) => element.kind !== "note" && element.kind !== "boneyard",
  );
  const speeches: { cue: FountainElement; body: FountainElement[]; from: number; to: number }[] =
    [];
  for (let i = 0; i < filtered.length; i++) {
    const cue = filtered[i];
    if (cue?.kind !== "character") continue;
    let end = i + 1;
    const body: FountainElement[] = [];
    while (
      filtered[end] &&
      ["dialogue", "parenthetical", "lyric"].includes((filtered[end] as FountainElement).kind)
    )
      body.push(filtered[end++] as FountainElement);
    speeches.push({ cue, body, from: i, to: end });
  }
  const spoken = (body: FountainElement[]) =>
    body.some((e) => e.kind === "dialogue" && plain(e.text).trim());
  if (lesson === 0)
    result.complete = visible.some(
      (e) =>
        e.kind === "scene" &&
        plain(e.text)
          .replace(/^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)(?:\.|(?=\s|$))\s*/i, "")
          .split(/\s+[-–—]\s+|^[-–—]/)[0]
          ?.trim().length,
    );
  if (lesson === 1) {
    const scene = visible.findIndex((e) => e.kind === "scene");
    result.complete = scene >= 0 && visible.slice(scene + 1).some((e) => e.kind === "action");
  }
  if (lesson === 2) result.complete = speeches.some((s) => spoken(s.body));
  if (lesson === 3)
    result.complete = speeches.some((s) =>
      s.body.some(
        (e, i) =>
          e.kind === "parenthetical" &&
          plain(e.text).slice(1, -1).trim() &&
          spoken(s.body.slice(i + 1)),
      ),
    );
  if (lesson === 4)
    result.complete =
      visible.some((e) => e.kind === "action" || e.kind === "dialogue") &&
      document.omissions.some(
        (span) => span.kind === "note" && source.slice(span.from + 2, span.to - 2).trim(),
      );
  if (lesson === 5)
    result.complete = speeches.some((right, i) => {
      const left = speeches[i - 1];
      return (
        left &&
        !left.cue.dual &&
        right.cue.dual &&
        spoken(left.body) &&
        spoken(right.body) &&
        plain(left.cue.text).toLocaleUpperCase() !== plain(right.cue.text).toLocaleUpperCase() &&
        filtered.slice(left.to, right.from).every((e) => e.kind === "blank")
      );
    });
  result.message = result.complete ? exercise.success : exercise.hint;
  return result;
}
