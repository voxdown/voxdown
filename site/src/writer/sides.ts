/**
 * Sides, as a performer is given them: each character's lines in order, scene by scene (its number
 * and the heading it comes under), each line with its cue (the last words of the line before in
 * the same scene, and who says it), how it is said, and where it is (its line in the file, and its
 * page); as text, or as pages to print, one character to a page.
 */
import { type Story, lines } from "voxdown";
import { railScenes } from "./rail";

export type SideLine = {
  cue?: { words: string; speaker: string };
  direction?: string;
  text: string;
  /** A sound the character makes, not words. */
  vocal: boolean;
  /** Where it is: its line in the file, and the page it is on ("" before the first). */
  line: number;
  page: string;
};

export type Side = {
  name: string;
  /** The character's lines, scene by scene. */
  scenes: Array<{ scene: number; title: string; lines: SideLine[] }>;
};

export function sidesOf(of: Story): Side[] {
  const all = lines(of);
  // Lines said, a heading read aloud aside: it names the scene, it isn't a line.
  const said = all.filter(
    (line) => (line.kind === "speech" || line.kind === "vocal") && line.heading === null,
  );
  const paged = all.some((line) => line.kind === "page");
  // Each heading's line, to name the scenes under it.
  const lineOf = (offset: number) => of.source.slice(0, offset).split("\n").length;
  const headings = railScenes(of, new Map())
    .filter((scene) => scene.name !== "Scene")
    .map((scene) => ({ line: lineOf(scene.from), name: scene.name }));
  const titleAt = (line: number) =>
    headings.filter((heading) => heading.line <= line).at(-1)?.name ?? "";
  const speakers = [...new Set(said.flatMap((line) => (line.speaker ? [line.speaker] : [])))];
  // The cast's order first, then the order they first speak in.
  const order = [
    ...of.cast.map((member) => member.handle).filter((handle) => speakers.includes(handle)),
    ...speakers.filter((speaker) => !of.cast.some((member) => member.handle === speaker)),
  ];
  return order.map((name) => {
    const scenes: Side["scenes"] = [];
    for (const [index, line] of said.entries()) {
      if (line.speaker !== name) continue;
      const before = said[index - 1];
      const cue =
        before?.speaker && before.speaker !== name && before.scene === line.scene
          ? {
              words: before.text.split(/\s+/).filter(Boolean).slice(-8).join(" "),
              speaker: before.speaker,
            }
          : undefined;
      let scene = scenes.at(-1);
      if (scene?.scene !== line.scene) {
        scene = { scene: line.scene, title: titleAt(line.line), lines: [] };
        scenes.push(scene);
      }
      scene.lines.push({
        ...(cue ? { cue } : {}),
        ...(line.direction ? { direction: line.direction } : {}),
        text: line.text,
        vocal: line.kind === "vocal",
        line: line.line,
        // Its page, where the story turns pages at all.
        page: paged ? line.page : "",
      });
    }
    return { name, scenes };
  });
}

/** Where a line is, as a performer finds it: `line 34, page 4`. */
const where = (line: SideLine) => `line ${line.line}${line.page ? `, page ${line.page}` : ""}`;
const heading = (scene: Side["scenes"][number]) =>
  `Scene ${scene.scene}${scene.title ? ` · ${scene.title}` : ""}`;

/** Sides as plain text, for a file. */
export function sidesText(of: Story): string {
  const parts = sidesOf(of).map((side) => {
    const out = [`== ${side.name} ==`, ""];
    for (const scene of side.scenes) {
      out.push(`-- ${heading(scene)} --`, "");
      for (const line of scene.lines) {
        if (line.cue) out.push(`    …${line.cue.words} (${line.cue.speaker})`);
        const text = line.vocal ? `[${line.text}]` : line.text;
        out.push(
          `${side.name}${line.direction ? ` (${line.direction})` : ""}: ${text}    [${where(line)}]`,
          "",
        );
      }
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
        `<section class="side"><h2>${escaped(side.name)}</h2>${side.scenes
          .map(
            (scene) =>
              `<h3>${escaped(heading(scene))}</h3>${scene.lines
                .map(
                  (line) =>
                    `${line.cue ? `<p class="cue">…${escaped(line.cue.words)} <span>(${escaped(line.cue.speaker)})</span></p>` : ""}<p class="line"><small>${escaped(where(line))}</small><b>${escaped(side.name)}</b>${line.direction ? ` <i>(${escaped(line.direction)})</i>` : ""} ${line.vocal ? `[${escaped(line.text)}]` : escaped(line.text)}</p>`,
                )
                .join("")}`,
          )
          .join("")}</section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escaped(title)}: sides</title><style>
body { font: 12pt/1.5 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
.side + .side { break-before: page; }
h2 { font: 600 15pt/1.2 system-ui, sans-serif; margin: 0 0 0.6em; }
h3 { font: 600 10pt/1.3 system-ui, sans-serif; color: #444; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.4em 0 0.4em; border-bottom: 1px solid #ccc; break-after: avoid; }
.cue { color: #555; font-size: 10pt; margin: 1em 0 0.1em 2em; break-after: avoid; }
.cue span { font-style: italic; }
.line { margin: 0 0 0.6em; break-inside: avoid; }
.line small { float: right; margin-left: 1em; color: #777; font: 8.5pt system-ui, sans-serif; }
.line b { font: 600 10.5pt system-ui, sans-serif; letter-spacing: 0.03em; text-transform: uppercase; }
.line i { color: #444; }
</style></head><body>${pages}</body></html>`;
}
