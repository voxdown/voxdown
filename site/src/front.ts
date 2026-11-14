/**
 * The front page: a scene as written in VoxDown, lit line by line as its recording plays, and a
 * short story's marks for the part about the format. The recordings and their timings are the
 * Listen page's (scripts/speak.mjs); each loads only when it is played.
 */
import { escapeHtml } from "@voxdown/render";
import { type Story, characterColors, parse, tokens } from "voxdown";
import { examples } from "./examples";
import "./style.css";
import "./front.css";
import "./theme";

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};

/** The timings scripts/speak.mjs writes for each recording. */
type Manifest = {
  audio: string;
  duration: number;
  cues: Array<{
    kind: string;
    speaker: string | null;
    direction: string | null;
    start: number;
    line: [number, number];
  }>;
};
const recordings = import.meta.glob<Manifest>("./recordings/*.json", {
  eager: true,
  import: "default",
});

/** The scenes, the dragon first: the recorded examples, each with its story. */
const scenes = examples
  .map((example) => ({
    example,
    manifest: recordings[`./recordings/${example.name.replace(/\.vxd$/, "")}.json`],
  }))
  .filter((scene): scene is { example: (typeof examples)[number]; manifest: Manifest } =>
    Boolean(scene.manifest),
  )
  .sort(
    (a, b) => Number(b.example.name.includes("dragon")) - Number(a.example.name.includes("dragon")),
  );

/** The text as written, each mark coloured as the Writer colours it. */
function marked(story: Story, from: number, to: number, colors: Map<string, string>): string {
  const source = story.source;
  let html = "";
  let at = from;
  for (const token of tokens(story)) {
    if (token.range.from < at || token.range.to > to) continue;
    html += escapeHtml(source.slice(at, token.range.from));
    const color = token.speaker ? colors.get(token.speaker) : undefined;
    html += `<span class="t-${token.kind}"${color ? ` style="--c: ${color}"` : ""}>${escapeHtml(source.slice(token.range.from, token.range.to))}</span>`;
    at = token.range.to;
  }
  return html + escapeHtml(source.slice(at, to));
}

const sheet = $<HTMLElement>("#sheet");
const play = $<HTMLButtonElement>("#scene-play");
const who = $<HTMLElement>("#scene-who");
const fill = $<HTMLElement>("#scene-fill");
const track = $<HTMLElement>("#scene-track");
const time = $<HTMLElement>("#scene-time");
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  index: 0,
  story: parse(""),
  /** Each line of the sheet: where it starts in the source, and its element. */
  rows: [] as Array<{ from: number; element: HTMLElement }>,
  current: -1,
  audio: undefined as HTMLAudioElement | undefined,
};

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The story's name for someone: the cast's, and the narrator plainly. */
function nameOf(speaker: string | null): string {
  if (!speaker || speaker === state.story.meta.narrator) return "The narrator";
  return state.story.cast.find((member) => member.handle === speaker)?.name ?? speaker;
}

function show(index: number): void {
  const scene = scenes[index];
  if (!scene) return;
  state.audio?.pause();
  state.audio = undefined;
  state.index = index;
  state.current = -1;
  state.story = parse(scene.example.text);
  const colors = characterColors(state.story);
  // From the story's first heading: the front matter and the writer's own notes stay out of it.
  const source = state.story.source;
  const heading = state.story.blocks.find((block) => block.kind === "heading");
  const start = heading?.range.from ?? 0;
  sheet.replaceChildren();
  state.rows = [];
  let at = start;
  for (const text of source.slice(start).split("\n")) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = text ? marked(state.story, at, at + text.length, colors) : "&nbsp;";
    const speaker = state.story.blocks
      .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
      .find((line) => line.range.from === at)
      ?.items.find((item) => item.kind === "speech")?.speaker;
    if (speaker && colors.get(speaker)) row.style.setProperty("--c", colors.get(speaker) ?? "");
    sheet.append(row);
    state.rows.push({ from: at, element: row });
    at += text.length + 1;
  }
  sheet.scrollTop = 0;
  for (const [i, button] of document.querySelectorAll<HTMLButtonElement>(".scene-tab").entries())
    button.setAttribute("aria-selected", String(i === index));
  $<HTMLAnchorElement>("#scene-open").href =
    `./writer/#example=${scene.example.name.replace(/\.vxd$/, "")}`;
  who.textContent = "Press play: the line being heard lights up.";
  time.textContent = clock(scene.manifest.duration);
  fill.style.width = "0%";
  track.setAttribute("aria-valuenow", "0");
  showPlaying();
}

function audioOf(): HTMLAudioElement {
  if (state.audio) return state.audio;
  const scene = scenes[state.index] as (typeof scenes)[number];
  const audio = new Audio(`./listen/${scene.manifest.audio}`);
  audio.preload = "auto";
  audio.addEventListener("play", () => {
    showPlaying();
    requestAnimationFrame(frame);
  });
  audio.addEventListener("pause", showPlaying);
  audio.addEventListener("ended", showPlaying);
  state.audio = audio;
  return audio;
}

function frame(): void {
  const audio = state.audio;
  if (!audio) return;
  tick(audio.currentTime);
  if (!audio.paused && !audio.ended) requestAnimationFrame(frame);
}

function tick(seconds: number): void {
  const scene = scenes[state.index] as (typeof scenes)[number];
  const { cues, duration } = scene.manifest;
  let cue = -1;
  for (let i = 0; i < cues.length; i++) {
    if ((cues[i]?.start ?? 0) <= seconds) cue = i;
    else break;
  }
  fill.style.width = `${(seconds / duration) * 100}%`;
  track.setAttribute("aria-valuenow", String(Math.round((seconds / duration) * 100)));
  time.textContent = `${clock(seconds)} / ${clock(duration)}`;
  const heard = cues[cue];
  // The line the part heard is on: a heading's starts after its `#`.
  let row = -1;
  if (heard) for (const [i, each] of state.rows.entries()) if (each.from <= heard.line[0]) row = i;
  if (heard && cue !== state.current) {
    state.current = cue;
    const direction = heard.direction ? `, ${heard.direction}` : "";
    who.textContent =
      heard.kind === "speech" || heard.kind === "vocal"
        ? `${nameOf(heard.speaker)}${direction}`
        : heard.kind === "sound"
          ? "A sound"
          : heard.kind === "pause"
            ? "A pause"
            : "A page turns";
  }
  for (const [i, each] of state.rows.entries()) each.element.classList.toggle("heard", i === row);
  const lit = state.rows[row]?.element;
  if (lit) {
    const target = lit.offsetTop - sheet.clientHeight / 2 + lit.offsetHeight / 2;
    if (Math.abs(sheet.scrollTop - target) > 4)
      sheet.scrollTo({ top: target, behavior: calm.matches ? "auto" : "smooth" });
  }
}

function showPlaying(): void {
  const playing = Boolean(state.audio && !state.audio.paused && !state.audio.ended);
  play.classList.toggle("playing", playing);
  play.setAttribute("aria-label", playing ? "Pause" : "Play");
  sheet.classList.toggle("playing", playing);
  $("#hero-play span").textContent = playing ? "Pause the scene" : "Hear a scene";
  $("#hero-play").classList.toggle("playing", playing);
}

function toggle(): void {
  const audio = audioOf();
  if (audio.paused || audio.ended) {
    if (audio.ended) audio.currentTime = 0;
    audio.play().catch(() => showPlaying());
  } else audio.pause();
}

function seek(share: number): void {
  const scene = scenes[state.index] as (typeof scenes)[number];
  const audio = audioOf();
  audio.currentTime = Math.max(0, Math.min(1, share)) * scene.manifest.duration;
  tick(audio.currentTime);
}

// The scenes to choose from, by their titles.
const pick = $<HTMLElement>("#scene-pick");
for (const [index, scene] of scenes.entries()) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scene-tab";
  button.setAttribute("role", "tab");
  button.textContent = scene.example.title;
  button.addEventListener("click", () => show(index));
  pick.append(button);
}
play.addEventListener("click", toggle);
$("#hero-play").addEventListener("click", () => {
  toggle();
  if (window.innerWidth < 960)
    $("#scene").scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "start" });
});
track.addEventListener("click", (event) => {
  const box = track.getBoundingClientRect();
  seek((event.clientX - box.left) / box.width);
});
track.addEventListener("keydown", (event) => {
  const audio = state.audio;
  const scene = scenes[state.index] as (typeof scenes)[number];
  const now = audio?.currentTime ?? 0;
  const step = event.key === "ArrowRight" ? 5 : event.key === "ArrowLeft" ? -5 : 0;
  if (!step) return;
  event.preventDefault();
  seek((now + step) / scene.manifest.duration);
});
show(0);

// The part about the format: a few lines of a story, its marks coloured.
{
  const text = `# The North Wind and the Sun

@Wind (boasting) “I am the strongest thing in all the sky.”

@Sun (calmly) “Then let us see.” {pause}

[a great gust of wind] The traveler held his cloak *tighter*.`;
  const story = parse(text);
  $("#sample").innerHTML = marked(story, 0, text.length, characterColors(story));
}

// The Writer's picture in the theme the page is in, the switch's or the computer's.
{
  const shot = $<HTMLImageElement>("#shot");
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const choose = () => {
    const theme = document.documentElement.dataset.vxdTheme;
    const isDark = theme ? theme === "dark" : dark.matches;
    const src = `./front/writer-${isDark ? "dark" : "light"}.jpg`;
    if (!shot.src.endsWith(src.slice(1))) shot.src = src;
  };
  choose();
  dark.addEventListener("change", choose);
  new MutationObserver(choose).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-vxd-theme"],
  });
}
