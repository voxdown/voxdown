/**
 * The studio landing page. The hero: a recorded scene, lit line by line. The spine: one scene of
 * the dragon story written, marked, organised and voiced in a likeness of the Writer, step by step
 * as the page scrolls (or from the step buttons). Then the cast, each heard in their own line, and
 * the real Writer in screenshots. One recording player serves them all; audio loads only on play.
 */
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import * as renderLib from "@voxdown/render";
/** Text made safe for HTML (the renderer's own rule; the renderer itself loads with the spine). */
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
/** The renderer, for the book and the script, and its stylesheet. */
type Render = typeof renderLib;
const render: Render = renderLib;
{
  const style = document.createElement("style");
  style.textContent = render.stylesheet;
  document.head.prepend(style);
}
import {
  type Story,
  characterColors,
  lines,
  linesToCsv,
  parse,
  textByCharacter,
  tokens,
} from "voxdown";
// Only the two recorded stories, read as they are: nothing else to parse at load.
import dragonText from "../../../../examples/the-dragon-who-would-not-roar.vxd?raw";
import windText from "../../../../examples/the-north-wind-and-the-sun.vxd?raw";
import { type Ink, inkEnd, inkOf, pictureEnd, ringEnd, type Words, wordsEnd, wordsOf } from "./ink";
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
/**
 * Where the footer's "support it" link goes. Empty: the line isn't shown at all (no dead link).
 * Set it to the support page's https:// address to show it.
 */
const SUPPORT_URL = "";

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
type Example = { name: string; text: string };
type Scene = { example: Example; manifest: Manifest; story: Story };
const examples: Example[] = [
  { name: "the-dragon-who-would-not-roar.vxd", text: dragonText },
  { name: "the-north-wind-and-the-sun.vxd", text: windText },
];
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
  document.body.classList.toggle("np-on", !pill.hidden);
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
  smoothJump(() =>
    home?.scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" }),
  );
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
/** Each story's tokens, worked out once: they are sorted by position, so a range is found by search. */
const tokensOf = new WeakMap<Story, ReturnType<typeof tokens>>();
function marked(story: Story, from: number, to: number, colors: Map<string, string>): string {
  const source = story.source;
  let all = tokensOf.get(story);
  if (!all) {
    all = tokens(story);
    tokensOf.set(story, all);
  }
  // The first token that could fall in the range.
  let lo = 0;
  let hi = all.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((all[mid] as (typeof all)[number]).range.from < from) lo = mid + 1;
    else hi = mid;
  }
  let html = "";
  let at = from;
  for (let i = lo; i < all.length; i++) {
    const token = all[i] as (typeof all)[number];
    if (token.range.from >= to) break;
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
const heroTime = $("#hero-time");

/** The kind of mark the "spot the marks" buttons are showing, if any. */
let spot = "";
const hero = {
  index: 0,
  rows: [] as Array<{ from: number; element: HTMLElement }>,
  current: -1,
  row: -1,
  at: 0,
  second: -1,
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
  // Read from the story's first heading: the front matter and the writer's notes are skipped.
  const storyStart = story.blocks.find((block) => block.kind === "heading")?.range.from ?? 0;
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
    if (at < storyStart) row.setAttribute("aria-hidden", "true");
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
  sheet.setAttribute("aria-labelledby", `demo-tab-${index}`);
  $<HTMLAnchorElement>("#demo-open").href =
    `../../writer/#example=${scene.example.name.replace(/\.vxd$/, "")}`;
  nowText.textContent = "Press play to follow along.";
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
  heroTime.textContent = clock(Math.max(0, duration - seconds));
  const heard = cues[cue];
  let row = -1;
  if (heard) for (const [i, each] of hero.rows.entries()) if (each.from <= heard.line[0]) row = i;
  const second = Math.floor(seconds);
  const speaking = heard && cue !== hero.current;
  if (speaking || second !== hero.second) {
    hero.second = second;
    const now = heard ? described(scene.story, heard) : "";
    track.setAttribute("aria-valuetext", now ? `${clock(seconds)}, ${now}` : clock(seconds));
  }
  if (heard && cue !== hero.current) {
    hero.current = cue;
    const words = described(scene.story, heard);
    nowText.textContent = words;
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
  // At the end, the button shows the whole length again.
  if (
    !on &&
    (!player.audio || player.audio.ended || hero.at >= heroScene().manifest.duration - 0.5)
  )
    heroTime.textContent = clock(heroScene().manifest.duration);
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
  for (const [index, tab] of $$<HTMLButtonElement>(".demo-tab", tabs).entries()) {
    tab.addEventListener("click", () => showScene(index));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = (index + step + scenes.length) % scenes.length;
      showScene(next);
      $$<HTMLButtonElement>(".demo-tab", tabs)[next]?.focus();
    });
  }
  demoPlay.addEventListener("click", toggleHero);
  heroPlay.addEventListener("click", () => {
    toggleHero();
    if (window.innerWidth < 960) {
      const box = $("#demo").getBoundingClientRect();
      if (box.top > window.innerHeight * 0.5 || box.bottom < 0)
        smoothJump(() =>
          $("#demo").scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" }),
        );
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

/** What each kind of mark does, said beside the chips. */
function spotSays(kind: string): string {
  switch (kind) {
    case "who":
      return "@Name before a quote says who says it.";
    case "how":
      return "A direction in round brackets says how it’s said.";
    case "sound":
      return "Square brackets are a sound: of the world, or, after a name, the speaker’s own.";
    case "time":
      return "Braces set the timing: a {pause}, or a {page} turn.";
  }
  return "Pick a kind of mark to see where it is, and what it does.";
}
function applySpot(): void {
  sheet.dataset.spot = spot;
  $("#spot-say").textContent = spotSays(spot);
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

/* Literata, the story's face, only as the spine or the production section nears: the first screen
   doesn't use it. Its fallback takes the same room, and the mock is measured again once it's in. */
{
  let asked = false;
  const load = () => {
    if (asked) return;
    asked = true;
    near.disconnect();
    void import("@fontsource-variable/literata").then(() =>
      document.fonts.load('15px "Literata Variable"').then(() => respine?.()),
    );
  };
  const near = new IntersectionObserver(
    (entries) => entries.some((e) => e.isIntersecting) && load(),
    {
      rootMargin: "250px 0px",
    },
  );
  for (const el of $$("#spine-track, .prod, .proof")) near.observe(el);
}

/* ================================================================== the typewriter */

/**
 * Types the text in `root` as far as it's told: every character is laid out from the start and only
 * made visible up to a point, so no line ever re-wraps. Punctuation and line ends take a little more
 * of the distance, the beat a typist takes. Straight quotes curl a few characters later. The caret
 * sits after the last visible character: solid while the text moves, blinking when it rests.
 */
type Typer = { to: (share: number) => void; total: number; whole: () => void };
function typer(
  root: HTMLElement,
  caret: HTMLElement | null,
  onType?: (typed: string) => void,
): Typer {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if ((node as Text).data.length && !(node.parentElement as HTMLElement).closest(".caret"))
      nodes.push(node as Text);
  const chars: HTMLElement[] = [];
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const ch of node.data) {
      const span = document.createElement("span");
      span.className = "tw";
      span.textContent = ch === "“" || ch === "”" ? '"' : ch;
      if (ch === "“" || ch === "”") span.dataset.curl = ch;
      frag.append(span);
      chars.push(span);
    }
    node.replaceWith(frag);
  }
  // How far along the text each character is reached.
  const reach: number[] = [];
  let sum = 0;
  for (const [i, ch] of chars.entries()) {
    const next = chars[i + 1];
    const lineEnd = !next || next.closest("p") !== ch.closest("p");
    sum += lineEnd ? 6 : /[.,!?;:]/.test(ch.textContent ?? "") ? 3 : 1;
    reach.push(sum);
  }
  // A short tail after the last character, so a closing quote also curls a few beats later.
  const end = sum + 3;
  root.classList.add("typing-on");
  let shown = -1;
  let curledTo = -1;
  let rest = 0;
  const place = (count: number) => {
    if (!caret) return;
    const base = caret.offsetParent?.getBoundingClientRect();
    const ref = count === 0 ? chars[0] : chars[count - 1];
    if (!ref || !base) return;
    const box = ref.getBoundingClientRect();
    const x = count === 0 ? box.left - base.left : box.right - base.left;
    caret.style.transform = `translate(${x.toFixed(1)}px, ${(box.top - base.top).toFixed(1)}px)`;
    caret.style.height = `${box.height}px`;
  };
  const show = (count: number, at = reach[count - 1] ?? 0) => {
    // A quote goes in straight, and curls once the scroll has gone three more characters on.
    const curls = chars.reduce(
      (n, ch, i) => n + (ch.dataset.curl && at >= (reach[i] as number) + 3 ? 1 : 0),
      0,
    );
    if (count === shown && curls === curledTo) return;
    for (const [i, ch] of chars.entries()) {
      ch.classList.toggle("on", i < count);
      if (ch.dataset.curl)
        ch.textContent = i < count && at >= (reach[i] as number) + 3 ? ch.dataset.curl : '"';
    }
    curledTo = curls;
    if (count === shown) return;
    shown = count;
    place(count);
    if (caret) {
      caret.classList.add("moving");
      clearTimeout(rest);
      rest = window.setTimeout(() => caret.classList.remove("moving"), 420);
    }
    root.classList.toggle("typed", count >= chars.length);
    if (onType) {
      const lines = [...root.querySelectorAll(".ln")].filter(
        (l) => !l.textContent?.startsWith("##"),
      );
      onType(
        lines
          .map((l) => [...l.querySelectorAll(".tw.on")].map((c) => c.textContent).join(""))
          .join(" "),
      );
    }
  };
  const to = (share: number) => {
    const target = Math.max(0, Math.min(1, share)) * end;
    let count = 0;
    while (count < chars.length && (reach[count] as number) <= target + 1e-6) count++;
    show(count, target);
  };
  show(0, 0);
  return { to, total: chars.length, whole: () => show(chars.length, end) };
}

/**
 * A scroll the page makes itself (a jump to a step or a view). Until it ends, nothing it passes on
 * the way is shown: no step or view in between is set, and every scrubbed mark is simply where the
 * page is. It ends on `scrollend`, after 150 ms without a scroll event (older Safari has no
 * `scrollend`, and a jump that doesn't move fires none), or at once when the reader takes over.
 * Then each part of the page carries on from where it actually is.
 */
/** The reader taking over the scroll. */
const TAKE_OVER = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
let jumping = 0;
let jumps = 0;
const afterJump: Array<() => void> = [];
function smoothJump(go: () => void): void {
  const id = ++jumps;
  jumping = id;
  let idle = 0;
  const end = () => {
    window.clearTimeout(idle);
    window.removeEventListener("scroll", moved);
    window.removeEventListener("scrollend", end);
    for (const kind of TAKE_OVER) window.removeEventListener(kind, end);
    if (jumping !== id) return;
    jumping = 0;
    for (const sync of afterJump) sync();
  };
  const moved = () => {
    window.clearTimeout(idle);
    idle = window.setTimeout(end, 150);
  };
  window.addEventListener("scroll", moved, { passive: true });
  window.addEventListener("scrollend", end);
  for (const kind of TAKE_OVER) window.addEventListener(kind, end, { passive: true });
  idle = window.setTimeout(end, 300);
  go();
}

/**
 * How a hand follows the scroll. The work is measured in the hand's own milliseconds (`scale`);
 * `map` turns the scroll's share into how far through that work the page is (0 to 1), so each
 * stroke can have its own stretch of scroll. The pencil eases towards it (time constant `tau`
 * seconds) at no more than `max` of its milliseconds per real second, and settles exactly there.
 */
type Pace = {
  scale: number;
  map?: (share: number) => number;
  tau?: number;
  max?: number;
  /** Start from nothing (rather than where the page already is) and draw up to it. */
  from0?: boolean;
  /** While true, the hand is wherever the scroll says, at once (a jump landing). */
  snap?: () => boolean;
};

/** The hooked tick's three strokes, drawn from the note back to the mark, in its box's own px. */
function hookPath(sx: number): string {
  const x = (v: number) => (v * sx).toFixed(2);
  return [
    `M${x(29)} 6 C ${x(20)} 4, ${x(10)} 6, ${x(3)} 13`,
    `M${x(3)} 13 L ${x(9)} 13`,
    `M${x(3)} 13 L ${x(4)} 7`,
  ]
    .map((d) => `<path d="${d}"/>`)
    .join("");
}

/** A hooked tick drawn to `t` (0 to 1): its strokes one after the other, each by its own dash.
 *  Returns where the drawing has got to, in the tick's own px; with `paint` off, only that. */
function drawHook(svg: SVGElement, t: number, paint = true): [number, number] {
  const paths = [...svg.querySelectorAll("path")];
  const lengths = paths.map((path) => path.getTotalLength());
  let left = lengths.reduce((sum, l) => sum + l, 0) * Math.max(0, Math.min(1, t));
  let at: [number, number] | undefined;
  for (const [i, path] of paths.entries()) {
    const length = lengths[i] as number;
    const drawn = Math.max(0, Math.min(length, left));
    if (paint) {
      path.style.strokeDasharray = `${length.toFixed(2)} ${(length + 1).toFixed(2)}`;
      path.style.strokeDashoffset = (length - drawn).toFixed(2);
      // Hidden entirely until its turn (a round cap would otherwise show a dot).
      path.style.visibility = drawn > 0 ? "" : "hidden";
    }
    if (!at && (drawn < length || i === paths.length - 1)) {
      const point = path.getPointAtLength(drawn);
      at = [point.x, point.y];
    }
    left -= length;
  }
  return at ?? [0, 0];
}

/** The least scroll a stroke is given (px): more than one wheel notch. */
const STROKE_SCROLL = 105;

/** The hand's own pace: about 0.3 s to close most of a gap, never faster than 1.6× its own time. */
const HAND: Omit<Pace, "scale"> = { tau: 0.3, max: 1600 };

/**
 * Drives a typer or a drawing from a share the page works out each frame (the scroll). Without a
 * pace it eases lightly toward it, so a trackpad's inertia doesn't flicker; with one it follows at
 * a hand's pace. Returns a function that stops it.
 */
function scrub(
  type: { to: (share: number) => void },
  share: () => number,
  pace?: Pace,
): () => void {
  let now = Number.NaN;
  let frame = 0;
  let going = false;
  let last = 0;
  const step = (time: number) => {
    const raw = share();
    let target = raw;
    if (pace) {
      const s = Math.max(0, Math.min(1, raw));
      target = (pace.map ? pace.map(s) : s) * pace.scale;
    }
    // The first reading jumps straight there: it is where the page already is.
    if (Number.isNaN(now)) now = pace?.from0 ? 0 : target;
    if (jumping || pace?.snap?.()) now = target;
    if (!pace) {
      now += (target - now) * 0.35;
      if (Math.abs(target - now) < 0.002) now = target;
    } else {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
      const gap = target - now;
      let move = gap * (1 - Math.exp(-dt / (pace.tau ?? 0.38)));
      const most = (pace.max ?? 1300) * dt;
      // Never faster than a hand; never so slow near the end that it crawls.
      const least = Math.min(Math.abs(gap), 90 * dt);
      if (Math.abs(move) > most) move = Math.sign(gap) * most;
      if (Math.abs(move) < least) move = Math.sign(gap) * least;
      now += move;
      if (Math.abs(target - now) < 0.5) now = target;
    }
    type.to(pace ? now / pace.scale : now);
    going = now !== target;
    last = going ? time : 0;
    frame = going ? requestAnimationFrame(step) : 0;
  };
  const wake = () => {
    if (!going) {
      going = true;
      frame = requestAnimationFrame(step);
    }
  };
  // Read in the next frame, not now: measuring here would force a layout inside the caller's task.
  wake();
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", wake);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", wake);
    window.removeEventListener("resize", wake);
  };
}

/* ================================================================== the spine */

/* Built when it nears the screen: nothing of it costs the first view. */
let respine: (() => void) | undefined;
function initSpine(): void {
  /* ================================================================== the spine */

  /*
   * The scene, line by line, with each mark and the beat it is set at. `s` on a segment: the beat
   * its mark appears; on a line: the beat the whole line appears. Every word is the dragon story's
   * own, except the line the writer cuts to Scraps. `slot`: the speaker the reader gives at beat 2.
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
  type Seg = { t: string; k?: Kind; s?: number; who?: string; slot?: boolean; dirSlot?: boolean };
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
  const NARRATOR_COLOR = "#6b5d9c";
  const LINES: Line[] = [
    { segs: [{ t: "## The mountain", k: "head" }] },
    {
      id: "rumble",
      segs: [
        { t: "Then he heard a deep rumble." },
        { t: " [deep rumbling, from inside a cave]", k: "sound", s: 3 },
      ],
    },
    {
      segs: [
        { t: "The dragon was snoring." },
        { t: " @Gerald [snores]", k: "vocal", s: 3, who: G },
      ],
    },
    { s: 3, tight: true, group: 1, segs: [{ t: "::: whispering", k: "group" }] },
    { tight: true, group: 1, segs: [{ t: "Sir Percival crept inside." }] },
    { tight: true, group: 1, segs: [{ t: "Clank." }] },
    { tight: true, group: 1, segs: [{ t: "Clank." }] },
    { id: "pause", s: 3, tight: true, group: 1, segs: [{ t: "{pause}", k: "pause" }] },
    { id: "eye", tight: true, group: 1, segs: [{ t: "The dragon opened one eye." }] },
    { s: 3, group: 1, segs: [{ t: ":::", k: "group" }] },
    {
      id: "could",
      segs: [
        { t: "@Gerald ", k: "name", s: 2, who: G, slot: true },
        { t: "(deep, polite and utterly unbothered) ", k: "dir", s: 3, dirSlot: true },
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
        { t: " <!-- Best line in the scene. Keep it. -->", k: "comment", s: 5 },
      ],
    },
    { id: "battle", s: 4, segs: [{ t: "## The battle", k: "head" }] },
    {
      s: 4,
      tight: true,
      group: 2,
      segs: [
        { t: "::: ", k: "group" },
        { t: "@Percival", k: "name", who: P },
        { t: " trying to sound brave", k: "group" },
      ],
    },
    { s: 4, tight: true, group: 2, segs: [{ t: "I am Sir Percival of the Shining Shield!" }] },
    {
      id: "smite",
      s: 4,
      tight: true,
      group: 2,
      cut: true,
      segs: [{ t: "I shall smite thee most thoroughly!" }],
    },
    { s: 4, tight: true, group: 2, segs: [{ t: "Prepare to meet thy doom!" }] },
    { s: 4, tight: true, group: 2, segs: [{ t: ":::", k: "group" }] },
  ];
  // Where each line of the mountain scene is in the story, to light it as it's heard.
  {
    const full = dragon.story.source;
    let cursor = full.indexOf("## The mountain");
    for (const line of LINES) {
      if (line.s === 4) break;
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
  const STEPS = 7;
  /** Step 1's opening: the scene's first lines, and the dragon's line before anyone has said it. */
  const OPENING: Line[] = [
    LINES[0] as Line,
    LINES[1] as Line,
    LINES[2] as Line,
    { segs: [{ t: "Sir Percival crept inside." }] },
    { segs: [{ t: "“Could you not?”" }] },
  ];
  const CUT_AT = 5;
  const SEG_FROM = 50.2;
  const SEG_TO = 84.5;

  const colorFor = (who?: string) =>
    who === "Narrator" ? NARRATOR_COLOR : who ? (dragonColors.get(who) ?? "#555") : "#555";

  /** A line's HTML. In the mock every mark is there and CSS shows it at its beat; in an example,
   * only what's set by `upTo` is drawn. `pencil`: the words a pencil rings in an example. */
  function lineHtml(
    line: Line,
    upTo?: number,
    pen?: { seg: number; mark: "ring" | "under" },
    fresh?: number,
  ): string {
    return line.segs
      .map((seg, index) => {
        if (upTo !== undefined && seg.s && seg.s > upTo) return "";
        const k = seg.k ?? "text";
        const inked = pen && pen.seg === index ? ` ink-${pen.mark}` : "";
        if (k === "text")
          return inked
            ? `<span class="${inked.trim()}">${escapeHtml(seg.t)}</span>`
            : escapeHtml(seg.t);
        // "Could you not?" and its name take the colour of whoever the reader gave it to.
        const owner = seg.slot || (line.id === "could" && k === "speech") ? who || G : seg.who;
        const style = owner ? ` style="--sp:${colorFor(owner)}"` : "";
        const step = seg.s && upTo === undefined ? ` data-s="${seg.s}"` : "";
        if (k === "speech") {
          // The Writer underlines the words, not the quotation marks around them.
          const open = seg.t.startsWith("“") ? "“" : "";
          const close = seg.t.endsWith("”") ? "”" : "";
          // A one- or two-letter first word stays with the next, never alone at a line's end.
          const words = seg.t
            .slice(open.length, seg.t.length - close.length)
            .replace(/^(\S{1,2}) /, "$1\u00a0");
          return `${open}<span class="k-speech${inked}"${style}>${escapeHtml(words)}</span>${close}`;
        }
        const slot = seg.slot ? " who-slot" : seg.dirSlot ? " dir-slot" : "";
        const isNew = fresh !== undefined && seg.s === fresh ? " new" : "";
        const text = seg.slot ? `@${who || G} ` : seg.dirSlot ? `(${dirOf(who)}) ` : seg.t;
        return `<span class="mk k-${k}${slot}${inked}${isNew}"${step}${style}>${escapeHtml(text)}</span>`;
      })
      .join("");
  }

  function linesHtml(
    lines: Line[],
    upTo?: number,
    pens: Record<string, { seg: number; mark: "ring" | "under"; note: string }> = {},
    fresh?: number,
  ): string {
    return lines
      .filter(
        (line) => upTo === undefined || ((line.s ?? 0) <= upTo && !(line.cut && upTo >= CUT_AT)),
      )
      .map((line, i) => {
        const pen = line.id ? pens[line.id] : undefined;
        const classes = [
          "ln",
          line.tight ? "tight" : "",
          line.group ? `g${line.group}` : "",
          line.cut ? "cut" : "",
          pen ? "noted" : "",
          fresh !== undefined && line.s === fresh ? "new" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const attrs = [
          `class="${classes}"`,
          upTo === undefined && line.s ? `data-s="${line.s}"` : "",
          line.from !== undefined ? `data-line-from="${line.from}"` : "",
          line.id ? `data-id="${line.id}"` : "",
          `data-scene="${line.s === 4 ? "battle" : "mountain"}"`,
          `style="--i:${i}"`,
        ]
          .filter(Boolean)
          .join(" ");
        const note = pen
          ? `<span class="note" aria-hidden="true">${escapeHtml(pen.note)}</span>`
          : "";
        return `<p ${attrs}>${lineHtml(line, upTo, pen, fresh)}${note}</p>`;
      })
      .join("");
  }

  /* The mock's story as it stands: its two scenes in their current order, with "Could you not?"
   given to whoever the reader chose, up to a beat. The cast's counts and every handout come from
   this one text, through the same parser and renderer the Writer uses. */
  function mockText(upTo: number): string {
    const full = dragon.story.source;
    const front = full.slice(0, full.indexOf("---", 4) + 3);
    const block = (scene: "mountain" | "battle") => {
      let out = "";
      for (const line of LINES) {
        if ((line.s === 4 ? "battle" : "mountain") !== scene) continue;
        if ((line.s ?? 0) > upTo || (line.cut && upTo >= CUT_AT)) continue;
        const text = line.segs
          .filter((seg) => !(seg.s && seg.s > upTo) && !(seg.slot && !who))
          .map((seg) => (seg.slot ? `@${who} ` : seg.dirSlot ? `(${dirOf(who)}) ` : seg.t))
          .join("");
        out += text + (line.tight ? "\n" : "\n\n");
      }
      return out.trim();
    };
    const order: Array<"mountain" | "battle"> = battleFirst
      ? ["battle", "mountain"]
      : ["mountain", "battle"];
    return `${front}\n\n${order.map(block).filter(Boolean).join("\n\n")}\n`;
  }
  /** How "Could you not?" is said, by whoever says it. */
  const DIRS: Record<string, string> = {
    Gerald: "deep, polite and utterly unbothered",
    Percival: "in a very small voice",
    Narrator: "drily",
  };
  const dirOf = (handle: string): string => DIRS[handle || G] ?? (DIRS.Gerald as string);
  const nameFor = (handle: string) =>
    handle === "Narrator"
      ? "The narrator"
      : handle === P
        ? "Sir Percival"
        : handle === "King"
          ? "The King"
          : handle;
  /** Each character's lines and words in the mock as it stands at a beat. */
  function castStats(upTo: number): Map<string, { lines: number; words: number }> {
    const stats = new Map<string, { lines: number; words: number }>();
    for (const row of lines(parse(mockText(upTo)), { speechOnly: true })) {
      const key = row.speaker && row.speaker !== "Narrator" ? row.speaker : "Narrator";
      const it = stats.get(key) ?? { lines: 0, words: 0 };
      it.lines += 1;
      it.words += row.text.split(/\s+/).filter((word) => /\w/.test(word)).length;
      stats.set(key, it);
    }
    return stats;
  }
  const statText = (s?: { lines: number; words: number }) =>
    s
      ? `${s.lines} line${s.lines === 1 ? "" : "s"} · ${s.words} word${s.words === 1 ? "" : "s"}`
      : "No lines yet";
  function outputs(): { book: string; script: string; lines: string } {
    const story = parse(mockText(STEPS));
    // The lines of whoever has "Could you not?" (Gerald's, if it went to the narrator).
    const whose = !who || who === "Narrator" ? G : who;
    const said = (textByCharacter(story).get(whose) ?? "").trim().split("\n").filter(Boolean);
    return {
      book: `<div class="book-page" data-vxd-theme="light"><p class="book-run">The Dragon Who Would Not Roar</p>${render.renderBook(story, { header: false })}<p class="book-folio">12</p></div>`,
      script: `<div class="script-page" data-vxd-theme="light">${render.renderScript(story, { header: false })}</div>`,
      lines: `<div class="sides-page" style="--sp:${colorFor(whose)}"><p class="sides-head"><span style="--sp:${colorFor(whose)}">${escapeHtml(nameFor(whose))}</span> · each character’s lines</p>${said
        .map(
          (row) => `<p class="said">${escapeHtml(row).replace(/^\(([^)]*)\)/, "<i>($1)</i>")}</p>`,
        )
        .join("")}</div>`,
    };
  }
  let who = "";
  let battleFirst = false;
  const FIRST_OUT = outputs();
  const BOOK = FIRST_OUT.book;
  const SCRIPT = FIRST_OUT.script;
  const LINES_OF = FIRST_OUT.lines;

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
    return `<div class="lanes" aria-hidden="true">${lanes
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
        const color = lane.key ? colorFor(lane.key) : "#0f766e";
        return `<div class="lane" style="--c:${color}"><span>${lane.name}</span><div class="lane-track">${bits}</div></div>`;
      })
      .join("")}<div class="playhead-rail"><div class="playhead" data-playhead></div></div></div>`;
  }
  const voices = dragon.manifest.voices;
  const AUDIO = `<div class="ab">
  <p class="ab-title">Make an audiobook</p>
  <p class="ab-row"><span>The voices</span><b class="ab-select">ElevenLabs <i aria-hidden="true">▾</i></b></p>
  <ul class="ab-cast">
    <li><span class="dot" style="--sp:${NARRATOR_COLOR}"></span>Narrator<b>${escapeHtml(voices.Narrator ?? "")}</b></li>
    <li><span class="dot" style="--sp:${colorFor(G)}"></span>Gerald<b>${escapeHtml(voices.Gerald ?? "")}</b></li>
    <li><span class="dot" style="--sp:${colorFor(P)}"></span>Sir Percival<b>${escapeHtml(voices.Percival ?? "")}</b></li>
  </ul>
  ${lanesHtml()}
  <p class="ab-now"><span data-seg-who>Voiced from this file</span><span data-seg-clock>0:00 / ${clock(SEG_TO - SEG_FROM)}</span></p>
  <p class="ab-line" data-seg-line>Then he heard a deep rumble.</p>
  <p class="ab-recast" hidden>The recording keeps Gerald: it was voiced from the original file. <button type="button" data-recast>Use the recording’s casting</button></p>
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
  const icon = (name: keyof typeof ICON) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
  const tool = (name: keyof typeof ICON, label: string, hl = "") =>
    `<span class="tb"${hl ? ` data-hl="${hl}"` : ""}>${icon(name)}${label}</span>`;

  /* The cast as the Writer's Cast tab shows it. */
  const CAST = [
    {
      handle: "Narrator",
      name: "Narrator",
      about: "Warm and unhurried, enjoying the joke.",
      stats: "",
    },
    {
      handle: G,
      name: "Gerald",
      about: "An old dragon. Deep, polite and utterly unbothered.",
      stats: "",
    },
    {
      handle: P,
      name: "Sir Percival",
      about: "A young knight. Brave in theory, nervous in practice.",
      stats: "",
    },
  ];
  const castCard = (member: (typeof CAST)[number]) =>
    `<div class="cc" data-cast="${member.handle}" style="--sp:${colorFor(member.handle)}"><p class="cc-h"><span class="dot"></span><span class="cc-at">@</span>${member.handle}<i>→</i></p><p class="cc-s">${statText(castStats(2).get(member.handle))}</p><p class="cc-a">${member.about}</p></div>`;

  /* The picker "Who says this?", as the Writer's: the cast, each in their colour. */
  const pickerHtml = (
    id: string,
  ) => `<div class="picker" id="${id}" role="dialog" aria-label="Who says this?" hidden>
  <p class="picker-h">Who says this?</p>
  <div class="picker-list">${CAST.map(
    (member) =>
      `<button type="button" data-pick="${member.handle}"><span class="dot" style="--sp:${colorFor(member.handle)}" aria-hidden="true"></span>${member.handle === "Narrator" ? "The narrator" : member.name}</button>`,
  ).join("")}</div>
</div>`;

  const tabsHtml = (prefix: string) => `<div class="pv-tabs" role="tablist" aria-label="Preview">
  <button type="button" role="tab" id="${prefix}-t-script" aria-controls="${prefix}-script" aria-selected="true" data-pv="script">Script</button>
  <button type="button" role="tab" id="${prefix}-t-book" aria-controls="${prefix}-book" aria-selected="false" tabindex="-1" data-pv="book">Book</button>
  <button type="button" role="tab" id="${prefix}-t-lines" aria-controls="${prefix}-lines" aria-selected="false" tabindex="-1" data-pv="lines">Each character’s lines</button>
  <span class="pv-title pv-audio" aria-hidden="true">File › Make an audiobook…</span>
</div>`;
  const panelsHtml = (prefix: string) => `
  <div class="pv pv-p-script" role="tabpanel" id="${prefix}-script" aria-labelledby="${prefix}-t-script" tabindex="0">${SCRIPT}</div>
  <div class="pv pv-p-book" role="tabpanel" id="${prefix}-book" aria-labelledby="${prefix}-t-book" tabindex="0">${BOOK}</div>
  <div class="pv pv-p-lines" role="tabpanel" id="${prefix}-lines" aria-labelledby="${prefix}-t-lines" tabindex="0">${LINES_OF}</div>`;

  /* The scene board: one card per scene, with the scene's line, state and real word count. */
  const SCENES = [
    {
      id: "mountain",
      title: "The mountain",
      line: "Percival finds the dragon asleep.",
      state: "Revised",
      tone: "st-rev",
    },
    {
      id: "battle",
      title: "The battle",
      line: "Percival tries to sound brave.",
      state: "Draft",
      tone: "st-draft",
    },
  ];
  function sceneWords(scene: string): number {
    return LINES.filter(
      (line) => (line.s === 4 ? "battle" : "mountain") === scene && (line.s ?? 0) <= 4,
    )
      .flatMap((line) =>
        line.segs.filter((seg) => !seg.k || seg.k === "speech").map((seg) => seg.t),
      )
      .join(" ")
      .split(/\s+/)
      .filter((word) => /\w/.test(word)).length;
  }
  function boardHtml(prefix: string, live: boolean): string {
    const total = SCENES.reduce((sum, scene) => sum + sceneWords(scene.id), 0);
    return `<p class="board-h" id="${prefix}-board-h">Scene board <small>2 scenes · ${total} words</small></p>
  ${live ? `<p class="sr-only" id="${prefix}-board-help">Move a scene with Alt+Up or Alt+Down, or with its arrow buttons; its text moves with it.</p>` : ""}
  <ol class="board-list" data-board aria-labelledby="${prefix}-board-h">${SCENES.map(
    (
      scene,
    ) => `<li class="bcard ${scene.tone}${scene.id === "battle" ? " bcard-new" : ""}" data-scene="${scene.id}"${live ? ` tabindex="0" aria-describedby="${prefix}-board-help"` : ""}>
      <b>${scene.title}</b><i>${scene.line}</i><span><em>${scene.state}</em><small>${sceneWords(scene.id)} words</small></span>
      ${live ? `<span class="moves"><button type="button" data-move="up" aria-label="Move ${scene.title} up">↑</button><button type="button" data-move="down" aria-label="Move ${scene.title} down">↓</button></span>` : ""}
    </li>`,
  ).join("")}</ol>`;
  }

  const benchTabs = () => `
        <span class="bt bt-scenes">${icon("scenes")}<em>Scenes</em></span>
        <span class="bt bt-cast">${icon("cast")}<em>Cast</em></span>
        <span class="bt bt-scraps">${icon("scraps")}<em>Scraps</em></span>
        <span class="bt bt-comments">${icon("comments")}<em>Comments</em></span>
        <span class="bt">${icon("warn")}<small>0</small></span>`;

  function buildMock(wr: HTMLElement): void {
    wr.innerHTML = `
  <div class="wr-top" aria-hidden="true">
    <span class="wr-logo"><img src="../../icon.svg" alt="" width="18" height="18"><b>VoxDown</b> <em>Writer</em></span>
    <span class="wr-menus"><span data-hl="audio">File</span><span>Edit</span><span data-hl="insert">Insert</span><span>View</span><span>Help</span></span>
    <span class="wr-file">the-dragon-who-would-not-roar.vxd <i class="wr-saved"></i><small>Kept in this browser</small></span>
    <span class="wr-sp"></span>
    <span class="wr-save">Save</span><span class="wr-look">◐ Paper</span>
    <span class="wr-ico" data-hl="bench">${icon("left")}</span><span class="wr-ico" data-hl="preview">${icon("right")}</span>
  </div>
  <div class="wr-tools">
    <span class="tb tb-i" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-2"/></svg></span>
    <span class="tb tb-i" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 14l4-4-4-4M19 10h-9a5 5 0 0 0 0 10h2"/></svg></span>
    <i class="tsep"></i><span class="tb tb-i tb-serif" aria-hidden="true"><em>I</em></span><span class="tb tb-i tb-serif" aria-hidden="true"><b>B</b></span><i class="tsep"></i>
    <button type="button" class="tb tb-live" id="wr-who" data-hl="who" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="Control+K" aria-label="Who says this? Give “Could you not?” its speaker">${icon("who")}Who</button>
    <span aria-hidden="true" class="tb-group">${tool("how", "How", "how")}${tool("next", "Next quote")}${tool("ai", "AI")}<i class="tsep"></i>
    ${tool("sound", "Sound", "how")}${tool("pause", "Pause", "how")}${tool("page", "Page turn")}${tool("note", "Note")}<i class="tsep"></i>
    <span class="tb tb-i">${icon("search")}</span><span class="tb tb-i">${icon("outline")}</span><span class="tb tb-i">${icon("warn")}</span><i class="tsep"></i>
    ${tool("hear", "Hear")}</span><span class="wr-sp"></span><span aria-hidden="true">${tool("export", "Export", "export")}</span>
  </div>
  <div class="wr-body">
    <aside class="bench">
      <div class="bench-tabs" aria-hidden="true" id="wr-bench-tabs">${benchTabs()}</div>
      <div class="pane pane-cast" aria-hidden="true">${CAST.map(castCard).join("")}</div>
      <div class="pane pane-scenes">${boardHtml("wr", true)}</div>
      <div class="pane pane-comments" aria-hidden="true">
        <div class="cmt"><small>The mountain · “Imaginary ones…”</small><p>Best line in the scene. Keep it.</p></div>
      </div>
      <div class="pane pane-scraps" aria-hidden="true">
        <div class="scrap"><p>I shall smite thee most thoroughly!</p><small>From The battle · just now</small><span class="scrap-back">Bring back</span></div>
      </div>
    </aside>
    <div class="desk">
      <div class="paper" aria-hidden="true"><div class="doc" id="wr-doc"><div class="doc-lines" id="wr-lines-doc">${linesHtml(LINES, 0, {}, 0)}</div><span class="caret"></span>
        <div class="annot" id="annot"></div>
      </div></div>
      ${pickerHtml("picker")}
    </div>
    <aside class="preview" id="wr-preview">
      ${tabsHtml("wr")}
      ${panelsHtml("wr")}
      <div class="pv pv-p-audio">${AUDIO}</div>
    </aside>
  </div>
  <div class="wr-status" aria-hidden="true"><span data-status>0 words</span><span class="wr-sp"></span><span>Kept in this browser, for now</span></div>`;
  }

  /* ------------------------------------------------------------------ each beat, as a small Writer */

  const miniBar = (pane = "") =>
    `<div class="mini-bar" aria-hidden="true"><img src="../../icon.svg" alt="" width="14" height="14"><b>VoxDown</b><em>Writer</em><span>${pane || "the-dragon-who-would-not-roar.vxd"}</span></div>`;
  const mini = (body: string, pane = "", tools = "") =>
    `<div class="mini">${miniBar(pane)}${tools}<div class="mini-body">${body}</div></div>`;
  const paper = (html: string) => `<div class="mini-paper">${html}</div>`;
  const byId = (...ids: string[]) => LINES.filter((line) => line.id && ids.includes(line.id));

  function exampleHtml(step: number): string {
    switch (step) {
      case 1:
        return mini(paper(linesHtml(OPENING, 1)));
      case 2:
        return mini(
          `${paper(linesHtml(byId("could"), 2, { could: { seg: 2, mark: "ring", note: "who?" } }))}
         ${pickerHtml("picker-phone")}
         <div class="mini-cast who-card"></div>`,
          "",
          `<div class="mini-tools live"><button type="button" class="tb tb-live" data-who-open="picker-phone" aria-haspopup="dialog" aria-expanded="false">${icon("who")}Who says this…</button></div>`,
        );
      case 3:
        return mini(
          paper(
            linesHtml([...LINES.slice(1, 10), ...byId("could")], 3, {
              rumble: { seg: 0, mark: "under", note: "what do we hear?" },
              pause: { seg: 0, mark: "ring", note: "a beat" },
              could: { seg: 1, mark: "under", note: "how?" },
            }),
          ),
        );
      case 4:
        return mini(
          `<div class="mini-board live">${boardHtml("ph", true)}</div>
         <div class="mini-board desk-alt">${boardHtml("sr", false)}</div>
         ${paper(`<div class="scene-page">${linesHtml([LINES[0], LINES[1], ...LINES.filter((line) => line.s === 4).slice(0, 3)] as Line[], 4)}</div>`)}`,
          "Scenes · scene board",
        );
      case 5:
        return mini(
          `${paper(linesHtml(byId("imaginary"), 5))}
         <div class="mini-pane"><p class="ex-h">Comments</p><div class="cmt"><p>Best line in the scene. Keep it.</p></div></div>
         <div class="mini-pane"><p class="ex-h">Scraps</p><div class="scrap is-new"><p>I shall smite thee most thoroughly!</p><small>From The battle</small></div></div>`,
          "Comments · Scraps",
        );
      case 6:
        return `<p class="sr-only desk-alt">The preview shows the scene three ways: the script, each line with its speaker and direction; the book, set as a printed page; and each character’s lines, Gerald’s speeches in order.</p><div class="mini mini-tabs live">${miniBar("Preview")}${tabsHtml("ph")}<div class="mini-body">${panelsHtml("ph")}</div></div>`;
      case 7:
        return mini(AUDIO, "File › Make an audiobook…");
    }
    return "";
  }

  /* The pencil: it rings or underlines the words, and writes its question in the margin. */
  const PEN: Record<number, Array<{ at: string; word: string; shape: "circle" | "under" }>> = {
    2: [{ at: "could .k-speech", word: "who?", shape: "circle" }],
    3: [
      { at: "could .k-dir", word: "how?", shape: "under" },
      { at: "rumble", word: "what do we hear?", shape: "circle" },
      { at: "pause", word: "a beat", shape: "circle" },
    ],
  };

  // The marks' own ink, read once, for the pencil's lead.
  const inks: { ring?: Ink; under?: Ink; arrow?: Ink } = {};
  const inksReady = Promise.all(
    (["ring", "under", "arrow"] as const).map(async (name) => {
      const file = { ring: "pencil-circle", under: "pencil-underline", arrow: "pencil-arrow" }[name];
      const ink = await inkOf(`../../landing/studio/pen/${file}.webp`);
      if (ink) inks[name] = ink;
    }),
  );
  const wr = $("#wr");
  buildMock(wr);
  const doc = $("#wr-doc");
  const annot = $("#annot");
  const steps = $$("#steps .step");
  const jump = $("#jump");
  const caption = $("#caption-words");
  const preview = $("#wr-preview");
  let active = -1;

  // The step buttons, and each beat's example.
  for (const step of steps) {
    const n = Number(step.dataset.step);
    const example = document.createElement("div");
    example.className = "step-example";
    example.innerHTML = `<p class="sr-only phone-only">In the Writer:</p>${exampleHtml(n)}`;
    const button = step.querySelector(".step-play");
    if (button) step.insertBefore(example, button);
    else step.append(example);
    if (step.dataset.try) {
      const tryIt = document.createElement("p");
      tryIt.className = "step-try live";
      tryIt.textContent = step.dataset.tryPhone ?? step.dataset.try;
      step.insertBefore(tryIt, example);
    }
    const label = document.createElement("p");
    label.className = "step-label";
    // The phone's label: the feature, without keyboard shortcuts.
    const feature = (step.dataset.feature ?? "").replace(/ · (Ctrl|Alt)\+\S+/g, "");
    label.innerHTML = `<span>${n}</span> ${escapeHtml(step.dataset.label ?? "")} <em>${escapeHtml(feature)}</em>`;
    step.prepend(label);
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" data-go="${n}"><span aria-hidden="true">${n}</span>${escapeHtml(step.dataset.label ?? "")}</button>`;
    jump.append(li);
  }
  const lanesRoots = () => $$(".lanes");

  const TAB_OF: Record<number, string> = { 2: "cast", 3: "cast", 4: "scenes", 5: "comments" };
  const HL_OF: Record<number, string> = {
    2: "who",
    3: "how",
    4: "bench",
    5: "insert",
    6: "preview",
    7: "audio",
  };
  /** The lines each step is about: all shown, with their notes, above the status bar. The last is the
   * one that must be seen if they can't all fit. */
  const FOCUS_OF: Record<number, string[]> = {
    2: ["could"],
    3: ["rumble", "pause", "could"],
    4: ["battle"],
    5: ["imaginary"],
  };

  const countWords = (text: string) => text.split(/\s+/).filter((word) => /\w/.test(word)).length;
  const OPENING_WORDS = countWords(
    OPENING.slice(1)
      .flatMap((line) =>
        line.segs.filter((seg) => !seg.k || seg.k === "speech").map((seg) => seg.t),
      )
      .join(" "),
  );

  function wordCount(upTo: number): number {
    return LINES.filter((line) => (line.s ?? 0) <= upTo && !(line.cut && upTo >= CUT_AT))
      .flatMap((line) =>
        line.segs.filter((seg) => !seg.k || seg.k === "speech").map((seg) => seg.t),
      )
      .join(" ")
      .split(/\s+/)
      .filter((word) => /\w/.test(word)).length;
  }

  /* ------------------------------------------------------------------ "Who says this?", live */

  function giveWho(handle: string, quietly = false): void {
    who = handle;
    const color = colorFor(handle);
    for (const slot of $$(".who-slot")) {
      slot.textContent = `@${handle} `;
      slot.style.setProperty("--sp", color);
      // The reader's own answer shows at once: a short flash, no waiting on the scroll's set-in.
      slot.classList.remove("new");
      if (!quietly && !calm.matches) {
        slot.classList.remove("flash");
        void slot.offsetWidth;
        slot.classList.add("flash");
      }
    }
    for (const speech of $$('[data-id="could"] .k-speech')) speech.style.setProperty("--sp", color);
    for (const host of [wr, ...$$(".step-example")]) host.classList.add("who-set");
    for (const card of $$(".cc")) card.classList.toggle("cc-new", card.dataset.cast === handle);
    const member = CAST.find((m) => m.handle === handle);
    for (const holder of $$(".who-card")) holder.innerHTML = member ? castCard(member) : "";
    refresh();
    // On the phone's page, the pencilled question answered.
    // How it's said follows who says it: the mark, step 3's heading and its caption.
    const dir = dirOf(handle);
    for (const slot of $$(".dir-slot")) slot.textContent = `(${dir}) `;
    const how = steps[2] ? $("h3", steps[2] as HTMLElement) : undefined;
    if (how) how.textContent = `${dir.charAt(0).toUpperCase()}${dir.slice(1)}.`;
    sizeCaption();
    for (const note of $$('.step[data-step="2"] .step-example [data-id="could"] .note'))
      note.innerHTML = `<s>who?</s><br>${escapeHtml(shortName(handle))}${TICK}`;
    for (const note of $$(".ab-recast")) note.hidden = handle === G;
    if (!quietly) {
      const name = handle === "Narrator" ? "the narrator" : (member?.name ?? handle);
      announce(
        `“Could you not?” is now ${name}’s${handle === "Narrator" ? "" : ", and his card is in the Cast"}.${handle === G ? "" : " The recording gave it to Gerald."}`,
      );
    }
    // The pencil's ring was measured with no name before the quote: measured again, and answered.
    if (active === 2 && window.innerWidth > 860) drawPen(2, true);
  }

  /** Everything that comes from the story as it stands: the cast's counts and the handouts. */
  function refresh(): void {
    const stats = castStats(Math.max(2, Math.min(active, STEPS)));
    for (const line of $$<HTMLElement>(".cc[data-cast]"))
      $(".cc-s", line).textContent = statText(stats.get(line.dataset.cast as string));

    const made = outputs();
    for (const panel of $$(".pv-p-script")) panel.innerHTML = made.script;
    for (const panel of $$(".pv-p-book")) panel.innerHTML = made.book;
    for (const panel of $$(".pv-p-lines")) panel.innerHTML = made.lines;
  }
  const shortName = (handle: string) => (handle === "Narrator" ? "narrator" : handle);
  const TICK =
    '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13l5 5L20 6"/></svg>';

  function openPicker(picker: HTMLElement, opener: HTMLButtonElement): void {
    if (picker.id === "picker") {
      // In the mock: under the quote, wherever the scroll has put it.
      const line = doc.querySelector<HTMLElement>('[data-id="could"]');
      const desk = picker.parentElement as HTMLElement;
      if (line) {
        const box = line.getBoundingClientRect();
        const base = desk.getBoundingClientRect();
        picker.style.left = `${Math.max(8, box.left - base.left)}px`;
        picker.style.top = `${box.bottom - base.top + 8}px`;
      }
    }
    picker.hidden = false;
    opener.setAttribute("aria-expanded", "true");
    const current = picker.querySelector<HTMLButtonElement>(`[data-pick="${who || G}"]`);
    (current ?? picker.querySelector<HTMLButtonElement>("button"))?.focus();
    const close = (focus = true) => {
      picker.hidden = true;
      opener.setAttribute("aria-expanded", "false");
      picker.removeEventListener("keydown", keys);
      document.removeEventListener("pointerdown", outside, true);
      if (focus) opener.focus();
    };
    const keys = (event: KeyboardEvent) => {
      const buttons = $$<HTMLButtonElement>("button", picker);
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        buttons[
          (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
      } else if (event.key === "Tab") close(false);
    };
    const outside = (event: Event) => {
      if (!picker.contains(event.target as Node) && event.target !== opener) close(false);
    };
    picker.addEventListener("keydown", keys);
    document.addEventListener("pointerdown", outside, true);
    picker.onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pick]");
      if (!button) return;
      giveWho(button.dataset.pick as string);
      close();
    };
  }

  {
    const whoButton = $<HTMLButtonElement>("#wr-who");
    const open = () => {
      if (active !== 2) goTo(2);
      requestAnimationFrame(() => openPicker($("#picker"), whoButton));
    };
    whoButton.addEventListener("click", open);
    document.addEventListener("keydown", (event) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "k" ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (active !== 2 || window.innerWidth <= 860) return;
      const box = wr.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      event.preventDefault();
      open();
    });
    for (const button of $$<HTMLButtonElement>("[data-who-open]"))
      button.addEventListener("click", () => openPicker($(`#${button.dataset.whoOpen}`), button));
  }

  /* ------------------------------------------------------------------ preview tabs, live */

  function bindTabs(root: HTMLElement, onPick: (pane: string) => void): (pane: string) => void {
    const tabs = $$<HTMLButtonElement>("[role=tab]", root);
    const select = (pane: string) => {
      for (const tab of tabs) {
        const on = tab.dataset.pv === pane;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
      }
      onPick(pane);
    };
    for (const [i, tab] of tabs.entries()) {
      tab.addEventListener("click", () => select(tab.dataset.pv as string));
      tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length] as HTMLButtonElement;
        select(next.dataset.pv as string);
        next.focus();
      });
    }
    return select;
  }
  const pickPane = bindTabs(preview, (pane) => {
    wr.dataset.pane = pane;
  });
  {
    const phone = document.querySelector<HTMLElement>(".mini-tabs");
    if (phone) {
      const pick = bindTabs(phone, (pane) => {
        phone.dataset.pane = pane;
      });
      pick("script");
    }
  }

  /* ------------------------------------------------------------------ the scene board, live */

  function moveScene(scene: string, way: "up" | "down", from?: HTMLElement): void {
    const title = scene === "battle" ? "The battle" : "The mountain";
    const first = scene === "battle" ? way === "up" : way === "down";
    if (first === battleFirst) {
      announce(`${title} is already ${way === "up" ? "first" : "last"}.`);
      return;
    }
    battleFirst = first;
    for (const host of [wr, ...$$(".step-example")])
      host.classList.toggle("battle-first", battleFirst);
    for (const list of $$("[data-board]")) {
      const cards = $$(".bcard", list);
      const order = battleFirst ? ["battle", "mountain"] : ["mountain", "battle"];
      for (const id of order) {
        const card = cards.find((c) => c.dataset.scene === id);
        if (card) list.append(card);
      }
    }
    refresh();
    const other = scene === "battle" ? "The mountain" : "The battle";
    announce(
      `${title} moved ${way === "up" ? "before" : "after"} ${other}. Its text moved with it.`,
    );
    from?.focus();
    if (active === 4 && window.innerWidth > 860) scrollDoc(["battle"]);
  }
  for (const list of $$("[data-board]")) {
    list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-move]");
      const card = button?.closest<HTMLElement>(".bcard");
      if (button && card)
        moveScene(card.dataset.scene as string, button.dataset.move as "up" | "down", button);
    });
    list.addEventListener("keydown", (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(".bcard");
      if (!card || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      moveScene(card.dataset.scene as string, event.key === "ArrowUp" ? "up" : "down", card);
    });
    // Dragging a card by pointer: past half its height, it takes the other's place.
    list.addEventListener("pointerdown", (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(".bcard");
      if (!card || (event.target as HTMLElement).closest("button") || event.pointerType === "touch")
        return;
      const startY = event.clientY;
      const half = card.offsetHeight / 2;
      card.setPointerCapture(event.pointerId);
      card.classList.add("dragging");
      const moveWith = (e: PointerEvent) => {
        const dy = e.clientY - startY;
        card.style.transform = `translateY(${dy}px)`;
      };
      const drop = (e: PointerEvent) => {
        const dy = e.clientY - startY;
        card.classList.remove("dragging");
        card.style.transform = "";
        card.removeEventListener("pointermove", moveWith);
        if (Math.abs(dy) > half)
          moveScene(card.dataset.scene as string, dy < 0 ? "up" : "down", card);
      };
      card.addEventListener("pointermove", moveWith);
      card.addEventListener("pointerup", drop, { once: true });
      card.addEventListener(
        "pointercancel",
        () => {
          card.classList.remove("dragging");
          card.style.transform = "";
          card.removeEventListener("pointermove", moveWith);
        },
        { once: true },
      );
    });
  }

  /* ------------------------------------------------------------------ the beats */

  function setStep(n: number): void {
    if (n === active) return;
    // Moving on from "who?" untried: the line is Gerald's, as written.
    if (n > 2 && !who && window.innerWidth > 860) giveWho(G, true);
    active = n;
    refresh();
    wr.dataset.step = String(n);
    for (let k = 1; k <= STEPS; k++) wr.classList.toggle(`s${k}`, k <= n);
    setTab(TAB_OF[n] ?? "");
    wr.dataset.hl = HL_OF[n] ?? "";
    if (n === 6) pickPane("script");
    else wr.dataset.pane = n === 7 ? "audio" : "";
    preview.inert = n !== 6 && n !== 7;
    // Comments, then the cut line lands in Scraps.
    if (n === 5 && calm.matches) setTab("scraps");
    // The page drawn afresh for the beat: its new marks and lines arrive, nothing already there moves.
    $("#wr-lines-doc").innerHTML =
      n === 1 ? linesHtml(OPENING, 1) : linesHtml(LINES, Math.max(n, 0), {}, n);
    // The step's tags and directions set into the text by the scroll (after the pencil's marks, where
    // it makes any); step 5's cut line goes to Scraps halfway through.
    stopSetIn?.();
    stopSetIn = undefined;
    wr.style.removeProperty("--set");
    // Where the pencil marks the page, it sets them in itself once its marks are made.
    if (!calm.matches && PEN[n] && window.innerWidth > 860) {
      if (landing !== n) wr.style.setProperty("--set", "0");
    } else if (!calm.matches && n >= 2) {
      const after = 0;
      const span = 0.5;
      stopSetIn = scrub(
        {
          to: (share) => {
            wr.style.setProperty(
              "--set",
              Math.max(0, Math.min(1, (share - after) / span)).toFixed(3),
            );
            if (n === 5) setTab(share >= 0.5 ? "scraps" : "comments");
          },
        },
        () => stepShare(n),
        { ...HAND, scale: 900 },
      );
    }
    // Step 1 is typed by the scroll: down types, up untypes. Leaving it stops the scrubbing.
    finishTyping?.();
    finishTyping = undefined;
    const caret = $(".caret", wr);
    caret.style.transform = "";
    const typeNow = n === 1 && !calm.matches;
    for (const [i, button] of $$<HTMLButtonElement>("[data-go]").entries()) {
      if (i + 1 === n) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    caption.innerHTML = captionHtml(n);
    {
      const whoButton = $<HTMLButtonElement>("#wr-who");
      const live = n === 2;
      whoButton.tabIndex = live ? 0 : -1;
      if (live) whoButton.removeAttribute("aria-hidden");
      else whoButton.setAttribute("aria-hidden", "true");
    }
    $(".caption .finale-label").textContent =
      player.owner === finaleOwner && playing()
        ? "Pause"
        : n === STEPS
          ? "Play the scene"
          : "Hear it voiced";
    const status = (words: number) =>
      `${words} word${words === 1 ? "" : "s"} · ${n >= 2 ? "3 voices" : "1 voice"} · ${n >= 4 ? "2 scenes" : "1 scene"}`;
    $("[data-status]", wr).textContent = status(n === 1 ? OPENING_WORDS : wordCount(n));
    if (typeNow) {
      // The status bar counts only what has been typed.
      $("[data-status]", wr).textContent = status(0);
      const type = typer($("#wr-lines-doc"), caret, (typed) => {
        $("[data-status]", wr).textContent = status(countWords(typed));
      });
      // The typing runs over the first 65% of the step's scroll, and holds whole for the rest.
      finishTyping = scrub(type, () => stepShare(1));
    }
    if (n < STEPS - 1 && player.owner === finaleOwner && playing() && window.innerWidth > 860)
      player.audio?.pause();
    const picker = $("#picker");
    if (!picker.hidden && n !== 2) picker.hidden = true;
    if (window.innerWidth <= 860) return;
    scrollDoc(FOCUS_OF[n]);
    finishPen?.();
    annot.replaceChildren();
    // The pencil measures the words once they're laid out, in their fonts, and the page has moved.
    const draw = () => {
      if (active === n) drawPen(n);
    };
    Promise.all([document.fonts.ready, inksReady]).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(draw)),
    );
  }

  let finishTyping: (() => void) | undefined;
  let stopSetIn: (() => void) | undefined;
  /** How far through a step's scroll its choreography completes: the typing, then the marks. */
  const doneBy = (n: number) => (n === 1 ? 0.65 : 0.85);
  /** Where the reader is in step n's choreography: 0 at its start, 1 once it's complete. */
  function stepShare(n: number): number {
    const step = steps[n - 1];
    if (!step || landing === n) return 1;
    const box = step.getBoundingClientRect();
    return (window.innerHeight / 2 - box.top) / box.height / doneBy(n);
  }
  /** The step a jump is landing on: its marks are shown complete, not drawn on the way. */
  let landing = 0;
  for (const kind of TAKE_OVER)
    window.addEventListener(
      kind,
      () => {
        landing = 0;
      },
      { passive: true },
    );

  function captionHtml(n: number): string {
    const step = steps[n - 1];
    return step
      ? `<p class="cap-n"><span>${n}</span>${escapeHtml(step.dataset.feature ?? "")}</p><p class="cap-h">${escapeHtml($("h3", step).textContent ?? "")}</p><p class="cap-p">${escapeHtml($("h3 + p", step).textContent ?? "")}${step.dataset.try ? ` <b class="cap-try">${escapeHtml(step.dataset.try)}</b>` : ""}</p>`
      : `<p class="cap-n"><span>0</span>A new story</p><p class="cap-h">A blank page.</p><p class="cap-p">Scroll, or pick a step above, and the scene begins.</p>`;
  }
  /** The caption is as tall as its tallest beat at this width, so nothing below it ever moves. */
  function sizeCaption(): void {
    const box = caption.parentElement as HTMLElement;
    const probe = caption.cloneNode() as HTMLElement;
    probe.removeAttribute("id");
    probe.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${caption.getBoundingClientRect().width}px`;
    box.append(probe);
    let tallest = 0;
    for (let n = 0; n <= STEPS; n++) {
      probe.innerHTML = captionHtml(n);
      tallest = Math.max(tallest, probe.getBoundingClientRect().height);
    }
    probe.remove();
    box.style.minHeight = `${Math.ceil(tallest)}px`;
  }

  /** A workbench tab, its row drawn afresh so a label appearing moves nothing that was there. */
  function setTab(tab: string): void {
    if (wr.dataset.tab === tab) return;
    wr.dataset.tab = tab;
    $("#wr-bench-tabs").innerHTML = benchTabs();
  }

  function goTo(n: number): void {
    const step = steps[n - 1];
    if (!step) return;
    const box = step.getBoundingClientRect();
    // Step 1 is landed on just past where its typing completes, so it shows the whole opening.
    // Every step is landed on just past where its choreography completes.
    const at = doneBy(n) + 0.03;
    const top = window.scrollY + box.top + box.height * at - window.innerHeight / 2;
    // Only the step jumped to is shown, complete, all the way there.
    smoothJump(() => {
      landing = n;
      setStep(n);
      window.scrollTo({ top, behavior: calm.matches ? "auto" : "smooth" });
    });
  }

  function scrollDoc(ids: string[] = []): void {
    const page = doc.parentElement as HTMLElement;
    const room = page.clientHeight;
    const most = Math.max(0, doc.scrollHeight - room + 24);
    const lines = ids
      .map((id) => doc.querySelector<HTMLElement>(`[data-id="${id}"]`))
      .filter((line): line is HTMLElement => Boolean(line?.offsetParent));
    let y = 0;
    if (lines.length) {
      // Room above for a ring or a note, below for a ring's lower stroke.
      const top = Math.min(...lines.map((l) => l.offsetTop)) - 18;
      const bottom = Math.max(...lines.map((l) => l.offsetTop + l.offsetHeight)) + 18;
      const last = lines[lines.length - 1] as HTMLElement;
      y =
        bottom - top <= room
          ? top - (room - (bottom - top)) / 2
          : last.offsetTop + last.offsetHeight + 18 - room;
    }
    doc.style.transform = `translateY(${-Math.min(most, Math.max(0, y))}px)`;
  }

  /** A step's pencil, drawing; finishing it at once leaves its marks complete. */
  let finishPen: (() => void) | undefined;

  /**
   * The words a mark is about: a quote with its quotation marks, or a line's own sentence (not the
   * sound tag after it). Rings and underlines are sized from these.
   */
  function circled(line: HTMLElement, target: HTMLElement, inner: boolean): Range {
    const range = document.createRange();
    if (inner && target.classList.contains("k-speech")) {
      range.selectNodeContents(target);
      const before = target.previousSibling;
      const after = target.nextSibling;
      if (before?.nodeType === Node.TEXT_NODE && (before as Text).data.endsWith("“"))
        range.setStart(before, (before as Text).data.length - 1);
      if (after?.nodeType === Node.TEXT_NODE && (after as Text).data.startsWith("”"))
        range.setEnd(after, 1);
      return range;
    }
    if (!inner) {
      const own = [...line.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (own) {
        range.selectNodeContents(own);
        return range;
      }
    }
    range.selectNodeContents(target);
    return range;
  }

  function drawPen(n: number, answered = false): void {
    finishPen?.();
    finishPen = undefined;
    annot.replaceChildren();
    const marks = PEN[n];
    if (!marks) return;
    // The margin: the strip of paper right of the text, where an editor writes.
    const margin = doc.clientWidth - Number.parseFloat(getComputedStyle(doc).paddingRight) + 16;
    const base = doc.getBoundingClientRect();
    type Stroke = {
      el: HTMLElement | SVGElement;
      kind: "ring" | "under" | "lead" | "word";
      x: number;
      y: number;
      w: number;
      h: number;
      /** A note's line: its letters as ink, and where a point in it lands on the annotations. */
      words?: Words;
      place?: (x: number, y: number) => [number, number];
    };
    const strokes: Stroke[] = [];
    for (const mark of marks) {
      const [id, inner] = mark.at.split(" ");
      const line = doc.querySelector<HTMLElement>(`[data-id="${id}"]`);
      const target = inner ? line?.querySelector<HTMLElement>(inner) : line;
      if (!line || !target || !target.offsetParent) continue;
      const range = circled(line, target, Boolean(inner));
      const first = range.getBoundingClientRect();
      const x = first.left - base.left;
      const y = first.top - base.top;
      const w = first.width;
      const h = first.height;
      // The leader runs from the end of the row's ink (marks included) to the margin.
      const whole = document.createRange();
      whole.selectNodeContents(line);
      const end = Math.max(
        x + w,
        ...[...whole.getClientRects()]
          .filter((r) => r.width > 0 && r.top < first.bottom - 3 && r.bottom > first.top + 3)
          .map((r) => r.right - base.left),
      );
      const group = document.createElement("div");
      // "who?" answered: struck through, the speaker named, a tick; nothing left to draw.
      const done = mark.word === "who?" && Boolean(who);
      group.className = `pen mark-${mark.shape}${done ? " pen-done" : ""}${answered ? " pen-now" : ""}`;
      // A ring sized by the loop drawn in its picture: at mid-height the loop's inside runs from
      // 10.3% to 92.2% of the picture, so the words sit inside it with room on both sides.
      const ringW = w * 1.28 + 34;
      const ringH = h + 28;
      const ringLeft = x + w / 2 - 0.5125 * ringW;
      const shape =
        mark.shape === "circle"
          ? `<img class="ring" src="../../landing/studio/pen/pencil-circle.webp" alt="" style="left:${ringLeft.toFixed(1)}px;top:${y - 14}px;width:${ringW.toFixed(1)}px;height:${ringH}px">`
          : `<img class="under" src="../../landing/studio/pen/pencil-underline.webp" alt="" style="left:${x - 4}px;top:${y + h - 9}px;width:${w + 8}px;height:20px">`;
      const reach = Math.max(end, mark.shape === "circle" ? ringLeft + 0.95 * ringW : end);
      const leadFrom = reach + 10;
      const lead = margin - 8 - leadFrom;
      // Every note points back at its mark: an arrow where there's room, a short hooked tick where not.
      const hookW = Math.max(0, Math.min(30, margin - 4 - (end + 6)));
      const leader =
        lead >= 40
          ? `<img class="lead" src="../../landing/studio/pen/pencil-arrow.webp" alt="" style="left:${leadFrom.toFixed(1)}px;top:${y + h / 2 - 9}px;width:${lead.toFixed(1)}px;height:18px">`
          : hookW >= 12
            ? `<svg class="lead hook" viewBox="0 0 ${hookW.toFixed(1)} 20" aria-hidden="true" style="left:${(margin - 4 - hookW).toFixed(1)}px;top:${y + h / 2 - 12}px;width:${hookW.toFixed(1)}px;height:20px">${hookPath(hookW / 30)}</svg>`
            : "";
      const words = done
        ? `<i><s>who?</s><br>${escapeHtml(shortName(who))}</i>${TICK}`
        : `<i>${escapeHtml(mark.word)}</i>`;
      group.innerHTML = `${shape}${leader}<span class="hand" style="left:${margin}px;top:${y + h / 2 - 12}px">${words}</span>`;
      annot.append(group);
      if (done) continue;
      const annotBox = annot.getBoundingClientRect();
      const boxOf = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { x: b.left - annotBox.left, y: b.top - annotBox.top, w: b.width, h: b.height };
      };
      const ring = $(".ring, .under", group);
      strokes.push({ el: ring, kind: mark.shape === "circle" ? "ring" : "under", ...boxOf(ring) });
      // The note, a line at a time: each line written left to right, with the pencil along it.
      const letters = $(".hand i", group);
      const parts = (letters.textContent ?? "").split(" ");
      letters.innerHTML = parts
        .map((part) => `<span class="nw">${escapeHtml(part)}</span>`)
        .join(" ");
      const rows: string[][] = [];
      let rowTop = Number.NaN;
      for (const span of $$("span.nw", letters)) {
        if (span.offsetTop !== rowTop) {
          rows.push([]);
          rowTop = span.offsetTop;
        }
        (rows[rows.length - 1] as string[]).push(span.textContent ?? "");
      }
      letters.innerHTML = rows
        .map((row) => `<span class="nl">${escapeHtml(row.join(" "))}</span>`)
        .join("<br>");
      // Each line's letters as ink; the note is slanted (its <i> skewed about its middle), so a
      // point in a line is carried through that slant onto the annotations.
      const handBox = group.querySelector<HTMLElement>(".hand")?.getBoundingClientRect();
      const annotLeft = annot.getBoundingClientRect();
      const slant = new DOMMatrix(getComputedStyle(letters).transform).c;
      const middle = letters.offsetTop + letters.offsetHeight / 2;
      for (const row of $$("span.nl", letters)) {
        const b = boxOf(row);
        const hx = (handBox?.left ?? 0) - annotLeft.left;
        const hy = (handBox?.top ?? 0) - annotLeft.top;
        const place = (x: number, y: number): [number, number] => {
          const px = row.offsetLeft + x;
          const py = row.offsetTop + y;
          return [hx + px + slant * (py - middle), hy + py];
        };
        strokes.push({ el: row, kind: "word", ...b, w: b.w + 4, words: wordsOf(row), place });
      }
      // Then the line from the note back to its mark.
      const leadEl = group.querySelector<HTMLElement | SVGElement>(".lead");
      if (leadEl) strokes.push({ el: leadEl, kind: "lead", ...boxOf(leadEl) });
    }
    if (calm.matches || answered || !strokes.length) return;

    // One pencil, its lead (at 4.9% and 96.2% of its picture) at the point it is drawing.
    const pencil = document.createElement("img");
    pencil.className = "pencil-tip";
    pencil.src = "../../landing/studio/pen/red-pencil.webp";
    pencil.alt = "";
    annot.classList.add("drawing");
    annot.append(pencil);

    // Where the lead is while a stroke is drawn to `t` (0 to 1): on the very end of the ink that
    // the stroke's own reveal shows. A ring's conic mask, from ten o'clock round and a little over:
    // where its edge crosses the ring's ink. An underline, shown from the left, and an arrow,
    // mirrored and shown from the right (from the note back to its mark): the last column of ink
    // shown, at the ink's middle. A note's line: the end of its letters shown. A hooked tick: the
    // furthest point of its path the clip shows.
    const tipAt = (s: Stroke, t: number): [number, number] => {
      if (s.kind === "ring" && inks.ring) {
        const [x, y] = ringEnd(inks.ring, s.w, s.h, -60 + t * 380);
        return [s.x + x, s.y + y];
      }
      if (s.kind === "under" && inks.under) {
        const [u, v] = pictureEnd(inks.under, t, s.h);
        return [s.x + u * s.w, s.y + v * s.h];
      }
      if (s.kind === "lead" && s.el instanceof SVGElement) {
        // The very paths being dashed, at the dash's length (their own px: no scaling between).
        const [x, y] = drawHook(s.el, t, false);
        return [s.x + x, s.y + y];
      }
      if (s.kind === "lead" && inks.arrow) {
        const [u, v] = inkEnd(inks.arrow, t);
        return [s.x + (1 - u) * s.w, s.y + v * s.h];
      }
      if (s.kind === "word" && s.words && s.place) return s.place(...wordsEnd(s.words, t));
      return [s.x + s.w * t, s.y + s.h / 2];
    };
    const startAt = (s: Stroke): [number, number] => tipAt(s, 0);
    const endAt = (s: Stroke): [number, number] => tipAt(s, 1);
    // How long a hand takes over each stroke (its own milliseconds), by its length: a ring by the
    // way round it, a note by its letters, an underline or a leader by its run.
    const handTime = (s: Stroke): number => {
      if (s.kind === "ring") {
        const a = s.w / 2;
        const b = s.h / 2;
        const round = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
        return Math.max(780, Math.min(1000, round * 1.1));
      }
      if (s.kind === "word") return 100 + (s.el.textContent ?? "").replace(/\s/g, "").length * 140;
      if (s.kind === "under") return Math.max(350, Math.min(700, s.w * 2));
      return Math.max(240, Math.min(500, s.w * 2.2));
    };
    type Seg = { s: Stroke; move: number; from: number; to: number };
    const plan: Seg[] = [];
    // The scroll each part gets: [its hand time, its weight of scroll]. A stroke never gets less than
    // a wheel notch's worth, so one notch never completes more than one stroke.
    const parts: Array<[number, number, number]> = [];
    let clock = 0;
    let from: [number, number] | undefined;
    for (const s of strokes) {
      const start = startAt(s);
      // The travel to it: a moment to arrive, then by the distance.
      const move = from
        ? Math.min(380, 150 + Math.hypot(start[0] - from[0], start[1] - from[1]) * 0.35)
        : 300;
      const draw = handTime(s);
      parts.push([move, 0, 0], [draw, 0, 1]);
      plan.push({ s, move, from: clock + move, to: clock + move + draw });
      clock += move + draw;
      from = endAt(s);
    }
    // A visible pause once the marks are made (the pencil lifts away in it), then the tags set in.
    const LIFT = 300;
    const PAUSE = 220;
    const SET = 380;
    const setFrom = clock + PAUSE;
    const total = setFrom + SET;
    parts.push([PAUSE, 0, 0], [SET, 0, 0]);
    // The step's span shared out by hand time, so a steady scroll keeps the hand at an even pace;
    // a stroke never gets less than a wheel notch's worth.
    {
      const box = steps[n - 1]?.getBoundingClientRect();
      const span = (box?.height ?? 600) * doneBy(n);
      const time = parts.reduce((sum, [t]) => sum + t, 0);
      let rate = span / time;
      for (let i = 0; i < 8; i++) {
        const floored = parts.filter(([t, , stroke]) => stroke && t * rate < STROKE_SCROLL);
        const rest = time - floored.reduce((sum, [t]) => sum + t, 0);
        rate = Math.max(0, span - floored.length * STROKE_SCROLL) / Math.max(1, rest);
      }
      for (const part of parts)
        part[1] = part[2] ? Math.max(STROKE_SCROLL, part[0] * rate) : part[0] * rate;
    }
    // Scroll share to hand time, part by part.
    const weight = parts.reduce((sum, [, w]) => sum + w, 0);
    const map = (share: number): number => {
      let s0 = 0;
      let t0 = 0;
      for (const [time, w] of parts) {
        const s1 = s0 + w / weight;
        if (share <= s1) return (t0 + (time * (share - s0)) / (s1 - s0 || 1)) / total;
        s0 = s1;
        t0 += time;
      }
      return 1;
    };
    wr.dataset.penWeight = String(Math.round(weight));
    const reveal = (s: Stroke, k: number) => {
      if (s.el instanceof SVGElement) {
        // The hooked tick, drawn along its own paths: the dash's end is where the lead is.
        drawHook(s.el, k);
        return;
      }
      if (k >= 1) {
        s.el.style.maskImage = "";
        s.el.style.removeProperty("-webkit-mask-image");
        s.el.style.clipPath = "";
        return;
      }
      const p = Math.max(0, k);
      if (s.kind === "ring") {
        s.el.style.maskImage = `conic-gradient(from -60deg, #000 ${(p * 380).toFixed(1)}deg, transparent 0)`;
        s.el.style.setProperty("-webkit-mask-image", s.el.style.maskImage);
      } else if (s.kind === "lead") {
        // From the note's end back towards the mark. The arrow picture is mirrored, so its own right
        // is the screen's left.
        s.el.style.clipPath = `inset(-20% ${((1 - p) * 100).toFixed(1)}% -20% 0)`;
      } else s.el.style.clipPath = `inset(-20% ${((1 - p) * 100).toFixed(1)}% -20% 0)`;
    };
    const first = startAt((plan[0] as Seg).s);
    const offstage: [number, number] = [first[0] + 90, first[1] - 70];
    /** The step's marks at a point in their choreography: everything set from that alone. */
    const render = (t: number) => {
      let pos: [number, number] = offstage;
      let fade = 1;
      let prevEnd: [number, number] = offstage;
      let placed = false;
      for (const seg of plan) {
        const k = Math.max(0, Math.min(1, (t - seg.from) / (seg.to - seg.from)));
        reveal(seg.s, k);
        if (placed) continue;
        if (t < seg.from) {
          // Travelling to this stroke's start.
          const m = Math.max(0, Math.min(1, (t - (seg.from - seg.move)) / seg.move));
          const target = startAt(seg.s);
          const e = m * m * (3 - 2 * m);
          pos = [
            prevEnd[0] + (target[0] - prevEnd[0]) * e,
            prevEnd[1] + (target[1] - prevEnd[1]) * e,
          ];
          if (seg === plan[0]) fade = m;
          placed = true;
        } else if (k < 1) {
          pos = tipAt(seg.s, k);
          placed = true;
        } else prevEnd = endAt(seg.s);
      }
      const last = plan[plan.length - 1] as Seg;
      if (!placed) {
        // Lifted away once the last mark is made; back if the reader scrolls back into the marks.
        const k = Math.max(0, Math.min(1, (t - last.to) / LIFT));
        const e = endAt(last.s);
        pos = [e[0] + 40 * k, e[1] - 50 * k];
        fade = 1 - k;
      }
      pencil.style.transform = `translate(${pos[0].toFixed(1)}px, ${pos[1].toFixed(1)}px)`;
      pencil.style.opacity = String(fade);
      // The step's tags and directions set into the text after the pause.
      wr.style.setProperty("--set", Math.max(0, Math.min(1, (t - setFrom) / SET)).toFixed(3));
    };
    // Drawn by the scroll, at a hand's pace: the step's choreography over the first part of its
    // span, both ways. A jump lands with it complete.
    // At once, where the page is (a jump: complete), so no frame shows the marks before they're drawn.
    render(landing === n ? total : map(Math.max(0, Math.min(1, stepShare(n)))) * total);
    finishPen = scrub({ to: (share) => render(share * total) }, () => stepShare(n), {
      ...HAND,
      scale: total,
      map,
      snap: () => landing === n,
    });
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
      for (const el of $$("[data-finale-play] .btn-time"))
        el.textContent = clock(Math.max(0, SEG_TO - Math.max(seconds, SEG_FROM)));
      for (const el of $$("[data-seg-clock]"))
        el.textContent = `${clock(Math.max(0, seconds - SEG_FROM))} / ${clock(span)}`;
      if (index !== finaleCue && cue) {
        finaleCue = index;
        const said =
          cue.kind === "pause"
            ? "(a pause)"
            : cue.kind === "sound" || cue.kind === "vocal"
              ? `[${cue.text ?? ""}]`
              : !cue.speaker || cue.speaker === "Narrator"
                ? (cue.text ?? "")
                : `“${cue.text ?? ""}”`;
        for (const el of $$("[data-seg-line]")) el.textContent = said;
        for (const el of $$("[data-seg-who]")) el.textContent = described(dragon.story, cue);
      }
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
          const page = doc.parentElement as HTMLElement;
          const most = Math.max(0, doc.scrollHeight - page.clientHeight + 24);
          doc.style.transform = `translateY(${-Math.min(most, Math.max(0, lit.offsetTop - page.clientHeight * 0.4))}px)`;
        }
      }
    },
    state: (on) => {
      for (const button of $$<HTMLButtonElement>("[data-finale-play]")) {
        button.classList.toggle("playing", on);
        $(".finale-label", button).textContent = on
          ? "Pause"
          : button.closest(".caption") && active !== STEPS
            ? "Hear it voiced"
            : "Play the scene";
      }
      if (!on && (!player.audio || player.audio.currentTime >= SEG_TO - 0.3))
        for (const el of $$("[data-finale-play] .btn-time"))
          el.textContent = clock(SEG_TO - SEG_FROM);
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
      if (active !== STEPS && button.closest(".caption")) goTo(STEPS);
      const at = player.owner === finaleOwner && player.audio ? player.audio.currentTime : 0;
      play(finaleOwner, dragon, at > SEG_FROM && at < SEG_TO - 0.3 ? at : SEG_FROM, SEG_TO);
    });
  for (const button of $$<HTMLButtonElement>("[data-recast]"))
    button.addEventListener("click", () => giveWho(G));
  homes.observe($("#wr"));
  homes.observe(steps[STEPS - 1] as HTMLElement);

  // Which beat is in the middle of the screen.
  {
    const middle = new IntersectionObserver(
      (entries) => {
        // A jump shows only where it's going.
        if (jumping) return;
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
    // After a jump, the step actually in the middle of the screen.
    afterJump.push(() => {
      const mid = window.innerHeight / 2;
      const here = steps.find((step) => {
        const box = step.getBoundingClientRect();
        return box.top <= mid && box.bottom > mid;
      });
      if (here) setStep(Number(here.dataset.step));
      else if (steps[0] && steps[0].getBoundingClientRect().top > mid) setStep(0);
    });
    respine = () => {
      const n = active;
      active = -1;
      setStep(n);
      sizeCaption();
    };
    void document.fonts.ready.then(sizeCaption);
    jump.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-go]");
      if (button) goTo(Number(button.dataset.go));
    });
  }

  // On a phone, each small Writer's change follows its place on the screen, both ways, at a hand's
  // pace, over the whole time it is on screen.
  for (const example of $$(".step-example")) example.classList.add("seen");
  // Set up in a task of their own, after the beats are built.
  globalThis.setTimeout(() => {
    if (!calm.matches && window.innerWidth <= 860)
      for (const example of $$(".step-example")) {
        if (example.closest('.step[data-step="1"]')) continue;
        const paper = example.querySelector<HTMLElement>(".mini") ?? example;
        type Mark = { el: HTMLElement; kind: "ink" | "line" };
        let marks: Mark[] = [];
        let laid = false;
        // The pencil's strokes in reading order: each noted line's ring or underline, then its note
        // a line at a time.
        const lay = () => {
          marks = [];
          for (const line of $$(".ln.noted", example)) {
            for (const ink of $$(".ink-ring, .ink-under", line))
              marks.push({ el: ink, kind: "ink" });
            const note = line.querySelector<HTMLElement>(".note");
            if (!note || note.querySelector("s")) continue;
            const text = note.dataset.text ?? note.textContent ?? "";
            note.dataset.text = text;
            note.innerHTML = text
              .split(" ")
              .map((word) => `<span class="nw">${escapeHtml(word)}</span>`)
              .join(" ");
            const rows: string[][] = [];
            let top = Number.NaN;
            for (const word of $$("span.nw", note)) {
              if (word.offsetTop !== top) {
                rows.push([]);
                top = word.offsetTop;
              }
              (rows[rows.length - 1] as string[]).push(word.textContent ?? "");
            }
            note.innerHTML = rows
              .map((row) => `<span class="nl">${escapeHtml(row.join(" "))}</span>`)
              .join("<br>");
            for (const row of $$("span.nl", note)) marks.push({ el: row, kind: "line" });
          }
          laid = true;
        };
        // The hand's time over each stroke, by its length, with a moment's travel between them, a
        // pause, then the tags set in; and each part's stretch of the crossing.
        type Part = { mark?: Mark; time: number; weight: number };
        let parts: Part[] = [];
        const pace: Pace = { ...HAND, scale: 1, map: (share) => share };
        const plan = () => {
          parts = [];
          for (const [i, mark] of marks.entries()) {
            const move = i ? 300 : 0;
            if (move) parts.push({ time: move, weight: move * 0.06 });
            let time: number;
            if (mark.kind === "line")
              time = 100 + (mark.el.textContent ?? "").replace(/\s/g, "").length * 140;
            else {
              const b = mark.el.getBoundingClientRect();
              if (mark.el.classList.contains("ink-under")) time = Math.max(350, Math.min(700, b.width * 2));
              else {
                const x = b.width / 2;
                const y = b.height / 2;
                const round = Math.PI * (3 * (x + y) - Math.sqrt((3 * x + y) * (x + 3 * y)));
                time = Math.max(780, Math.min(1000, round * 1.1));
              }
            }
            parts.push({ mark, time, weight: Math.max(STROKE_SCROLL, time * 0.14) });
          }
          if (marks.length) parts.push({ time: 450, weight: 60 });
          parts.push({ time: 700, weight: 90 });
          const weight = parts.reduce((sum, part) => sum + part.weight, 0);
          pace.scale = parts.reduce((sum, part) => sum + part.time, 0);
          pace.map = (share) => {
            let s0 = 0;
            let t0 = 0;
            for (const part of parts) {
              const s1 = s0 + part.weight / weight;
              if (share <= s1) return (t0 + (part.time * (share - s0)) / (s1 - s0 || 1)) / pace.scale;
              s0 = s1;
              t0 += part.time;
            }
            return 1;
          };
          example.dataset.weight = String(Math.round(weight));
        };
        lay();
        plan();
        void document.fonts.ready.then(() => {
          lay();
          plan();
        });
        scrub(
          {
            to: (share) => {
              // Each stroke from its own start in the hand's time; the set-in last.
              let t = share * pace.scale;
              for (const [i, part] of parts.entries()) {
                const k = Math.max(0, Math.min(1, t / part.time));
                const mark = part.mark;
                if (mark?.el.isConnected) {
                  if (mark.kind === "ink") mark.el.style.setProperty("--p", k.toFixed(3));
                  else
                    mark.el.style.clipPath =
                      k >= 1 ? "" : `inset(-20% ${((1 - k) * 100).toFixed(1)}% -20% 0)`;
                }
                if (i === parts.length - 1) example.style.setProperty("--set", k.toFixed(3));
                t -= part.time;
              }
            },
          },
          () => {
            // All the while it's on screen: from its top entering near the bottom to its bottom
            // reaching near the top. A long stretch of scroll, the taller the longer.
            const box = paper.getBoundingClientRect();
            const share =
              (window.innerHeight * 0.9 - box.top) / (window.innerHeight * 0.75 + box.height);
            // The pictures it draws with are fetched only as it comes near.
            if (share > -1) example.classList.add("near");
            // A jump to this step lands with its example complete.
            if (landing === Number(example.closest<HTMLElement>(".step")?.dataset.step)) return 1;
            return share;
          },
          pace,
        );
      }
    // The phone's first beat is typed by the scroll too, as it crosses the screen: from entering its
    // lower third to reaching its upper third.
    const first = document.querySelector<HTMLElement>(
      '.step[data-step="1"] .step-example .mini-paper',
    );
    if (first && !calm.matches) {
      const html = first.innerHTML;
      const words = document.createElement("div");
      words.className = "sr-only";
      words.innerHTML = html;
      first.after(words);
      first.setAttribute("aria-hidden", "true");
      if (window.innerWidth <= 860) {
        first.innerHTML = `${html}<span class="caret tw-caret"></span>`;
        const type = typer(first, $(".tw-caret", first));
        scrub(type, () => {
          const box = first.getBoundingClientRect();
          const middle = box.top + box.height / 2;
          return (window.innerHeight * (2 / 3) - middle) / (window.innerHeight / 3);
        });
      }
    }
  }, 0);
}
{
  // Once, when the page is idle after loading, or sooner if the reader gets near it.
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    near.disconnect();
    initSpine();
  };
  const near = new IntersectionObserver(
    (entries) => entries.some((e) => e.isIntersecting) && build(),
    {
      rootMargin: "300px 0px",
    },
  );
  near.observe($("#spine"));
  // On a phone the beats' examples are part of the page's length: built in the very next task (its
  // own, not the page's first), before anything below can be reached.
  if (window.matchMedia("(max-width: 860px)").matches) globalThis.setTimeout(build, 0);
  const idle = () =>
    "requestIdleCallback" in window
      ? window.requestIdleCallback(build, { timeout: 4000 })
      : globalThis.setTimeout(build, 1500);
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

/* ================================================================== the cast */

/* Built with the page, so the section is its full height from the start. */
function initCast(): void {
  const story = dragon.story;
  const manifest = dragon.manifest;
  const auditions: Record<string, [number, number]> = {
    Narrator: [1, 1],
    King: [10, 10],
    Percival: [40, 40],
    Gerald: [35, 36],
  };
  const list = $("#cast-list");
  for (const member of story.cast.filter((m) => auditions[m.handle])) {
    const [first, last] = auditions[member.handle] as [number, number];
    const from = manifest.cues[first] as Cue;
    const to = manifest.cues[last] as Cue;
    const name = member.handle === story.meta.narrator ? "The Narrator" : member.name;
    const color = colorOf(story, member.handle) ?? "#6b5d9c";
    const voice = manifest.voices[member.handle];
    const item = document.createElement("li");
    item.className = "cast-card";
    item.style.setProperty("--sp", color);
    item.innerHTML = `
      <div class="cast-top"><span class="medal" aria-hidden="true">${escapeHtml(name.replace(/^(The|Sir) /, "").slice(0, 1))}</span>
        <div><h3>${escapeHtml(name)}</h3><p class="cast-voice">${voice ? `In the recording: ${escapeHtml(voice)}, on ElevenLabs` : ""}</p></div></div>
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
    // On a phone: a chip for each character, and the chosen one's card.
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cast-chip";
    chip.style.setProperty("--sp", color);
    chip.setAttribute("aria-pressed", "false");
    chip.innerHTML = `<span class="medal" aria-hidden="true">${escapeHtml(name.replace(/^(The|Sir) /, "").slice(0, 1))}</span>${escapeHtml(name.replace(/^The /, ""))}`;
    chip.addEventListener("click", () => {
      for (const other of $$<HTMLButtonElement>(".cast-chip"))
        other.setAttribute("aria-pressed", String(other === chip));
      for (const card of $$(".cast-card")) card.classList.toggle("chosen", card === item);
    });
    $("#cast-chips").append(chip);
    if (member.handle === "Gerald") {
      chip.setAttribute("aria-pressed", "true");
      item.classList.add("chosen");
    }
  }
}
initCast();

/* Section 02: the battle's script with its note to the performer, and the lines as CSV. Built
   when it nears the screen. */
{
  const build = () => {
    const full = dragon.story.source;
    const front = full.slice(0, full.indexOf("---", 4) + 3);
    const from = full.indexOf("%% Percival talks");
    const to = full.indexOf("I’ve been practicing.”") + "I’ve been practicing.”".length;
    const battle = parse(`${front}\n\n${full.slice(from, to)}\n`);
    $("#route-script").innerHTML =
      `<div class="script-page" data-vxd-theme="light"><p class="script-head">Script · The battle</p>${render.renderScript(battle, { header: false })}</div>`;
    // The rows as the Writer's Export › Lines as CSV writes them: who, how, what, and where.
    const all = lines(dragon.story);
    const start = Math.max(
      0,
      all.findIndex((row) => row.text.startsWith("Then he heard")),
    );
    $("#route-csv").textContent = linesToCsv(all.slice(start, start + 16), [
      "kind",
      "speaker",
      "direction",
      "text",
      "scene",
      "page",
    ]).trimEnd();
  };
  build();
}

/* ================================================================== the real Writer */

{
  const LOOK_NAMES: Record<string, string> = {
    light: "Paper",
    sepia: "Sepia",
    dark: "Night",
    slate: "Slate",
    contrast: "High contrast",
  };
  // The window: one view (focus, workbench, marks as written or drawn) in one look.
  const VIEWS: Record<string, { file: (look: string) => string; cap: string; alt: string }> = {
    focus: {
      file: (look) => `calm2-focus-${look}`,
      cap: "Focus mode: the toolbar and panels step away, and every paragraph but yours fades back.",
      alt: "The VoxDown Writer in focus mode, in the LOOK look: Gerald’s line “Could you not?” in full ink, the rest of the dragon story faded back.",
    },
    workbench: {
      file: (look) => `calm2-workbench-${look}`,
      cap: 'The workbench and the preview open: the cast beside the story<span class="wide-only">, and its script on the right</span><span class="narrow-only">; tap for the script beside them</span>.',
      alt: "The VoxDown Writer with the workbench and the preview open, in the LOOK look: the cast on the left, the dragon story in the middle, its script on the right.",
    },
    written: {
      file: (look) => `calm2-written-${look}`,
      cap: "Marks as written: every @, ( ), [ ] and { } exactly as you typed it.",
      alt: "The dragon story with its marks as written, in the LOOK look: @Gerald, (deep, polite and utterly unbothered), [snores] and {pause} in the text, each in its colour.",
    },
    drawn: {
      file: (look) => `calm2-drawn-${look}`,
      cap: "Marks drawn: names as tags, directions as small notes above the words.",
      alt: "The same passage with its marks drawn, in the LOOK look: “Gerald the Dragon” as a tag before his lines, his direction as a small note above “Could you not?”, sounds and the pause as chips.",
    },
  };
  // Two pictures, one over the other: a new view (or look) is decoded behind, then faded in over
  // the one showing, so a change never shows a blank or a half-drawn picture.
  const shot = $<HTMLImageElement>("#shot");
  const back = $<HTMLImageElement>(".shot-back");
  const ORDER = ["focus", "workbench", "written", "drawn"];
  const state = { view: "focus", look: "light" };
  const small = window.matchMedia("(max-width: 600px)");
  /** The picture for a view in a look: the whole window, or on a phone its readable crop. */
  const urlOf = (view: string, look: string, whole = false) =>
    `../../landing/studio/app/${(VIEWS[view] as (typeof VIEWS)[string]).file(look)}${!whole && small.matches ? "-phone" : ""}.webp`;
  const altOf = (view: string, look: string) =>
    (VIEWS[view] as (typeof VIEWS)[string]).alt.replace("LOOK", LOOK_NAMES[look] ?? "");
  // Fetched and decoded ahead of need: the views either side, in the look being shown.
  const ready = new Map<string, Promise<void>>();
  const fetchAhead = (url: string): Promise<void> => {
    let done = ready.get(url);
    if (!done) {
      const image = new Image();
      image.src = url;
      done = image.decode().catch(() => undefined);
      ready.set(url, done);
    }
    return done;
  };
  const ahead = () => {
    const at = ORDER.indexOf(state.view);
    for (const k of [at + 1, at - 1, at + 2])
      if (ORDER[k]) void fetchAhead(urlOf(ORDER[k] as string, state.look));
  };
  let front = shot;
  let behind = back;
  let turn = 0;
  let said = 0;
  let near = false;
  const showWindow = (fade = true, quiet = false) => {
    const view = VIEWS[state.view] as (typeof VIEWS)[string];
    const url = urlOf(state.view, state.look);
    $("#view-cap").innerHTML = view.cap;
    for (const button of $$<HTMLButtonElement>("[data-view]"))
      button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    // The caption is announced once the view has settled, not on every step of the scroll.
    window.clearTimeout(said);
    if (!quiet)
      said = window.setTimeout(() => announce(($("#view-cap").textContent ?? "").trim()), 900);
    if (!near) return;
    ahead();
    if (front.getAttribute("src") === url) return;
    const mine = ++turn;
    const incoming = behind;
    const outgoing = front;
    void fetchAhead(url).then(() => {
      if (mine !== turn) return;
      incoming.src = url;
      incoming.alt = altOf(state.view, state.look);
      incoming.removeAttribute("aria-hidden");
      incoming.id = "shot";
      outgoing.removeAttribute("id");
      outgoing.alt = "";
      outgoing.setAttribute("aria-hidden", "true");
      front = incoming;
      behind = outgoing;
      const swap = () => {
        incoming.classList.add("shot-front");
        incoming.classList.remove("shot-in");
        outgoing.classList.remove("shot-front", "shot-in");
      };
      if (!fade || calm.matches || !outgoing.getAttribute("src")) {
        swap();
        return;
      }
      // Faded in over the old picture, then it becomes the one in front.
      incoming.classList.add("shot-in");
      incoming.style.opacity = "0";
      requestAnimationFrame(() => {
        incoming.style.opacity = "";
        window.setTimeout(() => {
          if (front === incoming) swap();
        }, 320);
      });
    });
  };
  // The caption is as tall as its tallest view at this width, so the picture never moves.
  const sizeCap = () => {
    const cap = $("#view-cap");
    const probe = cap.cloneNode() as HTMLElement;
    probe.removeAttribute("id");
    probe.style.cssText = `position:absolute;visibility:hidden;min-height:0;width:${cap.getBoundingClientRect().width}px`;
    cap.after(probe);
    let tallest = 0;
    for (const view of Object.values(VIEWS)) {
      probe.innerHTML = view.cap;
      tallest = Math.max(tallest, probe.getBoundingClientRect().height);
    }
    probe.remove();
    cap.style.minHeight = `${Math.ceil(tallest)}px`;
  };
  window.addEventListener("resize", sizeCap, { passive: true });
  {
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        near = true;
        sizeCap();
        void document.fonts.ready.then(sizeCap);
        showWindow(false, true);
      },
      { rootMargin: "600px 0px" },
    );
    watch.observe($(".shot-tile"));
  }
  // The four views follow the scroll: the window is pinned while the page runs past it, a view for
  // each stretch, with a thin line under the buttons showing how far along it is.
  const track = $("#views-track");
  const run = $(".views-run", track);
  const line = $(".seg-run i");
  const where = () => {
    const pin = $(".views-pin", track);
    const top = Number.parseFloat(getComputedStyle(pin).top) || 0;
    const box = track.getBoundingClientRect();
    return (top - box.top) / Math.max(1, run.offsetHeight);
  };
  const viewAt = (p: number) => ORDER[Math.max(0, Math.min(3, Math.floor(p * 4)))] as string;
  let queued = false;
  const follow = () => {
    queued = false;
    const p = where();
    line.style.transform = `scaleX(${Math.max(0, Math.min(1, p)).toFixed(3)})`;
    // A jump shows only where it's going.
    if (jumping) return;
    const view = viewAt(p);
    if (view !== state.view) {
      state.view = view;
      showWindow();
    }
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(follow);
      }
    },
    { passive: true },
  );
  afterJump.push(follow);
  // A button goes to its view's place in the run, as the step buttons do.
  for (const button of $$<HTMLButtonElement>("[data-view]"))
    button.addEventListener("click", () => {
      const view = button.dataset.view as string;
      const at = ORDER.indexOf(view);
      const pin = $(".views-pin", track);
      const top = Number.parseFloat(getComputedStyle(pin).top) || 0;
      const y =
        window.scrollY + track.getBoundingClientRect().top - top + ((at + 0.5) / 4) * run.offsetHeight;
      smoothJump(() => {
        state.view = view;
        showWindow();
        window.scrollTo({ top: y, behavior: calm.matches ? "auto" : "smooth" });
      });
    });
  // The look stays as chosen for every view, scrolling down or back up, until another is picked.
  for (const button of $$<HTMLButtonElement>("[data-look]"))
    button.addEventListener("click", () => {
      state.look = button.dataset.look as string;
      for (const other of $$<HTMLButtonElement>("[data-look]"))
        other.setAttribute("aria-pressed", String(other === button));
      showWindow();
    });
  small.addEventListener("change", () => showWindow(false, true));

  // Any screenshot, full size.
  const box = $<HTMLDialogElement>("#lightbox");
  const big = $<HTMLImageElement>("#lightbox-img");
  // The last open's "drag to look around" watcher, dropped when the next one opens.
  let hintGone: (() => void) | undefined;
  for (const zoom of $$<HTMLButtonElement>("[data-zoom]"))
    zoom.addEventListener("click", () => {
      const look = zoom.dataset.zoom === "look";
      const img = look ? front : $<HTMLImageElement>("img", zoom);
      big.src = look ? urlOf(state.view, state.look, true) : (zoom.dataset.zoom as string);
      // The picture's own size, kept apart: an image's width reads as 0 until it has decoded.
      const w = look ? 1280 : Number(zoom.dataset.zoomW);
      const h = look ? 800 : Number(zoom.dataset.zoomH);
      big.width = w;
      big.height = h;
      big.alt = img.alt;
      box.showModal();
      // On a phone the Writer's window fills the dialog's height (sharp on a 2× screen), to pan.
      const phoneLook = look && window.innerWidth <= 600;
      big.style.width = phoneLook
        ? `${Math.round((Math.min(box.clientHeight, window.innerHeight) * w) / h)}px`
        : window.innerWidth <= 600
          ? `${w}px`
          : "";
      // On a phone the screenshot shows at its own size, to pan; it opens on the story.
      if (window.innerWidth <= 600) {
        const fit = () => {
          // It opens on the view's key line: [where the line starts, where its ink ends], in the
          // window's own 1280-pixel width. A line wider than the phone shows its end, the quote.
          const lines: Record<string, number[]> = {
            focus: [288, 776],
            written: [307, 795],
            drawn: [307, 650],
            workbench: [48, 48],
          };
          if (!phoneLook) {
            box.scrollLeft = Math.max(0, (w - box.clientWidth) / 2);
            box.scrollTop = 0;
            return;
          }
          const scale = Number.parseFloat(big.style.width) / 1280;
          const [from, to] = (lines[state.view] ?? [0, 0]) as [number, number];
          const left = from * scale - 16;
          const right = to * scale + 24;
          box.scrollLeft = Math.max(
            0,
            right - left > box.clientWidth ? right - box.clientWidth : left,
          );
          box.scrollTop = 0;
        };
        if (big.complete) fit();
        else big.addEventListener("load", fit, { once: true });
        // "Drag to look around", until the first drag.
        const hint = $("#lb-hint");
        hint.classList.remove("gone");
        const opened = performance.now();
        if (hintGone) box.removeEventListener("scroll", hintGone);
        const gone = () => {
          if (performance.now() - opened < 400) return;
          hint.classList.add("gone");
          box.removeEventListener("scroll", gone);
          hintGone = undefined;
        };
        hintGone = gone;
        box.addEventListener("scroll", gone, { passive: true });
      }
    });
  box.addEventListener("click", (event) => {
    if (event.target === box) box.close();
  });
}

/* On a phone, the secondary screens and the toolbox start folded: one tap opens them. */
if (window.matchMedia("(max-width: 860px)").matches)
  for (const fold of $$<HTMLDetailsElement>("details[data-fold]")) fold.open = false;

/* Every fold opens and closes smoothly: its height and a light fade, both ways, the content never
   jumping. Reduced motion: at once. Find-in-page and links into a fold open it as the browser does. */
for (const details of $$<HTMLDetailsElement>("details")) {
  const summary = details.querySelector<HTMLElement>(":scope > summary");
  if (!summary) continue;
  let running: Animation | undefined;
  let closing = false;
  const inside = () => [...details.children].filter((child) => child !== summary) as HTMLElement[];
  summary.addEventListener("click", (event) => {
    if (calm.matches) return;
    event.preventDefault();
    const from = details.getBoundingClientRect().height;
    running?.cancel();
    const opening = !details.open || closing;
    details.style.overflow = "hidden";
    // Both ends measured as they will stand.
    details.open = true;
    const open = details.getBoundingClientRect().height;
    details.open = false;
    const shut = details.getBoundingClientRect().height;
    details.open = true;
    closing = !opening;
    const to = opening ? open : shut;
    const timing = { duration: 280, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" };
    for (const child of inside())
      child.animate({ opacity: opening ? [0, 1] : [1, 0] }, { ...timing, fill: "forwards" });
    const anim = details.animate({ height: [`${from}px`, `${to}px`] }, timing);
    running = anim;
    anim.onfinish = () => {
      if (running !== anim) return;
      running = undefined;
      if (closing) details.open = false;
      closing = false;
      details.style.overflow = "";
      for (const child of inside()) for (const fade of child.getAnimations()) fade.cancel();
    };
  });
}

/* The footer's supporter line: only with a real address. */
if (/^https:\/\/\S+$/.test(SUPPORT_URL)) {
  const line = document.createElement("p");
  line.className = "support";
  line.append("VoxDown is free and stays free. If it helps your work, ");
  const link = document.createElement("a");
  link.href = SUPPORT_URL;
  // An outside page: it opens in a new tab, so the reader keeps their place.
  link.target = "_blank";
  link.rel = "noopener";
  link.innerHTML =
    'you can support it<span class="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span>';
  line.append(link, ".");
  $(".foot-brand").append(line);
}

/* Marks outside the spine, drawn by the scroll as they cross the middle of the screen (from
   entering its lower third to reaching its upper third), and undrawn on the way back. The pencil's
   lead is always on the very end of the ink shown. */
{
  const crossing = (el: Element) => {
    const box = el.getBoundingClientRect();
    return (window.innerHeight * (2 / 3) - (box.top + box.height / 2)) / (window.innerHeight / 3);
  };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const edit = $(".big-edit");
  // The old one-off correction's states are not used: the marks are set from the scroll.
  edit.classList.add("corrected");
  const finalWord = $(".pen-final-word");
  /** Where a pencil's lead is, in its parent's own px (4.9% across and 96.2% down its picture). */
  const leadOf = (pen: HTMLElement): [number, number] => [
    pen.offsetLeft + pen.offsetWidth * 0.0488,
    pen.offsetTop + pen.offsetHeight * 0.9619,
  ];
  const setMove = (host: HTMLElement, tip: [number, number], rest: [number, number]) => {
    host.style.setProperty("--px", `${(tip[0] - rest[0]).toFixed(1)}px`);
    host.style.setProperty("--py", `${(tip[1] - rest[1]).toFixed(1)}px`);
  };
  // The underline's own ink, for its pencil's lead.
  let underInk: Ink | undefined;
  void inkOf("../../landing/studio/pen/pencil-underline.webp").then((ink) => {
    underInk = ink;
  });
  /** An underline shown from the left up to `u`: the end of its ink, in its parent's px. */
  const underEnd = (under: HTMLElement, u: number): [number, number] => {
    const [x, y] = underInk ? pictureEnd(underInk, u, under.offsetHeight) : [u, 0.5];
    return [under.offsetLeft + x * under.offsetWidth, under.offsetTop + y * under.offsetHeight];
  };
  if (!calm.matches) {
    // "$0" struck through, then "Free" written beside it, the pencil following its lead. The pencil
    // lives inside "Free"'s slanted box, so everything is worked out in that box's own px.
    const handFree = $(".hand-free", edit);
    const word = $(".free-word", edit);
    const pen = $(".pen-free", edit);
    type Geo = {
      start: [number, number];
      along: [number, number];
      toLocal: (x: number, y: number) => [number, number];
      words: Words;
    };
    let geo: Geo | undefined;
    const forget = () => {
      geo = undefined;
    };
    window.addEventListener("resize", forget, { passive: true });
    // "Free" moves when its handwriting arrives: measured again then.
    document.fonts.addEventListener("loadingdone", forget);
    const measure = (): Geo => {
      const em = Number.parseFloat(getComputedStyle(edit).fontSize);
      const box = edit.getBoundingClientRect();
      const struck = $(".struck", edit).getBoundingClientRect();
      // The slanted box: where it sits unslanted, and its slant about its middle, undone.
      const w = handFree.offsetWidth;
      const h = handFree.offsetHeight;
      const ox = box.left + handFree.offsetLeft + w / 2;
      const oy = box.top + handFree.offsetTop + h / 2;
      const m = new DOMMatrix(getComputedStyle(handFree).transform).inverse();
      const toLocal = (x: number, y: number): [number, number] => [
        m.a * (x - ox) + m.c * (y - oy) + w / 2,
        m.b * (x - ox) + m.d * (y - oy) + h / 2,
      ];
      // The stroke: from 0.1em before "$0" to 0.1em after, along its middle 52% down, turned up 9°
      // about its start.
      const length = struck.width + 0.2 * em;
      return {
        start: [struck.left - 0.1 * em, struck.top + struck.height * 0.52 + 0.065 * em],
        along: [length * Math.cos(Math.PI / 20), -length * Math.sin(Math.PI / 20)],
        toLocal,
        words: wordsOf(word),
      };
    };
    scrub(
      {
        to: (share) => {
          geo ??= measure();
          const strike = clamp(share / 0.4);
          const free = clamp((share - 0.43) / 0.42);
          const rest = leadOf(pen);
          const struckEnd = geo.toLocal(
            geo.start[0] + strike * geo.along[0],
            geo.start[1] + strike * geo.along[1],
          );
          const [wx, wy] = wordsEnd(geo.words, free);
          const written: [number, number] = [word.offsetLeft + wx, word.offsetTop + wy];
          // On the stroke's end while it's drawn, a short hop, then on the end of the letters.
          const hop = clamp((share - 0.4) / 0.03);
          const tip: [number, number] =
            share < 0.43
              ? [
                  struckEnd[0] + (written[0] - struckEnd[0]) * hop,
                  struckEnd[1] + (written[1] - struckEnd[1]) * hop,
                ]
              : written;
          setMove(edit, tip, rest);
          edit.style.setProperty("--strike", strike.toFixed(3));
          edit.style.setProperty("--free", free.toFixed(3));
          edit.style.setProperty("--rest", clamp(share * 6).toFixed(3));
        },
      },
      () => crossing(edit),
    );
    // The line under "waiting.", drawn left to right, the pencil on its end.
    const finalUnder = $(".under-img", finalWord);
    const finalPen = $(".pen-final", finalWord);
    scrub(
      {
        to: (share) => {
          const u = clamp(share / 0.85);
          finalWord.style.setProperty("--u", u.toFixed(3));
          setMove(finalWord, underEnd(finalUnder, u), leadOf(finalPen));
        },
      },
      () => crossing(finalWord),
    );
    // The hero's "whole cast.": the top of the page is past its crossing, so the pencil draws the
    // line there at its own pace as the page opens, and comes to rest on its end.
    const heroWord = document.querySelector<HTMLElement>(".hero .pen-under");
    const heroUnder = heroWord?.querySelector<HTMLElement>("img:not(.pen-rest)");
    const heroPen = heroWord?.querySelector<HTMLElement>(".pen-rest");
    if (heroWord && heroUnder && heroPen)
      scrub(
        {
          to: (share) => {
            const u = clamp(share);
            heroWord.style.setProperty("--u", u.toFixed(3));
            setMove(heroWord, underEnd(heroUnder, u), leadOf(heroPen));
          },
        },
        () => 1,
        { ...HAND, scale: 1300, max: 1300, from0: true },
      );
  }
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
  // After the first frame: measuring now would force the page's first layout inside this script.
  requestAnimationFrame(update);
}

// After a resize, the doc's scroll and the pencil are measured again.
{
  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => respine?.(), 200);
  });
}
