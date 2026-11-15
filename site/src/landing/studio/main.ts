/**
 * The studio landing page. The hero: a recorded scene, lit line by line. The spine: one scene of
 * the dragon story written, marked, organised and voiced in a likeness of the Writer, step by step
 * as the page scrolls (or from the step buttons). Then the cast, each heard in their own line, and
 * the real Writer in screenshots. One recording player serves them all; audio loads only on play.
 */
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource-variable/literata";
/** Text made safe for HTML (the renderer's own rule; the renderer itself loads with the spine). */
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
/** The renderer, for the book and the script: loaded once, when first needed. */
type Render = typeof import("@voxdown/render");
let render: Render | undefined;
async function renderer(): Promise<Render> {
  if (render) return render;
  render = await import("@voxdown/render");
  const style = document.createElement("style");
  style.textContent = render.stylesheet;
  document.head.prepend(style);
  return render;
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
  type Seg = { t: string; k?: Kind; s?: number; who?: string; slot?: boolean };
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
  const CUT_AT = 5;
  const SEG_FROM = 50.2;
  const SEG_TO = 84.5;

  const colorFor = (who?: string) =>
    who === "Narrator" ? NARRATOR_COLOR : who ? (dragonColors.get(who) ?? "#555") : "#555";

  /** A line's HTML. In the mock every mark is there and CSS shows it at its beat; in an example,
   * only what's set by `upTo` is drawn. `pen`: the words a pencil rings in an example. */
  function lineHtml(
    line: Line,
    upTo?: number,
    pen?: { seg: number; mark: "ring" | "under" },
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
        const style = seg.who ? ` style="--sp:${colorFor(seg.who)}"` : "";
        const step = seg.s && upTo === undefined ? ` data-s="${seg.s}"` : "";
        if (k === "speech") {
          // The Writer underlines the words, not the quotation marks around them.
          const open = seg.t.startsWith("“") ? "“" : "";
          const close = seg.t.endsWith("”") ? "”" : "";
          const words = seg.t.slice(open.length, seg.t.length - close.length);
          return `${open}<span class="k-speech${inked}"${style}>${escapeHtml(words)}</span>${close}`;
        }
        const slot = seg.slot ? " who-slot" : "";
        return `<span class="mk k-${k}${slot}${inked}"${step}${style}>${escapeHtml(seg.t)}</span>`;
      })
      .join("");
  }

  function linesHtml(
    lines: Line[],
    upTo?: number,
    pens: Record<string, { seg: number; mark: "ring" | "under"; note: string }> = {},
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
        return `<p ${attrs}>${lineHtml(line, upTo, pen)}${note}</p>`;
      })
      .join("");
  }

  /* The book, the script and each character's lines from the mountain scene, by the renderer, from
   the scene's own text, with "Could you not?" given to whoever the reader chose. */
  const COULD = "@Gerald (deep, polite and utterly unbothered) “Could you not?”";
  function mountainStory(handle: string): Story {
    const full = dragon.story.source;
    const front = full.slice(0, full.indexOf("---", 4) + 3);
    const from = full.indexOf("Then he heard");
    const to = full.indexOf("difficult to catch.”") + "difficult to catch.”".length;
    const passage = full.slice(from, to).replace(COULD, COULD.replace("@Gerald", `@${handle}`));
    return parse(`${front}\n\n${passage}\n`);
  }
  const nameFor = (handle: string) =>
    handle === "Narrator"
      ? "The narrator"
      : handle === P
        ? "Sir Percival"
        : handle === "King"
          ? "The King"
          : handle;
  function outputs(handle: string): { book: string; script: string; lines: string } {
    const story = mountainStory(handle);
    // The lines of whoever has "Could you not?" (Gerald's, if it went to the narrator).
    const whose = handle === "Narrator" ? G : handle;
    const said = (textByCharacter(story).get(whose) ?? "").trim().split("\n").filter(Boolean);
    return {
      book: `<div class="book-page" data-vxd-theme="light"><p class="book-run">The Dragon Who Would Not Roar</p>${(render as Render).renderBook(story, { header: false })}<p class="book-folio">12</p></div>`,
      script: `<div class="script-page" data-vxd-theme="light">${(render as Render).renderScript(story, { header: false })}</div>`,
      lines: `<div class="sides-page"><p class="sides-head"><span style="--sp:${colorFor(whose)}">${escapeHtml(nameFor(whose))}</span> · each character’s lines · The mountain</p>${said
        .map(
          (row) => `<p class="said">${escapeHtml(row).replace(/^\(([^)]*)\)/, "<i>($1)</i>")}</p>`,
        )
        .join("")}</div>`,
    };
  }
  const FIRST_OUT = outputs(G);
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
  <p class="ab-recast" hidden>The recording keeps Gerald: it was voiced from the original file. <button type="button" data-recast>Use the recording’s casting</button></p>
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
      stats: "6 lines · 45 words",
    },
    {
      handle: G,
      name: "Gerald",
      about: "An old dragon. Deep, polite and utterly unbothered.",
      stats: "4 lines · 31 words",
    },
    {
      handle: P,
      name: "Sir Percival",
      about: "A young knight. Brave in theory, nervous in practice.",
      stats: "1 line · 2 words",
    },
  ];
  const castCard = (member: (typeof CAST)[number]) =>
    `<div class="cc" data-cast="${member.handle}" style="--sp:${colorFor(member.handle)}"><p class="cc-h"><span class="dot"></span><span class="cc-at">@</span>${member.handle}<i>→</i></p><p class="cc-s">${member.stats}</p><p class="cc-a">${member.about}</p></div>`;

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
      <div class="bench-tabs" aria-hidden="true">
        <span class="bt bt-scenes">${icon("scenes")}<em>Scenes</em></span>
        <span class="bt bt-cast">${icon("cast")}<em>Cast</em></span>
        <span class="bt bt-scraps">${icon("scraps")}<em>Scraps</em></span>
        <span class="bt bt-comments">${icon("comments")}<em>Comments</em></span>
        <span class="bt">${icon("warn")}<small>0</small></span>
      </div>
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
      <div class="paper" aria-hidden="true"><div class="doc" id="wr-doc">${linesHtml(LINES)}<span class="caret"></span>
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
        return mini(paper(linesHtml(LINES.slice(0, 3), 1)));
      case 2:
        return mini(
          `${paper(linesHtml(byId("could"), 2, { could: { seg: 2, mark: "ring", note: "who?" } }))}
         ${pickerHtml("picker-phone")}
         <div class="mini-cast who-card"></div>`,
          "",
          `<div class="mini-tools live"><button type="button" class="tb tb-live" data-who-open="picker-phone" aria-haspopup="dialog" aria-expanded="false">${icon("who")}Who says this…</button><span class="mini-hint">Ctrl+K in the Writer</span></div>`,
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

  /* The pen: it rings or underlines the words, and writes its question in the margin. */
  const PEN: Record<number, Array<{ at: string; word: string; shape: "circle" | "under" }>> = {
    2: [{ at: "could .k-speech", word: "who?", shape: "circle" }],
    3: [
      { at: "could .k-dir", word: "how?", shape: "under" },
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
  const preview = $("#wr-preview");
  let active = -1;

  // The step buttons, and each beat's example.
  for (const step of steps) {
    const n = Number(step.dataset.step);
    const example = document.createElement("div");
    example.className = "step-example";
    example.innerHTML = `<p class="sr-only">In the Writer:</p>${exampleHtml(n)}`;
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
    label.innerHTML = `<span>${n}</span> ${escapeHtml(step.dataset.label ?? "")} <em>${escapeHtml(step.dataset.feature ?? "")}</em>`;
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
  const FOCUS_OF: Record<number, string> = { 2: "could", 3: "rumble", 4: "battle", 5: "imaginary" };

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

  let who = "";
  function giveWho(handle: string, quietly = false): void {
    who = handle;
    const color = colorFor(handle);
    for (const slot of $$(".who-slot")) {
      slot.textContent = `@${handle} `;
      slot.style.setProperty("--sp", color);
    }
    for (const speech of $$('[data-id="could"] .k-speech')) speech.style.setProperty("--sp", color);
    for (const host of [wr, ...$$(".step-example")]) host.classList.add("who-set");
    for (const card of $$(".cc")) card.classList.toggle("cc-new", card.dataset.cast === handle);
    const member = CAST.find((m) => m.handle === handle);
    for (const holder of $$(".who-card")) holder.innerHTML = member ? castCard(member) : "";
    // The script, the book and the lines, made again from the scene as now marked.
    const made = outputs(handle);
    for (const panel of $$(".pv-p-script")) panel.innerHTML = made.script;
    for (const panel of $$(".pv-p-book")) panel.innerHTML = made.book;
    for (const panel of $$(".pv-p-lines")) panel.innerHTML = made.lines;
    for (const note of $$(".ab-recast")) note.hidden = handle === G;
    if (!quietly) {
      const name = handle === "Narrator" ? "the narrator" : (member?.name ?? handle);
      announce(
        `“Could you not?” is now ${name}’s${handle === "Narrator" ? "" : ", and his card is in the Cast"}.${handle === G ? "" : " The recording gave it to Gerald."}`,
      );
    }
    // The pen's ring and note were measured with no name before the quote: measure again.
    if (active === 2 && wr.offsetParent) requestAnimationFrame(() => drawPen(2));
  }

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

  let battleFirst = false;
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
    const other = scene === "battle" ? "The mountain" : "The battle";
    announce(
      `${title} moved ${way === "up" ? "before" : "after"} ${other}. Its text moved with it.`,
    );
    from?.focus();
    if (active === 4 && window.innerWidth > 860) scrollDoc("battle");
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
    wr.dataset.step = String(n);
    for (let k = 1; k <= STEPS; k++) wr.classList.toggle(`s${k}`, k <= n);
    wr.dataset.tab = TAB_OF[n] ?? "";
    wr.dataset.hl = HL_OF[n] ?? "";
    if (n === 6) pickPane("script");
    else wr.dataset.pane = n === 7 ? "audio" : "";
    preview.inert = n !== 6 && n !== 7;
    // Comments, then the cut line lands in Scraps.
    clearTimeout(scrapTimer);
    if (n === 5)
      scrapTimer = window.setTimeout(
        () => {
          wr.dataset.tab = "scraps";
        },
        calm.matches ? 0 : 1800,
      );
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
      ? `<p class="cap-n"><span>${n}</span>${escapeHtml(step.dataset.feature ?? "")}</p><p class="cap-h">${escapeHtml($("h3", step).textContent ?? "")}</p><p class="cap-p">${escapeHtml($("h3 + p", step).textContent ?? "")}${step.dataset.try ? ` <b class="cap-try">${escapeHtml(step.dataset.try)}</b>` : ""}</p>`
      : `<p class="cap-n"><span>0</span>A new story</p><p class="cap-h">A blank page.</p><p class="cap-p">Scroll, or pick a step above, and the scene begins.</p>`;
    $(".caption .finale-label").textContent =
      player.owner === finaleOwner && playing()
        ? "Pause"
        : n === STEPS
          ? "Play the scene"
          : "Hear it voiced";
    $("[data-status]", wr).textContent =
      `${wordCount(n)} words · ${n >= 2 ? "3 voices" : "1 voice"} · ${n >= 4 ? "2 scenes" : "1 scene"}`;
    if (n < STEPS - 1 && player.owner === finaleOwner && playing() && window.innerWidth > 860)
      player.audio?.pause();
    const picker = $("#picker");
    if (!picker.hidden && n !== 2) picker.hidden = true;
    if (window.innerWidth <= 860) return;
    scrollDoc(FOCUS_OF[n]);
    annot.replaceChildren();
    // The pen measures the words once they're laid out, in their fonts, and the page has moved.
    const draw = () => {
      if (active === n) drawPen(n);
    };
    document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(draw)));
  }
  let scrapTimer = 0;

  function goTo(n: number): void {
    const step = steps[n - 1];
    if (!step) return;
    const box = step.getBoundingClientRect();
    const top = window.scrollY + box.top + box.height / 2 - window.innerHeight / 2;
    window.scrollTo({ top, behavior: calm.matches ? "auto" : "smooth" });
    setStep(n);
  }

  function scrollDoc(id?: string): void {
    const page = doc.parentElement as HTMLElement;
    const line = id ? doc.querySelector<HTMLElement>(`[data-id="${id}"]`) : null;
    const room = page.clientHeight;
    const most = Math.max(0, doc.scrollHeight - room + 24);
    const y = line ? Math.min(most, Math.max(0, line.offsetTop - room * 0.3)) : 0;
    doc.style.transform = `translateY(${-y}px)`;
  }

  function drawPen(n: number): void {
    annot.replaceChildren();
    const marks = PEN[n];
    if (!marks) return;
    // The margin: the strip of paper right of the text, where an editor writes.
    const margin = doc.clientWidth - Number.parseFloat(getComputedStyle(doc).paddingRight) + 16;
    const base = doc.getBoundingClientRect();
    for (const [i, mark] of marks.entries()) {
      const [id, inner] = mark.at.split(" ");
      const line = doc.querySelector<HTMLElement>(`[data-id="${id}"]`);
      const target = inner ? line?.querySelector<HTMLElement>(inner) : line;
      if (!line || !target || !target.offsetParent) continue;
      const range = document.createRange();
      range.selectNodeContents(target);
      const first = range.getClientRects()[0] ?? target.getBoundingClientRect();
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
      group.className = `pen pen-${mark.shape}`;
      group.style.setProperty("--d", `${i * 0.6}s`);
      const shape =
        mark.shape === "circle"
          ? `<img class="ring" src="../../landing/studio/pen/pencil-circle.webp" alt="" style="left:${x - 12}px;top:${y - 8}px;width:${w + 24}px;height:${h + 16}px">`
          : `<img class="under" src="../../landing/studio/pen/pencil-underline.webp" alt="" style="left:${x - 4}px;top:${y + h - 9}px;width:${w + 8}px;height:20px">`;
      const leadFrom = end + 14;
      const lead = margin - 8 - leadFrom;
      // A leader only where it clears the words by a margin; otherwise the note alone.
      const leader =
        lead >= 40
          ? `<img class="lead" src="../../landing/studio/pen/pencil-arrow.webp" alt="" style="left:${leadFrom}px;top:${y + h / 2 - 9}px;width:${lead}px;height:18px">`
          : "";
      group.innerHTML = `${shape}${leader}<span class="hand" style="left:${margin}px;top:${y + h / 2 - 12}px"><i>${escapeHtml(mark.word)}</i></span>
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
    respine = () => {
      const n = active;
      active = -1;
      setStep(n);
    };
    jump.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-go]");
      if (button) goTo(Number(button.dataset.go));
    });
  }

  // On a phone, each small Writer plays its change as it comes into view.
  {
    const seenOnce = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("seen");
            seenOnce.unobserve(entry.target);
          }
      },
      { threshold: 0.35 },
    );
    for (const example of $$(".step-example")) {
      if (calm.matches) example.classList.add("seen");
      else seenOnce.observe(example);
    }
  }
}
{
  // Once, when the page is idle after loading, or sooner if the reader gets near it.
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    near.disconnect();
    void renderer().then(initSpine);
  };
  const near = new IntersectionObserver(
    (entries) => entries.some((e) => e.isIntersecting) && build(),
    {
      rootMargin: "300px 0px",
    },
  );
  near.observe($("#spine"));
  const idle = () =>
    "requestIdleCallback" in window
      ? window.requestIdleCallback(build, { timeout: 4000 })
      : globalThis.setTimeout(build, 1500);
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
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
    const color = colorOf(story, member.handle) ?? "#6b5d9c";
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

/* Section 03: the battle's script with its note to the performer, and the lines as CSV. Built
   when it nears the screen. */
{
  const build = () => {
    const full = dragon.story.source;
    const front = full.slice(0, full.indexOf("---", 4) + 3);
    const from = full.indexOf("%% Percival talks");
    const to = full.indexOf("nap at four.”") + "nap at four.”".length;
    const battle = parse(`${front}\n\n${full.slice(from, to)}\n`);
    $("#route-script").innerHTML =
      `<div class="script-page" data-vxd-theme="light"><p class="script-head">Script · The battle</p>${(render as Render).renderScript(battle, { header: false })}</div>`;
    // The rows as the Writer's Export › Lines as CSV writes them: who, how, what, and where.
    const all = lines(dragon.story);
    const start = Math.max(
      0,
      all.findIndex((row) => row.text.startsWith("Then he heard")),
    );
    $("#route-csv").textContent = linesToCsv(all.slice(start, start + 8), [
      "kind",
      "speaker",
      "direction",
      "text",
      "scene",
      "page",
    ]).trimEnd();
  };
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      void renderer().then(build);
    },
    { rootMargin: "800px 0px" },
  );
  near.observe($("#route-script"));
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
  const shot = $<HTMLImageElement>("#shot");
  const phone = $<HTMLSourceElement>("#shot-phone");
  for (const button of $$<HTMLButtonElement>("[data-look]"))
    button.addEventListener("click", () => {
      const look = button.dataset.look as string;
      shot.src = `../../landing/studio/app/full-${look}.webp`;
      phone.srcset = `../../landing/studio/app/phone-${look}.webp`;
      shot.alt = `The dragon story in the VoxDown Writer, in the ${LOOK_NAMES[look]} look: Gerald’s and Sir Percival’s lines underlined in their colours, and Gerald’s direction in violet.`;
      for (const other of $$<HTMLButtonElement>("[data-look]"))
        other.setAttribute("aria-pressed", String(other === button));
    });

  // Any screenshot, full size.
  const box = $<HTMLDialogElement>("#lightbox");
  const big = $<HTMLImageElement>("#lightbox-img");
  for (const zoom of $$<HTMLButtonElement>("[data-zoom]"))
    zoom.addEventListener("click", () => {
      const img = $<HTMLImageElement>("img", zoom);
      const look = zoom.dataset.zoom === "look";
      big.src = look ? shot.src : (zoom.dataset.zoom as string);
      big.width = look ? 1600 : Number(zoom.dataset.zoomW);
      big.height = look ? 1000 : Number(zoom.dataset.zoomH);
      big.alt = img.alt;
      box.showModal();
      // On a phone the screenshot shows at its own size, to pan; it opens on the story.
      if (window.innerWidth <= 600) {
        const fit = () => {
          box.scrollLeft = look ? 380 : Math.max(0, (big.width - box.clientWidth) / 2);
          box.scrollTop = look ? 120 : 0;
        };
        if (big.complete) fit();
        else big.addEventListener("load", fit, { once: true });
      }
    });
  box.addEventListener("click", (event) => {
    if (event.target === box) box.close();
  });
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
    timer = window.setTimeout(() => respine?.(), 200);
  });
}
