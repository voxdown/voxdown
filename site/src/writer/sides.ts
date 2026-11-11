/**
 * Sides, as a performer is given them: each character's lines in order, each with its cue (the
 * last words of the line before, and who says it) and how it is said; as text, or as pages to
 * print, one character to a page.
 */
import { type Story, lines, textByCharacter } from "voxdown";

export type Side = {
  name: string;
  lines: Array<{
    cue?: { words: string; speaker: string };
    direction?: string;
    text: string;
    /** A sound the character makes, not words. */
    vocal: boolean;
  }>;
};

export function sidesOf(of: Story): Side[] {
  const said = lines(of).filter((line) => line.kind === "speech" || line.kind === "vocal");
  return [...textByCharacter(of).keys()].map((name) => ({
    name,
    lines: said.flatMap((line, index) => {
      if (line.speaker !== name) return [];
      const before = said[index - 1];
      const cue =
        before?.speaker && before.speaker !== name
          ? {
              words: before.text.split(/\s+/).filter(Boolean).slice(-8).join(" "),
              speaker: before.speaker,
            }
          : undefined;
      return [
        {
          ...(cue ? { cue } : {}),
          ...(line.direction ? { direction: line.direction } : {}),
          text: line.text,
          vocal: line.kind === "vocal",
        },
      ];
    }),
  }));
}

/** Sides as plain text, for a file. */
export function sidesText(of: Story): string {
  const parts = sidesOf(of).map((side) => {
    const out = [`== ${side.name} ==`, ""];
    for (const line of side.lines) {
      if (line.cue) out.push(`    …${line.cue.words} (${line.cue.speaker})`);
      const text = line.vocal ? `[${line.text}]` : line.text;
      out.push(`${side.name}${line.direction ? ` (${line.direction})` : ""}: ${text}`, "");
    }
    return out.join("\n");
  });
  return `${parts.join("\n\n")}\n`;
}

const escaped = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sides as pages to print: each character from a new page, the cues small and grey. */
export function sidesHtml(of: Story, title: string): string {
  const pages = sidesOf(of)
    .map(
      (side) =>
        `<section class="side"><h2>${escaped(side.name)}</h2>${side.lines
          .map(
            (line) =>
              `${line.cue ? `<p class="cue">…${escaped(line.cue.words)} <span>(${escaped(line.cue.speaker)})</span></p>` : ""}<p class="line"><b>${escaped(side.name)}</b>${line.direction ? ` <i>(${escaped(line.direction)})</i>` : ""} ${line.vocal ? `[${escaped(line.text)}]` : escaped(line.text)}</p>`,
          )
          .join("")}</section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escaped(title)}: sides</title><style>
body { font: 12pt/1.5 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
.side + .side { break-before: page; }
h2 { font: 600 15pt/1.2 system-ui, sans-serif; margin: 0 0 1em; }
.cue { color: #555; font-size: 10pt; margin: 1.2em 0 0.1em 2em; }
.cue span { font-style: italic; }
.line { margin: 0 0 0.6em; break-inside: avoid; }
.line b { font: 600 10.5pt system-ui, sans-serif; letter-spacing: 0.03em; text-transform: uppercase; }
.line i { color: #444; }
</style></head><body>${pages}</body></html>`;
}
