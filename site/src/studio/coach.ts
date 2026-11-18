import { arrangeDialogHeader } from "./dialog-layout";
import { type FountainKind, parseFountain } from "./fountain";

type Advice = { title: string; explanation: string; next: string; example: string };
const advice: Record<FountainKind, Advice> = {
  scene: {
    title: "Scene heading",
    explanation: "This establishes where and when the scene takes place.",
    next: "Leave a blank line, then describe what the audience can see or hear.",
    example: "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.",
  },
  action: {
    title: "Action",
    explanation: "This is a description of what happens on screen.",
    next: "For dialogue, leave a blank line, type a character name, then put their speech directly underneath.",
    example: "A light moves across the water.\n\nMARA\nSomeone is out there.",
  },
  character: {
    title: "Character cue",
    explanation:
      "This names the person who speaks next. @ forces a cue and allows mixed-case names.",
    next: "Press Enter once and write the speech. There is no blank line between a cue and its dialogue.",
    example: "@McClane\nI heard something.",
  },
  dialogue: {
    title: "Dialogue",
    explanation: "This speech belongs to the character cue above it.",
    next: "Leave a blank line before the next speaker or an action paragraph. Ctrl/⌘ Enter inserts that separation.",
    example: "MARA\nSomeone is out there.\n\nJONAH\nThen we leave the light on.",
  },
  parenthetical: {
    title: "Parenthetical",
    explanation: "This is a short performance direction inside a speech.",
    next: "Continue the dialogue on the next line. Keep directions brief so the words remain easy to perform.",
    example: "MARA\n(quietly)\nSomeone is out there.",
  },
  transition: {
    title: "Transition",
    explanation: "This describes a transition between scenes. A leading > can force this element.",
    next: "Leave a blank line before the next scene heading.",
    example: "CUT TO:\n\nEXT. HARBOR - DAWN",
  },
  centered: {
    title: "Centered text",
    explanation: "Text between > and < is centered on the printed page.",
    next: "Leave a blank line to return to an ordinary paragraph.",
    example: "> THE END <",
  },
  lyric: {
    title: "Lyric",
    explanation: "A leading ~ marks a lyric line.",
    next: "Start each additional lyric line with ~. Leave a blank line before the next paragraph.",
    example: "~Leave the light on\n~Until the morning comes",
  },
  section: {
    title: "Outline section",
    explanation: "A # heading organizes your outline and does not print in the screenplay.",
    next: "Use more # characters for a deeper section, or start the next scene after a blank line.",
    example: "# Act One\n\n## The arrival\n\nINT. LIGHTHOUSE - NIGHT",
  },
  synopsis: {
    title: "Synopsis",
    explanation:
      "A single = introduces an outline summary. It stays in the file but does not print.",
    next: "Use this for your scene intention; write the actual scene separately.",
    example: "= Mara notices a signal nobody else can see.",
  },
  note: {
    title: "Private note",
    explanation: "Completed [[notes]] stay in your Fountain file and are omitted from the PDF.",
    next: "Close the note with ]]. A blank line can interrupt an unfinished note; check Source diagnostics before export.",
    example: "[[Check the lighthouse timetable.]]",
  },
  boneyard: {
    title: "Omitted passage",
    explanation: "A completed /* passage */ stays in your file and is omitted from the PDF.",
    next: "Use */ to close it. An unfinished omission remains printable and blocks export until repaired.",
    example: "/* An earlier version of this scene. */",
  },
  "page-break": {
    title: "Page break",
    explanation: "A line of === starts a new printed page.",
    next: "Use Page preview to check the break. It does not lock later page numbers.",
    example: "===\n\nINT. LIGHTHOUSE - MORNING",
  },
  title: {
    title: "Title page",
    explanation: "Fields at the very start of the file describe its title page.",
    next: "Leave a blank line after the fields before the first scene. Title and Author are optional.",
    example: "Title: The Last Light\nAuthor: Your name\n\nINT. LIGHTHOUSE - NIGHT",
  },
  blank: {
    title: "A fresh paragraph",
    explanation:
      "Blank lines separate screenplay elements. You can write ordinary text without choosing a mode.",
    next: "Start a scene with INT. or EXT., describe an action, or type a character name followed immediately by dialogue.",
    example:
      "INT. LIGHTHOUSE - NIGHT\n\nA light moves across the water.\n\nMARA\nSomeone is out there.",
  },
};

/** On-demand interpretation of the exact current revision, never a stale worker result. */
export function explainFountainAt(
  source: string,
  position: number,
): Advice & { line: number; warnings: string[] } {
  const document = parseFountain(source);
  const offset = Math.max(
    0,
    Math.min(source.length, Number.isFinite(position) ? Math.floor(position) : 0),
  );
  const element = document.elements.find((item) => item.to >= offset) ?? document.elements.at(-1);
  const omission = document.omissions.find((item) => item.from <= offset && offset < item.to);
  const kind = omission?.kind ?? element?.kind ?? "blank";
  const line = element?.line ?? 1;
  return {
    ...advice[kind],
    line,
    warnings: document.warnings.filter((item) => item.line === line).map((item) => item.message),
  };
}

export function mountCoach(
  host: HTMLElement,
  current: () => { source: string; position: number },
  returnToWriting: () => void,
) {
  const dialog = document.createElement("dialog");
  dialog.className = "studio-coach";
  const heading = document.createElement("h2");
  heading.id = "studio-coach-title";
  dialog.setAttribute("aria-labelledby", heading.id);
  const explanation = document.createElement("p");
  const next = document.createElement("p");
  const warnings = document.createElement("p");
  const label = document.createElement("h3");
  label.textContent = "Example";
  const example = document.createElement("pre");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Back to writing";
  close.autofocus = true;
  close.onclick = () => dialog.close();
  dialog.append(heading, explanation, warnings, next, label, example, close);
  dialog.addEventListener("close", returnToWriting);
  arrangeDialogHeader(dialog, heading, close);
  host.append(dialog);
  return {
    open() {
      const value = current();
      const result = explainFountainAt(value.source, value.position);
      heading.textContent = `Line ${result.line}: ${result.title}`;
      explanation.textContent = result.explanation;
      next.textContent = result.next;
      warnings.textContent = result.warnings.join(" ");
      warnings.hidden = !result.warnings.length;
      example.textContent = result.example;
      dialog.showModal();
    },
  };
}
