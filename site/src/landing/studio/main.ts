/**
 * The studio landing page. The hero: a recorded scene, lit line by line. The spine: one scene of
 * the dragon story written, marked, organised and voiced in a likeness of the Writer, step by step
 * as the page scrolls (or from the step buttons). Then the cast, each heard in their own line, and
 * the real Writer in screenshots. One recording player serves them all; audio loads only on play.
 */
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/literata";
import { escapeHtml, renderBook, renderScript, stylesheet } from "@voxdown/render";
import { type Story, characterColors, parse, tokens } from "voxdown";
import { examples } from "../../examples";
import "./studio.css";

const $ = <T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};
const $$ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
];
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const announce = (words: string) => {
  const live = $("#announce");
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = words;
  });
};

// The renderer's own stylesheet, for the book and the script.
{
  const style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.prepend(style);
}

/* ================================================================== the recordings */

type Cue = {
  kind: string;
  speaker: string | null;
  direction: string | null;
  start: number;
  duration: number;
  line: [number, number];
  text?: string;
};
type Manifest = { audio: string; duration: number; voices: Record<string, string>; cues: Cue[] };
type Scene = { example: (typeof examples)[number]; manifest: Manifest; story: Story };
const recordings = import.meta.glob<Manifest>("../../recordings/*.json", {
  eager: true,
  import: "default",
});
const manifestOf = (name: string) =>
  recordings[`../../recordings/${name.replace(/\.vxd$/, "")}.json`];

const scenes: Scene[] = examples
  .map((example) => ({ example, manifest: manifestOf(example.name), story: parse(example.text) }))
  .filter((s): s is Scene => Boolean(s.manifest))
  .sort(
    (a, b) => Number(b.example.name.includes("dragon")) - Number(a.example.name.includes("dragon")),
  );
const dragon = scenes.find((scene) => scene.example.name.includes("dragon")) as Scene;
const dragonColors = characterColors(dragon.story);
const colorOf = (story: Story, who: string | null) =>
  who && who !== story.meta.narrator ? characterColors(story).get(who) : undefined;

/** The story's name for someone: the cast's, and the narrator plainly. */
function nameOf(story: Story, speaker: string | null): string {
  if (!speaker || speaker === story.meta.narrator) return "The narrator";
  return story.cast.find((member) => member.handle === speaker)?.name ?? speaker;
}

function cueAt(manifest: Manifest, seconds: number): number {
  let at = -1;
  for (let i = 0; i < manifest.cues.length; i++) {
    if ((manifest.cues[i]?.start ?? 0) <= seconds) at = i;
    else break;
  }
  return at;
}

/** What a cue is, in words: "Gerald, deep, polite…", "A sound", "A pause". */
function described(story: Story, cue: Cue | undefined): string {
  if (!cue) return "";
  if (cue.kind === "speech")
    return `${nameOf(story, cue.speaker)}${cue.direction ? `, ${cue.direction}` : ""}`;
  if (cue.kind === "vocal") return `${nameOf(story, cue.speaker)} (${cue.text ?? "a sound"})`;
  if (cue.kind === "sound") return "A sound";
  if (cue.kind === "pause") return "A pause";
  return "A page turns";
}

/* One player for the page: the hero's scene, the spine's finale and the auditions share it. */
type Owner = {
  label: string;
  home: () => HTMLElement;
  tick: (seconds: number) => void;
  state: (playing: boolean) => void;
};
const player = {
  audio: undefined as HTMLAudioElement | undefined,
  file: "",
  scene: dragon,
  owner: undefined as Owner | undefined,
  stopAt: Number.POSITIVE_INFINITY,
};
const playing = () => Boolean(player.audio && !player.audio.paused && !player.audio.ended);

function audioFor(scene: Scene): HTMLAudioElement {
  if (player.audio && player.file === scene.manifest.audio) return player.audio;
  player.audio?.pause();
  const audio = new Audio(`../../listen/${scene.manifest.audio}`);
  audio.preload = "auto";
  audio.addEventListener("play", () => {
    if (player.audio !== audio) return;
    player.owner?.state(true);
    showPill();
    requestAnimationFrame(frame);
  });
  audio.addEventListener("pause", () => {
    if (player.audio !== audio) return;
    player.owner?.state(false);
    showPill();
    if (!audio.ended) announce("Paused.");
  });
  audio.addEventListener("ended", () => {
    if (player.audio !== audio) return;
    player.owner?.state(false);
    showPill();
    announce("The recording has ended.");
  });
  player.audio = audio;
  player.file = scene.manifest.audio;
  player.scene = scene;
  return audio;
}

function frame(): void {
  const audio = player.audio;
  if (!audio) return;
  const t = audio.currentTime;
  if (t >= player.stopAt) {
    audio.pause();
    player.owner?.tick(t);
    return;
  }
  player.owner?.tick(t);
  updatePill(t);
  if (!audio.paused && !audio.ended) requestAnimationFrame(frame);
}

/** Plays a scene for an owner: from a time, to a time, or on from where it was. */
function play(owner: Owner, scene: Scene, from?: number, stopAt = Number.POSITIVE_INFINITY): void {
  const audio = audioFor(scene);
  if (player.owner && player.owner !== owner) {
    const before = player.owner;
    player.owner = owner;
    before.state(false);
  }
  player.owner = owner;
  player.stopAt = stopAt;
  if (from !== undefined) {
    if (audio.readyState >= 1) audio.currentTime = from;
    else {
      audio.muted = true;
      audio.addEventListener(
        "loadedmetadata",
        () => {
          audio.currentTime = from;
          audio.muted = false;
        },
        { once: true },
      );
    }
  } else if (audio.ended) audio.currentTime = 0;
  if (audio.paused) audio.play().catch(() => owner.state(false));
  else owner.state(true);
  announce(`Playing ${owner.label}.`);
}

/* The now-playing pill: what's being heard, while its scene is out of view. */
const pill = $("#np");
const seen = new Map<Element, boolean>();
const homes = new IntersectionObserver((entries) => {
  for (const entry of entries) seen.set(entry.target, entry.isIntersecting);
  showPill();
});
function showPill(): void {
  const home = player.owner?.home();
  const away = home ? seen.get(home) === false : false;
  pill.hidden = !(playing() && away);
  $("#np-toggle").classList.toggle("playing", playing());
  $("#np-toggle").setAttribute("aria-label", playing() ? "Pause" : "Play");
  if (!pill.hidden && player.audio) updatePill(player.audio.currentTime);
}
function updatePill(seconds: number): void {
  if (pill.hidden) return;
  const cue = player.scene.manifest.cues[cueAt(player.scene.manifest, seconds)];
  const words = described(player.scene.story, cue) || player.owner?.label || "";
  const who = $("#np-who");
  if (who.textContent !== words) who.textContent = words;
  const color = colorOf(player.scene.story, cue?.speaker ?? null);
  $("#np-dot").style.setProperty("--c", color ?? "#a78bfa");
}
$("#np-toggle").addEventListener("click", () => {
  const audio = player.audio;
  if (!audio) return;
  if (audio.paused) audio.play();
  else audio.pause();
});
$("#np-back").addEventListener("click", () => {
  const home = player.owner?.home();
  home?.scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" });
});

/* ================================================================== marks, coloured */

function spotOf(kind: string): string {
  if (kind === "mark" || kind === "name") return "who";
  if (kind === "direction" || kind === "group") return "how";
  if (kind === "sound" || kind === "vocal") return "sound";
  if (kind === "instruction") return "time";
  return "";
}

/** The text as written, each mark coloured as the Writer colours it. */
function marked(story: Story, from: number, to: number, colors: Map<string, string>): string {
  const source = story.source;
  let html = "";
  let at = from;
  for (const token of tokens(story)) {
    if (token.range.from < at || token.range.to > to) continue;
    html += escapeHtml(source.slice(at, token.range.from));
    const color = token.speaker ? colors.get(token.speaker) : undefined;
    const spot = spotOf(token.kind);
    html += `<span class="t-${token.kind}"${spot ? ` data-spot="${spot}"` : ""}${token.speaker ? ` data-who="${escapeHtml(token.speaker)}"` : ""}${color ? ` style="--c: ${color}"` : ""}>${escapeHtml(source.slice(token.range.from, token.range.to))}</span>`;
    at = token.range.to;
  }
  return html + escapeHtml(source.slice(at, to));
}

/* ================================================================== the hero's scene */

const sheet = $("#sheet");
const demoPlay = $<HTMLButtonElement>("#demo-play");
const heroPlay = $<HTMLButtonElement>("#hero-play");
const nowText = $("#now-text");
const nowDot = $("#now-dot");
const fill = $("#track-fill");
const track = $("#track");
const time = $("#time");
const tip = $("#tip");

/** The kind of mark the "spot the marks" buttons are showing, if any. */
let spot = "";
const hero = {
  index: 0,
  rows: [] as Array<{ from: number; element: HTMLElement }>,
  current: -1,
  row: -1,
  at: 0,
};
const heroScene = () => scenes[hero.index] as Scene;

const heroOwner: Owner = {
  label: "the dragon scene",
  home: () => $("#demo"),
  tick: (seconds) => heroTick(seconds),
  state: () => showHeroPlaying(),
};

function showScene(index: number): void {
  const scene = scenes[index];
  if (!scene) return;
  if (player.owner === heroOwner) player.audio?.pause();
  hero.index = index;
  hero.current = -1;
  hero.row = -1;
  hero.at = 0;
  heroOwner.label = scene.example.name.includes("dragon") ? "the dragon scene" : "the fable";
  const story = scene.story;
  const colors = characterColors(story);
  const source = story.source;
  const lines = story.blocks.flatMap((block) => (block.kind === "paragraph" ? block.lines : []));
  sheet.replaceChildren();
  hero.rows = [];
  let at = 0;
  for (const text of source.replace(/\s+$/, "").split("\n")) {
    const row = document.createElement("div");
    row.className = text ? "row" : "row gap";
    row.innerHTML = text ? marked(story, at, at + text.length, colors) : "";
    const speaker = lines
      .find((line) => line.range.from === at)
      ?.items.find((item) => item.kind === "speech")?.speaker;
    const color = speaker ? colors.get(speaker) : undefined;
    if (color) row.style.setProperty("--c", color);
    sheet.append(row);
    hero.rows.push({ from: at, element: row });
    at += text.length + 1;
  }
  // Open on the best exchange; the front matter and headings are a scroll up.
  const opening = scene.example.name.includes("dragon")
    ? "Could you not?"
    : "Strength is not always loud";
  const first = hero.rows.find((row) => row.element.textContent?.includes(opening));
  requestAnimationFrame(() => {
    sheet.scrollTop = first ? Math.max(0, first.element.offsetTop - 16) : 0;
  });
  for (const [i, tab] of $$<HTMLButtonElement>(".demo-tab").entries()) {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  }
  $<HTMLAnchorElement>("#demo-open").href =
    `../../writer/#example=${scene.example.name.replace(/\.vxd$/, "")}`;
  nowText.textContent = "Press play: the line being heard lights up.";
  nowDot.style.removeProperty("--c");
  time.textContent = clock(scene.manifest.duration);
  $("#hero-time").textContent = clock(scene.manifest.duration);
  fill.style.transform = "scaleX(0)";
  track.setAttribute("aria-valuenow", "0");
  track.setAttribute("aria-valuetext", "0:00");
  applySpot();
  showHeroPlaying();
}

function heroTick(seconds: number): void {
  const scene = heroScene();
  const { cues, duration } = scene.manifest;
  hero.at = seconds;
  const cue = cueAt(scene.manifest, seconds);
  const share = Math.min(1, seconds / duration);
  fill.style.transform = `scaleX(${share})`;
  track.setAttribute("aria-valuenow", String(Math.round(share * 100)));
  time.textContent = `${clock(seconds)} / ${clock(duration)}`;
  const heard = cues[cue];
  let row = -1;
  if (heard) for (const [i, each] of hero.rows.entries()) if (each.from <= heard.line[0]) row = i;
  if (heard && cue !== hero.current) {
    hero.current = cue;
    const words = described(scene.story, heard);
    nowText.textContent = words;
    track.setAttribute("aria-valuetext", `${clock(seconds)}, ${words}`);
    const color = colorOf(scene.story, heard.speaker);
    if (color) nowDot.style.setProperty("--c", color);
    else nowDot.style.removeProperty("--c");
  }
  if (row !== hero.row) {
    hero.rows[hero.row]?.element.classList.remove("heard");
    hero.rows[row]?.element.classList.add("heard");
    hero.row = row;
    const lit = hero.rows[row]?.element;
    if (lit) {
      const target = lit.offsetTop - sheet.clientHeight / 2 + lit.offsetHeight / 2;
      sheet.scrollTo({ top: target, behavior: calm.matches ? "auto" : "smooth" });
    }
  }
}

function showHeroPlaying(): void {
  const on = playing() && player.owner === heroOwner;
  demoPlay.classList.toggle("playing", on);
  demoPlay.setAttribute("aria-label", on ? "Pause the scene" : "Play the scene");
  sheet.classList.toggle("playing", on);
  heroPlay.classList.toggle("playing", on);
  $("#demo").classList.toggle("is-playing", on);
  $(".hero-play-label").textContent = `${on ? "Pause" : "Hear"} ${heroOwner.label}`;
}

function toggleHero(): void {
  if (playing() && player.owner === heroOwner) {
    player.audio?.pause();
    return;
  }
  const scene = heroScene();
  const at = hero.at >= scene.manifest.duration - 0.5 ? 0 : hero.at;
  play(heroOwner, scene, at);
}

function seekHero(share: number): void {
  const scene = heroScene();
  const at = Math.max(0, Math.min(1, share)) * scene.manifest.duration;
  hero.at = at;
  if (player.owner === heroOwner && player.audio && player.file === scene.manifest.audio)
    player.audio.currentTime = at;
  heroTick(at);
}

{
  const tabs = $("#demo-tabs");
  for (const [index, scene] of scenes.entries()) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "demo-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "sheet");
    tab.textContent = scene.example.name.includes("dragon") ? "The Dragon" : "The North Wind";
    tab.title = scene.example.title;
    tab.addEventListener("click", () => showScene(index));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = (index + step + scenes.length) % scenes.length;
      showScene(next);
      $$<HTMLButtonElement>(".demo-tab", tabs)[next]?.focus();
    });
    tabs.append(tab);
  }
  demoPlay.addEventListener("click", toggleHero);
  heroPlay.addEventListener("click", () => {
    toggleHero();
    if (window.innerWidth < 960) {
      const box = $("#demo").getBoundingClientRect();
      if (box.top > window.innerHeight * 0.5 || box.bottom < 0)
        $("#demo").scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" });
    }
  });
  track.addEventListener("click", (event) => {
    const box = track.getBoundingClientRect();
    seekHero((event.clientX - box.left) / box.width);
  });
  track.addEventListener("keydown", (event) => {
    const duration = heroScene().manifest.duration;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 5
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -5
          : 0;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleHero();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      seekHero(event.key === "Home" ? 0 : 0.999);
      return;
    }
    if (!step) return;
    event.preventDefault();
    seekHero((hero.at + step) / duration);
  });
  showScene(0);
  homes.observe($("#demo"));
}

function applySpot(): void {
  sheet.dataset.spot = spot;
  for (const button of $$<HTMLButtonElement>(".chip-k"))
    button.setAttribute("aria-pressed", String(button.dataset.spot === spot));
  if (!spot || playing()) return;
  const marks = $$(`.row [data-spot="${spot}"]`, sheet);
  const inView = marks.some((mark) => {
    const row = mark.closest<HTMLElement>(".row") as HTMLElement;
    return (
      row.offsetTop >= sheet.scrollTop && row.offsetTop <= sheet.scrollTop + sheet.clientHeight - 30
    );
  });
  const row = marks[0]?.closest<HTMLElement>(".row");
  if (row && !inView)
    sheet.scrollTo({ top: row.offsetTop - 40, behavior: calm.matches ? "auto" : "smooth" });
}
for (const button of $$<HTMLButtonElement>(".chip-k"))
  button.addEventListener("click", () => {
    spot = spot === button.dataset.spot ? "" : (button.dataset.spot ?? "");
    applySpot();
  });

function explain(element: HTMLElement): string {
  const kind = element.className.replace(/^t-/, "");
  const text = element.textContent ?? "";
  const who = element.dataset.who ? nameOf(heroScene().story, element.dataset.who) : "";
  if (kind === "mark" || kind === "name") return `Who speaks: ${who}`;
  if (kind === "direction") return "How it’s said: a direction for the voice";
  if (kind === "group") return "A passage grouped under one voice or direction";
  if (kind === "sound") return "A sound in the world of the story";
  if (kind === "vocal") return `${who}’s own sound`;
  if (kind === "note") return "A note for the performer, never read aloud";
  if (kind === "heading") return "A heading";
  if (kind === "frontmatter") return "The title and the cast";
  if (kind === "instruction") {
    if (/page/.test(text)) return "A page turn, for a picture book or read-along";
    if (/pause/.test(text)) return "Silence";
    if (/book only/.test(text)) return "Printed in the book, not read aloud";
    if (/audio only/.test(text)) return "Heard in the audio, not printed";
    if (/hidden/.test(text)) return "Neither printed nor read aloud";
    return "An instruction";
  }
  return "";
}
sheet.addEventListener("pointerover", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[class^='t-']");
  if (!target || target.className === "t-quote") {
    tip.classList.remove("on");
    return;
  }
  const words = explain(target);
  if (!words) return;
  tip.textContent = words;
  const box = target.getBoundingClientRect();
  const frameBox = $("#demo").getBoundingClientRect();
  const half = tip.offsetWidth / 2 + 10;
  const x = Math.min(
    Math.max(box.left - frameBox.left + box.width / 2, half),
    frameBox.width - half,
  );
  tip.style.transform = `translate(${x}px, ${box.top - frameBox.top - 8}px) translate(-50%, -100%)`;
  tip.classList.add("on");
});
sheet.addEventListener("pointerleave", () => tip.classList.remove("on"));
sheet.addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });

/* ================================================================== the spine */

/*
 * The scene, line by line, with each mark and the step it is set at. `s` on a segment: the step
 * its mark appears; on a line: the step the whole line appears. Every word is the dragon story's
 * own, except the line the writer cuts to Scraps.
 */
type Kind =
  | "text"
  | "head"
  | "name"
  | "dir"
  | "speech"
  | "sound"
  | "vocal"
  | "pause"
  | "group"
  | "comment";
type Seg = { t: string; k?: Kind; s?: number; who?: string };
type Line = {
  segs: Seg[];
  s?: number;
  cut?: boolean;
  tight?: boolean;
  group?: 1 | 2;
  from?: number;
  id?: string;
};
const G = "Gerald";
const P = "Percival";
const LINES: Line[] = [
  { segs: [{ t: "## The mountain", k: "head" }] },
  {
    id: "rumble",
    segs: [
      { t: "Then he heard a deep rumble." },
      { t: " [deep rumbling, from inside a cave]", k: "sound", s: 4 },
    ],
  },
  {
    segs: [{ t: "The dragon was snoring." }, { t: " @Gerald [snores]", k: "vocal", s: 4, who: G }],
  },
  { s: 3, tight: true, group: 1, segs: [{ t: "::: whispering", k: "group" }] },
  { tight: true, group: 1, segs: [{ t: "Sir Percival crept inside." }] },
  { tight: true, group: 1, segs: [{ t: "Clank." }] },
  { tight: true, group: 1, segs: [{ t: "Clank." }] },
  { id: "pause", s: 4, tight: true, group: 1, segs: [{ t: "{pause}", k: "pause" }] },
  { tight: true, group: 1, id: "eye", segs: [{ t: "The dragon opened one eye." }] },
  { s: 3, group: 1, segs: [{ t: ":::", k: "group" }] },
  {
    id: "could",
    segs: [
      { t: "@Gerald ", k: "name", s: 2, who: G },
      { t: "(deep, polite and utterly unbothered) ", k: "dir", s: 3 },
      { t: "“Could you not?”", k: "speech", who: G },
    ],
  },
  { segs: [{ t: "Sir Percival stopped." }] },
  {
    segs: [
      { t: "@Gerald ", k: "name", s: 2, who: G },
      { t: "“I’ve only just got to sleep,”", k: "speech", who: G },
      { t: " said the dragon. " },
      { t: "“I was up all night counting sheep.”", k: "speech", who: G },
    ],
  },
  {
    segs: [
      { t: "@Percival ", k: "name", s: 2, who: P },
      { t: "“Real sheep?”", k: "speech", who: P },
    ],
  },
  {
    id: "imaginary",
    segs: [
      { t: "@Gerald ", k: "name", s: 2, who: G },
      { t: "“Imaginary ones. They were very difficult to catch.”", k: "speech", who: G },
      { t: " <!-- Best line in the scene. Keep it. -->", k: "comment", s: 6 },
    ],
  },
  { id: "battle", s: 5, segs: [{ t: "## The battle", k: "head" }] },
  {
    s: 5,
    tight: true,
    group: 2,
    segs: [
      { t: "::: ", k: "group" },
      { t: "@Percival", k: "name", who: P },
      { t: " trying to sound brave", k: "group" },
    ],
  },
  { s: 5, tight: true, group: 2, segs: [{ t: "I am Sir Percival of the Shining Shield!" }] },
  {
    id: "smite",
    s: 5,
    tight: true,
    group: 2,
    cut: true,
    segs: [{ t: "I shall smite thee most thoroughly!" }],
  },
  { s: 5, tight: true, group: 2, segs: [{ t: "Prepare to meet thy doom!" }] },
  { s: 5, tight: true, group: 2, segs: [{ t: ":::", k: "group" }] },
];
// Where each line of the mountain scene is in the story, to light it as it's heard.
{
  const full = dragon.story.source;
  let cursor = full.indexOf("## The mountain");
  for (const line of LINES) {
    if (line.s === 5) break;
    const text = line.segs
      .filter((seg) => seg.k !== "comment")
      .map((seg) => seg.t)
      .join("");
    const at = full.indexOf(text, cursor);
    if (at >= 0) {
      line.from = at;
      cursor = at + text.length;
    }
  }
}
const STEPS = 11;
const SEG_FROM = 50.2;
const SEG_TO = 84.5;

const colorFor = (who?: string) => (who ? (dragonColors.get(who) ?? "#555") : "#555");

/** A line's HTML: in the mock every mark is there and CSS shows it at its step; in an example only
 * what's been set by `upTo` is drawn. */
function lineHtml(line: Line, upTo?: number): string {
  return line.segs
    .map((seg) => {
      if (upTo !== undefined && seg.s && seg.s > upTo) return "";
      const text = escapeHtml(seg.t);
      const k = seg.k ?? "text";
      if (k === "text") return text;
      const style = seg.who ? ` style="--sp:${colorFor(seg.who)}"` : "";
      const step = seg.s && upTo === undefined ? ` data-s="${seg.s}"` : "";
      if (k === "speech") return `<span class="k-speech"${style}>${text}</span>`;
      return `<span class="mk k-${k}"${step}${style}>${text}</span>`;
    })
    .join("");
}

function linesHtml(lines: Line[], upTo?: number): string {
  return lines
    .filter((line) => upTo === undefined || ((line.s ?? 0) <= upTo && !(line.cut && upTo >= 7)))
    .map((line, i) => {
      const classes = [
        "ln",
        line.tight ? "tight" : "",
        line.group ? `g${line.group}` : "",
        line.cut ? "cut" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const attrs = [
        `class="${classes}"`,
        upTo === undefined && line.s ? `data-s="${line.s}"` : "",
        line.from !== undefined ? `data-line-from="${line.from}"` : "",
        line.id && upTo === undefined ? `data-id="${line.id}"` : "",
        `style="--i:${i}"`,
      ]
        .filter(Boolean)
        .join(" ");
      return `<p ${attrs}>${lineHtml(line, upTo)}</p>`;
    })
    .join("");
}

/* The book, the script and the sides of the mountain scene, by the renderer. */
const mountain = (() => {
  const full = dragon.story.source;
  const front = full.slice(0, full.indexOf("---", 4) + 3);
  const from = full.indexOf("Then he heard");
  const to = full.indexOf("difficult to catch.”") + "difficult to catch.”".length;
  return parse(`${front}\n\n${full.slice(from, to)}\n`);
})();
const BOOK = `<div class="book-page" data-vxd-theme="light"><p class="book-run">The Dragon Who Would Not Roar</p>${renderBook(mountain, { header: false })}<p class="book-folio">12</p></div>`;
const SCRIPT = `<div class="script-page" data-vxd-theme="light">${renderScript(mountain, { header: false })}</div>`;
const SIDES = `<div class="sides-page">
  <p class="sides-head"><span style="--sp:${colorFor(G)}">Gerald</span> · his lines · The mountain</p>
  <p class="cue">… The dragon opened one eye.</p>
  <p class="said"><b>GERALD</b> <i>(deep, polite and utterly unbothered)</i> “Could you not?”</p>
  <p class="cue">… Sir Percival stopped.</p>
  <p class="said"><b>GERALD</b> “I’ve only just got to sleep,” said the dragon. “I was up all night counting sheep.”</p>
  <p class="cue">SIR PERCIVAL: “Real sheep?”</p>
  <p class="said"><b>GERALD</b> “Imaginary ones. They were very difficult to catch.”</p>
</div>`;

/* The audiobook: the voices cast, and the scene as lanes from the recording's own cues. */
const segmentCues = dragon.manifest.cues.filter(
  (cue) => cue.start >= SEG_FROM - 0.5 && cue.start < SEG_TO,
);
function lanesHtml(): string {
  const span = SEG_TO - SEG_FROM;
  const lanes = [
    { key: "Narrator", name: "Narrator" },
    { key: G, name: "Gerald" },
    { key: P, name: "Sir Percival" },
    { key: "", name: "Sounds" },
  ];
  return `<div class="lanes">${lanes
    .map((lane) => {
      const bits = segmentCues
        .filter((cue) =>
          lane.key ? cue.speaker === lane.key : cue.kind === "sound" || cue.kind === "pause",
        )
        .map((cue) => {
          const x = ((cue.start - SEG_FROM) / span) * 100;
          const w = (cue.duration / span) * 100;
          return `<i style="--x:${x.toFixed(2)}%;--w:${w.toFixed(2)}%" data-start="${cue.start}" data-end="${cue.start + cue.duration}"></i>`;
        })
        .join("");
      const color =
        lane.key && lane.key !== "Narrator" ? colorFor(lane.key) : lane.key ? "#7c6fa8" : "#0f766e";
      return `<div class="lane" style="--c:${color}"><span>${lane.name}</span><div class="lane-track">${bits}</div></div>`;
    })
    .join("")}<div class="playhead-rail"><div class="playhead" data-playhead></div></div></div>`;
}
const voices = dragon.manifest.voices;
const AUDIO = `<div class="ab">
  <p class="ab-title">Make an audiobook</p>
  <p class="ab-row"><span>The voices</span><b class="ab-select">ElevenLabs <i>▾</i></b></p>
  <ul class="ab-cast">
    <li><span class="dot" style="--sp:#7c6fa8"></span>Narrator<b>${escapeHtml(voices.Narrator ?? "")}</b></li>
    <li><span class="dot" style="--sp:${colorFor(G)}"></span>Gerald<b>${escapeHtml(voices.Gerald ?? "")}</b></li>
    <li><span class="dot" style="--sp:${colorFor(P)}"></span>Sir Percival<b>${escapeHtml(voices.Percival ?? "")}</b></li>
  </ul>
  ${lanesHtml()}
  <p class="ab-now"><span data-seg-who>Voiced from this file</span><span data-seg-clock>0:00 / ${clock(SEG_TO - SEG_FROM)}</span></p>
</div>`;

const ICON = {
  who: '<path d="M4 5h16v10H9l-5 4z"/>',
  how: '<path d="M3 14c3-6 5-6 7 0s4 6 7 0 3-4 4-2"/>',
  next: '<path d="M4 12h12M12 6l6 6-6 6M20 5v14"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  page: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  note: '<path d="M4 5h16v14H4zM8 9h8M8 13h6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  outline: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  warn: '<path d="M12 4l9 16H3zM12 10v4M12 17h.01"/>',
  hear: '<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H4zM17 14h3v5h-3z"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4M5 14v6h14v-6"/>',
  scenes: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  cast: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 15-5 16 0"/>',
  scraps:
    '<circle cx="6" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><path d="M8 7.5l12 9M8 16.5l12-9"/>',
  comments: '<path d="M4 5h16v11H8l-4 4z"/>',
  left: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  right: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
};
const icon = (name: keyof typeof ICON) => `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`;
const tool = (name: keyof typeof ICON, label: string, hl = "") =>
  `<span class="tb"${hl ? ` data-hl="${hl}"` : ""}>${icon(name)}${label}</span>`;

function buildMock(wr: HTMLElement): void {
  wr.innerHTML = `
  <div class="wr-top">
    <span class="wr-logo"><img src="../../icon.svg" alt="" width="18" height="18"><b>VoxDown</b> <em>Writer</em></span>
    <span class="wr-menus"><span data-hl="audio">File</span><span>Edit</span><span data-hl="insert">Insert</span><span>View</span><span>Help</span></span>
    <span class="wr-file">the-dragon-who-would-not-roar.vxd <i class="wr-saved"></i><small>Kept in this browser</small></span>
    <span class="wr-sp"></span>
    <span class="wr-save">Save</span><span class="wr-look">◐ Paper</span>
    <span class="wr-ico" data-hl="bench">${icon("left")}</span><span class="wr-ico" data-hl="preview">${icon("right")}</span>
  </div>
  <div class="wr-tools">
    <span class="tb tb-i"><svg viewBox="0 0 24 24"><path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-2"/></svg></span>
    <span class="tb tb-i"><svg viewBox="0 0 24 24"><path d="M15 14l4-4-4-4M19 10h-9a5 5 0 0 0 0 10h2"/></svg></span>
    <i class="tsep"></i><span class="tb tb-i tb-serif"><em>I</em></span><span class="tb tb-i tb-serif"><b>B</b></span><i class="tsep"></i>
    ${tool("who", "Who", "who")}${tool("how", "How", "how")}${tool("next", "Next quote")}${tool("ai", "AI")}<i class="tsep"></i>
    ${tool("sound", "Sound", "sound")}${tool("pause", "Pause", "sound")}${tool("page", "Page turn")}${tool("note", "Note")}<i class="tsep"></i>
    <span class="tb tb-i">${icon("search")}</span><span class="tb tb-i">${icon("outline")}</span><span class="tb tb-i">${icon("warn")}</span><i class="tsep"></i>
    ${tool("hear", "Hear")}<span class="wr-sp"></span>${tool("export", "Export", "export")}
  </div>
  <div class="wr-body">
    <aside class="bench">
      <div class="bench-tabs">
        <span class="bt bt-scenes">${icon("scenes")}<em>Scenes</em></span>
        <span class="bt bt-cast">${icon("cast")}<em>Cast</em></span>
        <span class="bt bt-scraps">${icon("scraps")}<em>Scraps</em></span>
        <span class="bt bt-comments">${icon("comments")}<em>Comments</em></span>
        <span class="bt">${icon("warn")}<small>0</small></span>
      </div>
      <div class="pane pane-cast">
        <div class="cc" style="--sp:#7c6fa8"><span class="dot"></span><b>Narrator</b><small>Warm and unhurried, enjoying the joke.</small></div>
        <div class="cc cc-new" style="--sp:${colorFor(G)}"><span class="dot"></span><b>Gerald</b><small>An old dragon. Deep, polite and utterly unbothered.</small><em>4 lines</em></div>
        <div class="cc" style="--sp:${colorFor(P)}"><span class="dot"></span><b>Sir Percival</b><small>A young knight. Brave in theory, nervous in practice.</small><em>1 line</em></div>
      </div>
      <div class="pane pane-scenes">
        <p class="pane-link">Open the scene board…</p>
        <p class="scn"><b>The mountain</b><small>118 words</small></p>
        <p class="scn scn-new"><b>The battle</b><small>24 words</small></p>
      </div>
      <div class="pane pane-comments">
        <div class="cmt"><small>The mountain · “Imaginary ones…”</small><p>Best line in the scene. Keep it.</p></div>
      </div>
      <div class="pane pane-scraps">
        <div class="scrap"><p>I shall smite thee most thoroughly!</p><small>From The battle · just now</small><span class="scrap-back">Bring back</span></div>
      </div>
    </aside>
    <div class="desk">
      <div class="paper"><div class="doc" id="wr-doc">${linesHtml(LINES)}<span class="caret"></span>
        <div class="annot" id="annot"></div>
      </div></div>
    </div>
    <aside class="preview">
      <div class="pv-tabs"><span class="pv-script">Script</span><span class="pv-book">Book</span><span class="pv-title pv-sides">Export › Each character’s lines</span><span class="pv-title pv-audio">File › Make an audiobook…</span></div>
      <div class="pv pv-p-book">${BOOK}</div>
      <div class="pv pv-p-script">${SCRIPT}</div>
      <div class="pv pv-p-sides">${SIDES}</div>
      <div class="pv pv-p-audio">${AUDIO}</div>
    </aside>
    <div class="board">
      <p class="board-h">Scene board <span>The Dragon Who Would Not Roar</span></p>
      <div class="board-cols">
        <div class="bcol"><p>The Dragon Who Would Not Roar</p>
          <div class="bcard st-done"><b>The proclamation</b><small>The King makes an offer.</small><em>Done</em></div>
          <div class="bcard st-rev"><b>The mountain</b><small>Percival finds the dragon asleep.</small><em>Revised</em></div>
          <div class="bcard st-draft bcard-new"><b>The battle</b><small>Percival tries to sound brave.</small><em>Draft</em></div>
        </div>
      </div>
    </div>
  </div>
  <div class="wr-status"><span data-status>0 words</span><span class="wr-sp"></span><span>Kept in this browser, for now</span></div>`;
}

/* Each step's example, as ordinary content: shown on a phone, read by a screen reader. */
function exampleHtml(step: number): string {
  const paper = (lines: Line[], upTo: number) =>
    `<div class="ex-paper">${linesHtml(lines, upTo)}</div>`;
  const by = (...ids: string[]) => LINES.filter((line) => line.id && ids.includes(line.id));
  const castCard = `<div class="ex-card" style="--sp:${colorFor(G)}"><span class="dot" aria-hidden="true"></span><p><b>Gerald</b>, in the Cast: an old dragon. Deep, polite and utterly unbothered.</p></div>`;
  switch (step) {
    case 1:
      return paper(LINES.slice(0, 3), 1);
    case 2:
      return paper(by("could"), 2) + castCard;
    case 3:
      return paper(by("could"), 3);
    case 4:
      return paper(LINES.slice(1, 10), 4);
    case 5:
      return `<div class="ex-list"><p class="ex-h">Scenes</p><p><b>The mountain</b> <span>118 words</span></p><p><b>The battle</b> <span>24 words, new</span></p></div>`;
    case 6:
      return `${paper(by("imaginary"), 6)}<div class="ex-list"><p class="ex-h">Comments</p><p>Best line in the scene. Keep it.</p></div>`;
    case 7:
      return `<div class="ex-list"><p class="ex-h">Scraps</p><p>I shall smite thee most thoroughly!</p></div>`;
    case 8:
      return BOOK;
    case 9:
      return SCRIPT;
    case 10:
      return SIDES;
    case 11:
      return `<div class="ex-audio">${AUDIO}</div>`;
  }
  return "";
}

/* The pen: it rings or underlines the words, and writes its question in the margin. */
const PEN: Record<number, Array<{ at: string; word: string; shape: "circle" | "under" }>> = {
  2: [{ at: "could .k-speech", word: "who?", shape: "circle" }],
  3: [{ at: "could .k-dir", word: "how?", shape: "under" }],
  4: [
    { at: "rumble", word: "what do we hear?", shape: "circle" },
    { at: "pause", word: "a beat", shape: "circle" },
  ],
};

const wr = $("#wr");
buildMock(wr);
const doc = $("#wr-doc");
const annot = $("#annot");
const steps = $$("#steps .step");
const jump = $("#jump");
const caption = $("#caption-words");
let active = -1;

// The step buttons, and each step's example.
for (const step of steps) {
  const n = Number(step.dataset.step);
  const example = document.createElement("div");
  example.className = "step-example";
  example.innerHTML = `<p class="sr-only">In the Writer:</p>${exampleHtml(n)}`;
  const button = step.querySelector(".step-play");
  if (button) step.insertBefore(example, button);
  else step.append(example);
  const label = document.createElement("p");
  label.className = "step-label";
  label.innerHTML = `<span>${n}</span> ${escapeHtml(step.dataset.label ?? "")} <em>${escapeHtml(step.dataset.feature ?? "")}</em>`;
  step.prepend(label);
  const li = document.createElement("li");
  li.innerHTML = `<button type="button" data-go="${n}"><span aria-hidden="true">${n}</span>${escapeHtml(step.dataset.label ?? "")}</button>`;
  jump.append(li);
}
const lanesRoots = () => $$(".lanes");

const TAB_OF: Record<number, string> = {
  2: "cast",
  3: "cast",
  4: "cast",
  5: "scenes",
  6: "comments",
  7: "scraps",
};
const PANE_OF: Record<number, string> = { 8: "book", 9: "script", 10: "sides", 11: "audio" };
const HL_OF: Record<number, string> = {
  2: "who",
  3: "how",
  4: "sound",
  5: "bench",
  6: "insert",
  7: "bench",
  8: "preview",
  9: "preview",
  10: "export",
  11: "audio",
};
const FOCUS_OF: Record<number, string> = {
  2: "could",
  3: "could",
  4: "rumble",
  5: "battle",
  6: "imaginary",
  7: "battle",
};

function wordCount(upTo: number): number {
  return LINES.filter((line) => (line.s ?? 0) <= upTo && !(line.cut && upTo >= 7))
    .flatMap((line) => line.segs.filter((seg) => !seg.k || seg.k === "speech").map((seg) => seg.t))
    .join(" ")
    .split(/\s+/)
    .filter((word) => /\w/.test(word)).length;
}

function setStep(n: number): void {
  if (n === active) return;
  active = n;
  wr.dataset.step = String(n);
  for (let k = 1; k <= STEPS; k++) wr.classList.toggle(`s${k}`, k <= n);
  wr.dataset.tab = TAB_OF[n] ?? "";
  wr.dataset.pane = PANE_OF[n] ?? "";
  wr.dataset.hl = HL_OF[n] ?? "";
  // Marks set at this step arrive now; the rest are simply there.
  for (const mark of $$<HTMLElement>("[data-s]", doc))
    mark.classList.toggle("new", Number(mark.dataset.s) === n);
  wr.classList.remove("typing");
  if (n === 1 && !calm.matches) {
    void wr.offsetWidth;
    wr.classList.add("typing");
  }
  for (const [i, button] of $$<HTMLButtonElement>("[data-go]").entries()) {
    if (i + 1 === n) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  const step = steps[n - 1];
  caption.innerHTML = step
    ? `<p class="cap-n"><span>${n}</span>${escapeHtml(step.dataset.feature ?? "")}</p><p class="cap-h">${escapeHtml($("h3", step).textContent ?? "")}</p><p class="cap-p">${escapeHtml($("h3 + p", step).textContent ?? "")}</p>`
    : `<p class="cap-n"><span>0</span>A new story</p><p class="cap-h">A blank page.</p><p class="cap-p">Scroll, or pick a step above, and the scene begins.</p>`;
  $(".caption .finale-play").hidden = n !== STEPS;
  $("[data-status]", wr).textContent =
    `${wordCount(n)} words · ${n >= 2 ? "3 voices" : "1 voice"} · ${n >= 5 ? "2 scenes" : "1 scene"}`;
  if (n !== STEPS && player.owner === finaleOwner && playing() && window.innerWidth > 860)
    player.audio?.pause();
  if (window.innerWidth <= 860) return;
  // Bring the line the step is about into view, and put the pen to it.
  scrollDoc(FOCUS_OF[n]);
  drawPen(n);
}

function scrollDoc(id?: string): void {
  const paper = doc.parentElement as HTMLElement;
  const line = id ? doc.querySelector<HTMLElement>(`[data-id="${id}"]`) : null;
  const room = paper.clientHeight;
  const most = Math.max(0, doc.scrollHeight - room + 24);
  const y = line ? Math.min(most, Math.max(0, line.offsetTop - room * 0.3)) : 0;
  doc.style.transform = `translateY(${-y}px)`;
}

function drawPen(n: number): void {
  annot.replaceChildren();
  const marks = PEN[n];
  if (!marks) return;
  // The margin: the strip of paper right of the text, where an editor writes.
  const margin = doc.clientWidth - Number.parseFloat(getComputedStyle(doc).paddingRight) + 14;
  for (const [i, mark] of marks.entries()) {
    const [id, inner] = mark.at.split(" ");
    const line = doc.querySelector<HTMLElement>(`[data-id="${id}"]`);
    const target = inner ? line?.querySelector<HTMLElement>(inner) : line;
    if (!line || !target) continue;
    // The words themselves (their first line), measured from the doc, which scrolls as one.
    const range = document.createRange();
    range.selectNodeContents(target);
    const first = range.getClientRects()[0] ?? target.getBoundingClientRect();
    const base = doc.getBoundingClientRect();
    const x = first.left - base.left;
    const y = first.top - base.top;
    const w = first.width;
    const h = first.height;
    // The leader runs from the end of the line's first row (marks included) to the margin.
    const whole = document.createRange();
    whole.selectNodeContents(line);
    const end = Math.max(
      x + w,
      ...[...whole.getClientRects()]
        .filter((r) => r.width > 0 && r.top < first.bottom - 3 && r.bottom > first.top + 3)
        .map((r) => r.right - base.left),
    );
    const group = document.createElement("div");
    group.className = `pen pen-${mark.shape}`;
    group.style.setProperty("--d", `${i * 0.7}s`);
    const shape =
      mark.shape === "circle"
        ? `<img class="ring" src="../../landing/studio/pen/pencil-circle.webp" alt="" style="left:${x - 12}px;top:${y - 8}px;width:${w + 24}px;height:${h + 16}px">`
        : `<img class="under" src="../../landing/studio/pen/pencil-underline.webp" alt="" style="left:${x - 4}px;top:${y + h - 11}px;width:${w + 8}px;height:22px">`;
    const leadFrom = end + 12;
    const lead = margin - 6 - leadFrom;
    group.innerHTML = `${shape}${lead >= 44 ? `<img class="lead" src="../../landing/studio/pen/pencil-arrow.webp" alt="" style="left:${leadFrom}px;top:${y + h / 2 - 9}px;width:${lead}px;height:18px">` : ""}
      <span class="hand" style="left:${margin}px;top:${y + h / 2 - 12}px"><i>${escapeHtml(mark.word)}</i></span>
      <img class="nib" src="../../landing/studio/pen/fountain-pen.webp" alt="" style="left:${margin - 8}px;top:${y + h / 2 - 50}px">`;
    annot.append(group);
  }
}

/* The finale: the scene, voiced from this file, each line lit as it's heard. */
let finaleLine = -1;
let finaleCue = -1;
const finaleOwner: Owner = {
  label: "the mountain scene",
  home: () => (window.innerWidth > 860 ? $("#wr") : (steps[STEPS - 1] as HTMLElement)),
  tick: (seconds) => {
    const span = SEG_TO - SEG_FROM;
    const share = Math.max(0, Math.min(1, (seconds - SEG_FROM) / span));
    const index = cueAt(dragon.manifest, seconds);
    const cue = dragon.manifest.cues[index];
    for (const root of lanesRoots()) {
      const head = root.querySelector<HTMLElement>("[data-playhead]");
      if (head) head.style.transform = `translateX(${(share * 100).toFixed(2)}cqw)`;
      for (const bit of root.querySelectorAll<HTMLElement>(".lane-track i"))
        bit.classList.toggle(
          "on",
          Number(bit.dataset.start) <= seconds && seconds < Number(bit.dataset.end) + 0.15,
        );
    }
    for (const el of $$("[data-seg-clock]"))
      el.textContent = `${clock(Math.max(0, seconds - SEG_FROM))} / ${clock(span)}`;
    if (index !== finaleCue && cue) {
      finaleCue = index;
      for (const el of $$("[data-seg-who]")) el.textContent = described(dragon.story, cue);
    }
    // The line being heard, in the mock and in the step's own example.
    let from = -1;
    if (cue)
      for (const line of LINES)
        if (line.from !== undefined && line.from <= cue.line[0]) from = line.from;
    if (from !== finaleLine) {
      finaleLine = from;
      for (const el of $$("[data-line-from]"))
        el.classList.toggle("heard", Number(el.dataset.lineFrom) === from);
      const lit = doc.querySelector<HTMLElement>(`[data-line-from="${from}"]`);
      if (lit && window.innerWidth > 860) {
        const paper = doc.parentElement as HTMLElement;
        const most = Math.max(0, doc.scrollHeight - paper.clientHeight + 24);
        doc.style.transform = `translateY(${-Math.min(most, Math.max(0, lit.offsetTop - paper.clientHeight * 0.4))}px)`;
      }
    }
  },
  state: (on) => {
    for (const button of $$<HTMLButtonElement>("[data-finale-play]")) {
      button.classList.toggle("playing", on);
      $(".finale-label", button).textContent = on ? "Pause" : "Play the scene";
    }
    wr.classList.toggle("voicing", on);
    for (const root of lanesRoots()) root.classList.toggle("playing", on);
  },
};
for (const button of $$<HTMLButtonElement>("[data-finale-play]"))
  button.addEventListener("click", () => {
    if (playing() && player.owner === finaleOwner) {
      player.audio?.pause();
      return;
    }
    const at = player.owner === finaleOwner && player.audio ? player.audio.currentTime : 0;
    play(finaleOwner, dragon, at > SEG_FROM && at < SEG_TO - 0.3 ? at : SEG_FROM, SEG_TO);
  });
homes.observe($("#wr"));
homes.observe(steps[STEPS - 1] as HTMLElement);

// Which step is in the middle of the screen.
{
  const middle = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const n = Number((entry.target as HTMLElement).dataset.step);
        if (entry.isIntersecting) setStep(n);
        else if (n === 1 && entry.boundingClientRect.top > window.innerHeight / 2) setStep(0);
      }
    },
    { rootMargin: "-49% 0px -49% 0px" },
  );
  for (const step of steps) middle.observe(step);
  setStep(0);
  jump.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-go]");
    if (!button) return;
    const step = steps[Number(button.dataset.go) - 1];
    if (!step) return;
    const box = step.getBoundingClientRect();
    const top = window.scrollY + box.top + box.height / 2 - window.innerHeight / 2;
    window.scrollTo({ top, behavior: calm.matches ? "auto" : "smooth" });
    setStep(Number(button.dataset.go));
  });
}

/* ================================================================== the cast */

{
  const story = dragon.story;
  const manifest = dragon.manifest;
  const auditions: Record<string, [number, number]> = {
    Narrator: [1, 1],
    King: [5, 7],
    Percival: [40, 40],
    Gerald: [35, 36],
  };
  const list = $("#cast-list");
  for (const member of story.cast.filter((m) => auditions[m.handle])) {
    const [first, last] = auditions[member.handle] as [number, number];
    const from = manifest.cues[first] as Cue;
    const to = manifest.cues[last] as Cue;
    const name = member.handle === story.meta.narrator ? "The Narrator" : member.name;
    const color = colorOf(story, member.handle) ?? "#7c6fa8";
    const voice = manifest.voices[member.handle];
    const item = document.createElement("li");
    item.className = "cast-card";
    item.style.setProperty("--sp", color);
    item.innerHTML = `
      <div class="cast-top"><span class="medal" aria-hidden="true">${escapeHtml(name.replace(/^(The|Sir) /, "").slice(0, 1))}</span>
        <div><h3>${escapeHtml(name)}</h3><p class="cast-voice">${voice ? `Voice: ${escapeHtml(voice)}, on ElevenLabs` : ""}</p></div></div>
      <p class="cast-about">${escapeHtml(member.about ?? "")}</p>
      <p class="cast-line"><code>${marked(story, from.line[0], from.line[1], dragonColors)}</code></p>
      <button class="audition" type="button" aria-pressed="false">
        <span class="play-glyph" aria-hidden="true"><svg class="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg><svg class="i-pause" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg></span>
        <span>Hear ${escapeHtml(name.replace(/^The /, "the "))}</span>
      </button>
      <div class="cast-meter" aria-hidden="true"><i></i></div>`;
    const button = $<HTMLButtonElement>(".audition", item);
    const meter = $(".cast-meter i", item);
    const stopAt = to.start + to.duration + 0.25;
    const owner: Owner = {
      label: `${name}’s line`,
      home: () => item,
      tick: (seconds) => {
        meter.style.transform = `scaleX(${Math.max(0, Math.min(1, (seconds - from.start) / (stopAt - from.start)))})`;
      },
      state: (on) => {
        button.classList.toggle("playing", on);
        button.setAttribute("aria-pressed", String(on));
        item.classList.toggle("on", on);
        if (!on) meter.style.transform = "scaleX(0)";
      },
    };
    button.addEventListener("click", () => {
      if (playing() && player.owner === owner) {
        player.audio?.pause();
        return;
      }
      play(owner, dragon, Math.max(0, from.start - 0.05), stopAt);
    });
    list.append(item);
    homes.observe(item);
  }
}

/* The sides, for the dark section's "to people" route. */
$("#route-sides").innerHTML = SIDES;

/* ================================================================== the real Writer */

for (const button of $$<HTMLButtonElement>("[data-look]"))
  button.addEventListener("click", () => {
    $<HTMLImageElement>("#shot").src = `../../landing/studio/app/full-${button.dataset.look}.webp`;
    for (const other of $$<HTMLButtonElement>("[data-look]"))
      other.setAttribute("aria-pressed", String(other === button));
  });
{
  const looks = [
    ["paper", "Paper", "dark ink on white"],
    ["sepia", "Sepia", "brown ink on warm cream"],
    ["night", "Night", "pale text on dark grey"],
    ["slate", "Slate", "pale text on blue-grey"],
    ["contrast", "High contrast", "black on white, every mark darker"],
  ];
  $("#looks-strip").innerHTML = looks
    .map(
      ([id, label, about]) =>
        `<figure><img data-shot src="../../landing/studio/app/looks-${id}.webp" alt="The dragon story in the ${label} look: ${about}." loading="lazy" decoding="async" width="1400" height="904"><figcaption>${label}</figcaption></figure>`,
    )
    .join("");
}

/* ================================================================== pictures */

// A picture not there (yet) is simply not drawn: never a broken image.
for (const image of $$<HTMLImageElement>("img[data-clay], img[data-shot]")) {
  const ready = () => image.classList.add("loaded");
  const gone = () => image.classList.add("missing");
  if (image.complete) image.naturalWidth ? ready() : gone();
  image.addEventListener("load", ready);
  image.addEventListener("error", gone);
}

/* ================================================================== motion */

// Decorative motion only while it can be seen.
{
  const idle = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("idle", !entry.isIntersecting);
  });
  for (const mesh of $$(".mesh")) idle.observe(mesh);
}

// The header goes dark over dark bands.
{
  const header = $("#top");
  const darks = $$(".dark");
  let queued = false;
  const update = () => {
    queued = false;
    header.classList.toggle("scrolled", window.scrollY > 8);
    const mid = header.offsetHeight / 2;
    header.classList.toggle(
      "on-dark",
      darks.some((band) => {
        const box = band.getBoundingClientRect();
        return box.top <= mid && box.bottom >= mid;
      }),
    );
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

// After a resize, the doc's scroll and the pen are measured again.
{
  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const n = active;
      active = -1;
      setStep(n);
    }, 200);
  });
}
