/**
 * Exports beyond ABC and MusicXML: a tune as SVG, the whole file as one self-contained HTML tune
 * book, and MIDI or WAV for this tune or every tune (a .zip). Loaded the first time one is used.
 */
import { createDialog } from "./dialog";
import type { InstrumentId } from "./instruments";
import { download } from "./local-file";
import { writeMidi } from "./midi";
import { writeZip } from "./musicxml/zip";
import { applyPassDynamics, passMarks } from "./passes";
import { encodeWav, normalise } from "./player";
import { followOrder, hasJumps, playOrder, structureOf } from "./playorder";
import {
  type ScoreNote,
  drawPassDynamics,
  indexScore,
  loadAbcjs,
  prepareTune,
  scoreFormat,
  tuneSource,
} from "./score";
import { abcName } from "./source";
import { type Timeline, buildTimeline } from "./timeline";
import { type FileIndex, type TuneInfo, indexFile, tuneLabel } from "./tunes";

// biome-ignore lint/suspicious/noExplicitAny: abcjs's objects have no published types.
type Any = any;
type Abcjs = typeof import("abcjs");

const SVG_NS = "http://www.w3.org/2000/svg";

/* Names. */

/** A file name from a title, made safe, with an extension; numbered when already taken. */
export function exportName(title: string, extension: string, taken?: Set<string>): string {
  const base = abcName(title).replace(/\.abc$/, "");
  let name = `${base}.${extension}`;
  for (let n = 2; taken?.has(name.toLowerCase()); n++) name = `${base} (${n}).${extension}`;
  taken?.add(name.toLowerCase());
  return name;
}

/* SVG. */

export type SvgColours = { ink: string; paper: string };
export const PLAIN: SvgColours = { ink: "#000000", paper: "#ffffff" };

const GENERIC = /\b(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/i;

/**
 * A drawn score as a standalone SVG document: our classes and the page's styles taken out, the
 * colours written in, a white (or the look's) background, a viewBox, a title, and font families
 * that fall back to the reader's own serif or sans-serif fonts.
 */
export function standaloneSvg(
  drawn: Element,
  options: { title: string; colours?: SvgColours; declaration?: boolean },
): string {
  const colours = options.colours ?? PLAIN;
  const svg = drawn.cloneNode(true) as Element;
  const width = Number.parseFloat(svg.getAttribute("width") ?? "") || 800;
  const height = Number.parseFloat(svg.getAttribute("height") ?? "") || 400;
  if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(Math.round(width)));
  svg.setAttribute("height", String(Math.round(height)));
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("role", "img");
  svg.removeAttribute("style");
  svg.removeAttribute("aria-hidden");
  svg.removeAttribute("class");
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    // Pass dynamics ("2nd time p") are bold italic by a class on the page; here, by attributes.
    if (element.getAttribute("class")?.split(/\s+/).includes("abc-dyn")) {
      element.setAttribute("font-weight", "bold");
      element.setAttribute("font-style", "italic");
    }
    element.removeAttribute("class");
    for (const name of [...element.getAttributeNames()])
      if (/^data-/.test(name) || name === "style") element.removeAttribute(name);
    for (const name of ["fill", "stroke"]) {
      const value = element.getAttribute(name);
      if (value && /^(currentColor|#000|#000000|black)$/i.test(value))
        element.setAttribute(name, colours.ink);
    }
    const family = element.getAttribute("font-family");
    if (family && !GENERIC.test(family))
      element.setAttribute(
        "font-family",
        `${family}, ${/sans|recursive/i.test(family) ? "sans-serif" : "serif"}`,
      );
  }
  // Ink for anything abcjs leaves to the default colour, and the paper behind it all.
  svg.setAttribute("fill", colours.ink);
  svg.setAttribute("color", colours.ink);
  const document = svg.ownerDocument;
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", colours.paper);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = options.title;
  svg.insertBefore(background, svg.firstChild);
  svg.insertBefore(title, svg.firstChild);
  const markup = new XMLSerializer().serializeToString(svg);
  return options.declaration === false
    ? markup
    : `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${markup}\n`;
}

/** Draws a tune off screen, as print does, and returns its SVG. */
export function drawTune(abcjs: Abcjs, source: string, width = 740): Element | null {
  const holder = document.createElement("div");
  holder.style.cssText = `position:absolute;left:-10000px;top:0;width:${width + 40}px;`;
  document.body.append(holder);
  try {
    abcjs.renderAbc(holder, source, {
      staffwidth: width,
      paddingleft: 0,
      paddingright: 0,
      add_classes: true,
      format: scoreFormat(false),
      afterParsing: prepareTune,
      wrap: { minSpacing: 1.8, maxSpacing: 2.6, preferredMeasuresPerLine: 4 },
    } as Any);
    drawPassDynamics(holder);
    const svg = holder.querySelector("svg");
    return svg ? (svg.cloneNode(true) as Element) : null;
  } finally {
    holder.remove();
  }
}

/* The HTML tune book. */

export type BookEntry = {
  title: string;
  subtitle: string;
  svg: string;
  abc: string;
  /** For the Play button: [start s, length s, MIDI pitch, velocity]. */
  notes?: number[][];
};
export type BookOptions = { name: string; abc: "closed" | "open" | "none"; player: boolean };

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Play button's synth: a triangle wave per note, from the notes stored beside each tune. */
export const PLAYER_SCRIPT = `(()=>{let c,live=[],timer,current=null;
const idle=b=>{b.textContent="\\u25B6 Play";b.setAttribute("aria-pressed","false")};
const stop=()=>{for(const o of live)try{o.stop()}catch(e){}live=[];clearTimeout(timer);if(current)idle(current);current=null};
for(const b of document.querySelectorAll("button.play"))b.addEventListener("click",()=>{
const again=current===b;stop();if(again)return;
c=c||new (window.AudioContext||window.webkitAudioContext)();c.resume();
current=b;b.textContent="\\u25A0 Stop";b.setAttribute("aria-pressed","true");
const notes=JSON.parse(document.getElementById(b.dataset.notes).textContent);
const t0=c.currentTime+0.08;let end=0;
for(const[t,d,p,v]of notes){const o=c.createOscillator(),g=c.createGain();o.type="triangle";
o.frequency.value=440*Math.pow(2,(p-69)/12);const a=t0+t,l=Math.max(0.06,d);
g.gain.setValueAtTime(0,a);g.gain.linearRampToValueAtTime(0.2*v/127,a+0.012);
g.gain.exponentialRampToValueAtTime(0.0005,a+l);o.connect(g);g.connect(c.destination);
o.start(a);o.stop(a+l+0.02);live.push(o);end=Math.max(end,t+l)}
timer=setTimeout(stop,(end+0.3)*1000)})})();`;

const BOOK_STYLE = `
:root{color-scheme:light;--ink:#1d1d1f;--muted:#5f6368;--rule:#d9d9de;--accent:#1f5f5b}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 Georgia,"Times New Roman",serif;color:var(--ink);background:#fff}
header,nav,main{max-width:920px;margin:0 auto;padding:0 24px}
header{padding-top:40px}
h1{font-size:2rem;margin:0 0 4px}
header p{margin:0;color:var(--muted);font:14px/1.4 system-ui,sans-serif}
nav{margin-top:24px;padding-bottom:24px;border-bottom:1px solid var(--rule)}
nav h2{font-size:1.1rem;margin:0 0 8px}
nav ol{margin:0;padding-left:1.6em;columns:2 16em;column-gap:32px}
nav li{break-inside:avoid;margin:2px 0}
nav a{color:var(--accent)}
nav .meta{color:var(--muted);font:12px system-ui,sans-serif;margin-left:6px}
.tune{padding:32px 0;border-bottom:1px solid var(--rule)}
.tune h2{font-size:1.35rem;margin:0 0 4px}
.tune .sub{margin:0 0 8px;color:var(--muted)}
.tune svg{display:block;width:100%;height:auto;max-width:100%}
.tools{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-top:8px}
button.play{font:14px system-ui,sans-serif;padding:6px 14px;border:1px solid var(--accent);border-radius:6px;background:#fff;color:var(--accent);cursor:pointer}
button.play[aria-pressed=true]{background:var(--accent);color:#fff}
details{flex:1 1 300px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
summary{cursor:pointer;color:var(--accent);font:14px system-ui,sans-serif}
pre{white-space:pre-wrap;margin:8px 0 0;padding:12px;background:#f6f6f7;border-radius:6px;overflow:auto}
.top{font:13px system-ui,sans-serif;color:var(--accent)}
footer{max-width:920px;margin:0 auto;padding:24px;color:var(--muted);font:12px system-ui,sans-serif}
@media print{
@page{margin:14mm 12mm}
body{font-size:11pt}
header{padding-top:0}
nav{border:0}
nav a{color:inherit;text-decoration:none}
.tune{break-before:page;break-inside:avoid;border:0;padding:0}
.tools button,.top,footer,details:not([open]){display:none}
details[open] summary{display:none}
pre{background:none;padding:0}
}`;

/** One self-contained HTML file: contents, every tune drawn, its ABC, no scripts needed. */
export function htmlBook(entries: BookEntry[], options: BookOptions): string {
  const contents = entries
    .map(
      (entry, at) =>
        `<li><a href="#tune-${at + 1}">${escapeHtml(entry.title)}</a>${entry.subtitle ? `<span class="meta">${escapeHtml(entry.subtitle)}</span>` : ""}</li>`,
    )
    .join("\n");
  const tunes = entries
    .map((entry, at) => {
      const id = `tune-${at + 1}`;
      const tools: string[] = [];
      if (options.player && entry.notes?.length)
        tools.push(
          `<button type="button" class="play" data-notes="${id}-notes" aria-pressed="false">&#9654; Play</button><script type="application/json" id="${id}-notes">${JSON.stringify(entry.notes)}</script>`,
        );
      if (options.abc !== "none")
        tools.push(
          `<details${options.abc === "open" ? " open" : ""}><summary>ABC text</summary><pre>${escapeHtml(entry.abc)}</pre></details>`,
        );
      return `<section class="tune" id="${id}" aria-labelledby="${id}-title">
<h2 id="${id}-title">${escapeHtml(entry.title)}</h2>
${entry.subtitle ? `<p class="sub">${escapeHtml(entry.subtitle)}</p>\n` : ""}${entry.svg}
${tools.length ? `<div class="tools">${tools.join("")}</div>\n` : ""}<a class="top" href="#contents">Contents</a>
</section>`;
    })
    .join("\n");
  const player = options.player && entries.some((entry) => entry.notes?.length);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="VoxDown Composer">
<title>${escapeHtml(options.name)}</title>
<style>${BOOK_STYLE}</style>
</head>
<body>
<header><h1>${escapeHtml(options.name)}</h1><p>${entries.length} ${entries.length === 1 ? "tune" : "tunes"}</p></header>
<nav id="contents" aria-label="Contents"><h2>Contents</h2><ol>
${contents}
</ol></nav>
<main>
${tunes}
</main>
<footer>Made with VoxDown Composer. The music is drawn as SVG; the ABC text of each tune is beside it.</footer>
${player ? `<script>${PLAYER_SCRIPT}</script>\n` : ""}</body>
</html>
`;
}

/* Timelines for any tune, as the player builds them. */

/** A tune's timeline: abcjs's description, the play order, and dynamics per pass. */
export function tuneTimeline(abcjs: Abcjs, source: string, followJumps: boolean): Timeline | null {
  const file = indexFile(source);
  const tune = file.tunes[0];
  const visual = (abcjs as Any).parseOnly(source)[0];
  if (!tune || !visual) return null;
  const index = indexScore(visual, tune, (char) => char, source);
  const byStart = new Map<number, ScoreNote>(index.notes.map((note) => [note.start, note]));
  const lookup = (start: number) => {
    let at = start;
    while (/\s/.test(source[at] ?? "")) at += 1;
    return byStart.get(at) ?? byStart.get(start);
  };
  let audio: Any;
  try {
    audio = visual.setUpAudio({});
  } catch {
    return null;
  }
  const bar = visual.getBarLength?.() || 1;
  const first = (index.byVoice[0] ?? [])
    .filter((note) => note.measure === 0)
    .reduce((sum, note) => sum + note.duration, 0);
  let timeline = buildTimeline(
    audio,
    {
      bpm: audio.tempo || visual.getBpm?.() || 120,
      beat: visual.getBeatLength?.() || 0.25,
      bar,
      pickup: first > 1e-6 && first < bar - 1e-6 ? first : 0,
      voices: index.voices.map((voice) => voice.name),
    },
    (char) => char,
    lookup,
  );
  if (followJumps) {
    const structure = structureOf(visual);
    if (hasJumps(structure)) timeline = followOrder(timeline, structure, playOrder(structure));
  }
  const marks = passMarks(source, tune, file);
  return applyPassDynamics(timeline, marks.rules, marks.written);
}

/** A timeline's notes for the HTML book's player: [start s, length s, MIDI pitch, velocity]. */
export function playerNotes(timeline: Timeline, tempoFactor = 1): number[][] {
  const beat = timeline.beat > 0 ? timeline.beat : 0.25;
  const seconds = 60 / (timeline.bpm * tempoFactor * beat);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return timeline.notes.map((note) => [
    round(note.time * seconds),
    round(note.duration * seconds),
    Math.round(note.pitch),
    Math.round(note.velocity),
  ]);
}

/* The export dialogs, and running them. */

export type ExportKind = "svg" | "html" | "midi" | "wav";
export type ExportContext = {
  text: string;
  file: FileIndex;
  tune: TuneInfo | null;
  /** The file's name, for the book. */
  name: string;
  /** The current tune's own timeline, as the player has it. */
  timeline: Timeline | null;
  followJumps: boolean;
  tempoFactor: number;
  instrument: InstrumentId;
  /** The score's colours as the current look draws them. */
  look: SvgColours;
  render: (timeline: Timeline) => Promise<AudioBuffer>;
  notice: (message: string, kind?: "success") => void;
  noticeError: (message: string) => void;
};

type Dialog = ReturnType<typeof createDialog>;
const dialogs = new Map<ExportKind, Dialog>();

function radios(name: string, options: [string, string][], chosen: string): HTMLFieldSetElement {
  const set = document.createElement("fieldset");
  set.className = "book-choice";
  for (const [value, label] of options) {
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = value === chosen;
    row.append(input, ` ${label}`);
    set.append(row);
  }
  return set;
}
const chosen = (set: HTMLElement) =>
  set.querySelector<HTMLInputElement>("input:checked")?.value ?? "";

const TITLES: Record<ExportKind, string> = {
  svg: "Export SVG",
  html: "Export HTML tune book",
  midi: "Export MIDI",
  wav: "Export audio (WAV)",
};

export function openExport(kind: ExportKind, context: ExportContext) {
  const dialog = dialogs.get(kind) ?? createDialog(`export-${kind}`, TITLES[kind]);
  dialogs.set(kind, dialog);
  const count = context.file.tunes.length;
  const parts: HTMLElement[] = [];
  const lead = document.createElement("p");
  let options: HTMLFieldSetElement[] = [];
  let player: HTMLInputElement | null = null;
  const which = radios(
    `${kind}-which`,
    [
      ["one", `This tune${context.tune ? `, ${tuneLabel(context.tune)}` : ""}`],
      [
        "all",
        count > 1 ? `Every tune: ${count} files in one .zip` : "Every tune (this file has one)",
      ],
    ],
    "one",
  );
  if (kind === "svg") {
    lead.textContent = `${context.tune ? tuneLabel(context.tune) : "This tune"} as drawn, as an SVG drawing that opens anywhere.`;
    options = [
      radios(
        "svg-look",
        [
          ["plain", "Plain: black on white"],
          ["look", "In the current look's colours"],
        ],
        "plain",
      ),
    ];
  } else if (kind === "html") {
    lead.textContent = `Every tune of ${context.name.replace(/\.abc$/i, "")} in one web page: a contents list, each tune drawn, and its ABC. It needs no scripts and prints a tune a page.`;
    options = [
      radios(
        "html-abc",
        [
          ["closed", "The ABC text of each tune in a block that opens"],
          ["open", "The ABC text shown"],
          ["none", "No ABC text"],
        ],
        "closed",
      ),
    ];
    const label = document.createElement("label");
    label.className = "book-check";
    player = document.createElement("input");
    player.type = "checkbox";
    label.append(
      player,
      " A Play button for each tune: a small built-in synth (about 1 KB of script), offline",
    );
    parts.push(label);
  } else {
    lead.textContent =
      kind === "midi"
        ? "MIDI as Composer plays it: repeats, endings and D.C./D.S. jumps, a track per voice."
        : `Audio as Composer plays it, with the ${context.instrument}.`;
    if (count > 1) options = [which];
  }
  const row = document.createElement("div");
  row.className = "dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => dialog.close());
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.textContent = "Export";
  go.addEventListener("click", () => {
    dialog.close();
    const choice = options.map(chosen);
    void runExport(kind, context, {
      every: kind === "midi" || kind === "wav" ? chosen(which) === "all" && count > 1 : false,
      look: choice[0] === "look",
      abc: (kind === "html" ? choice[0] : "closed") as BookOptions["abc"],
      player: Boolean(player?.checked),
    });
  });
  row.append(cancel, go);
  dialog.body.replaceChildren(lead, ...options, ...parts, row);
  dialog.open();
}

async function runExport(
  kind: ExportKind,
  context: ExportContext,
  choice: { every: boolean; look: boolean; abc: BookOptions["abc"]; player: boolean },
) {
  const abcjs = await loadAbcjs();
  const { text, file } = context;
  const sourceOf = (tune: TuneInfo) => tuneSource({ text, file, tune }).source;
  try {
    if (kind === "svg") {
      const tune = context.tune ?? file.tunes[0];
      if (!tune) return context.notice("There is no tune to draw yet.");
      const drawn = drawTune(abcjs, sourceOf(tune));
      if (!drawn) return context.noticeError("This tune could not be drawn.");
      const svg = standaloneSvg(drawn, {
        title: tuneLabel(tune),
        colours: choice.look ? context.look : PLAIN,
      });
      download(svg, exportName(tuneLabel(tune), "svg"), "image/svg+xml");
      return context.notice(`${tuneLabel(tune)} exported as SVG.`, "success");
    }
    if (kind === "html") {
      if (!file.tunes.length) return context.notice("There are no tunes to put in a book yet.");
      const entries: BookEntry[] = [];
      for (const tune of file.tunes) {
        const source = sourceOf(tune);
        const drawn = drawTune(abcjs, source);
        const timeline = choice.player ? tuneTimeline(abcjs, source, context.followJumps) : null;
        entries.push({
          title: tuneLabel(tune),
          subtitle: [
            tune.subtitle,
            tune.composer,
            tune.key && `K:${tune.key}`,
            tune.meter && `M:${tune.meter}`,
          ]
            .filter(Boolean)
            .join(" · "),
          svg: drawn ? standaloneSvg(drawn, { title: tuneLabel(tune), declaration: false }) : "",
          abc: text.slice(tune.from, tune.to).replace(/\s+$/, ""),
          ...(timeline ? { notes: playerNotes(timeline, context.tempoFactor) } : {}),
        });
      }
      const name = context.name.replace(/\.abc$/i, "") || "Tune book";
      download(
        htmlBook(entries, { name, abc: choice.abc, player: choice.player }),
        exportName(name, "html"),
        "text/html",
      );
      return context.notice(`${entries.length} tunes exported as one HTML book.`, "success");
    }
    const tunes = choice.every
      ? file.tunes
      : context.tune
        ? [context.tune]
        : file.tunes.slice(0, 1);
    if (!tunes.length) return context.notice("There is no tune to export yet.");
    const taken = new Set<string>();
    const files: { name: string; data: Uint8Array }[] = [];
    for (const [at, tune] of tunes.entries()) {
      const timeline =
        !choice.every && context.timeline && tune.from === context.tune?.from
          ? context.timeline
          : tuneTimeline(abcjs, sourceOf(tune), context.followJumps);
      if (!timeline?.notes.length) continue;
      if (kind === "midi")
        files.push({
          name: exportName(tuneLabel(tune), "mid", taken),
          data: writeMidi(timeline, {
            title: tuneLabel(tune),
            tempoFactor: context.tempoFactor,
            instrument: context.instrument,
          }),
        });
      else {
        if (tunes.length > 1)
          context.notice(`Rendering ${at + 1} of ${tunes.length}: ${tuneLabel(tune)}…`, "success");
        const buffer = await context.render(timeline);
        normalise(buffer);
        files.push({
          name: exportName(tuneLabel(tune), "wav", taken),
          data: new Uint8Array(await encodeWav(buffer).arrayBuffer()),
        });
      }
    }
    if (!files.length) return context.notice("There is nothing to play in these tunes yet.");
    const type = kind === "midi" ? "audio/midi" : "audio/wav";
    if (!choice.every) {
      const only = files[0] as (typeof files)[number];
      download(only.data as BlobPart, only.name, type);
      return context.notice(
        `${tuneLabel(tunes[0] as TuneInfo)} exported as ${kind === "midi" ? "MIDI" : "WAV"}.`,
        "success",
      );
    }
    const name = `${(context.name.replace(/\.abc$/i, "") || "Tunes").trim()} ${kind === "midi" ? "MIDI" : "WAV"}`;
    download(writeZip(files) as BlobPart, exportName(name, "zip"), "application/zip");
    context.notice(
      `${files.length} tunes exported as ${kind === "midi" ? "MIDI" : "WAV"} files in one .zip.`,
      "success",
    );
  } catch (error) {
    console.warn(error);
    context.noticeError(
      kind === "wav"
        ? "The audio could not be rendered. Try again once the instrument has loaded."
        : "The export could not be made.",
    );
  }
}
