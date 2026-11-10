/**
 * The listening page: a story read aloud, each part lit as it is heard. scripts/speak.mjs makes each
 * recording (site/public/listen/) and its timings (site/src/recordings/). A story not recorded yet
 * plays from a clock, with times guessed from the length of each line, and says so.
 */
import { escapeHtml, renderScript, stylesheet } from "@voxdown/render";
import { type Story, characterColors, parse, tokens } from "voxdown";
import { examples } from "./examples";
import "./style.css";
import "./listen.css";
import "./theme";

// The script view's own look, as the playground has it.
const rendererStyle = document.createElement("style");
rendererStyle.textContent = stylesheet;
document.head.prepend(rendererStyle);

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};

/** The stories that can be heard, and the voices proposed for them until they are recorded. */
const STORIES: Record<string, Record<string, string>> = {
  "the-dragon-who-would-not-roar.vxd": {
    Narrator: "George",
    King: "Daniel",
    Percival: "Harry",
    Gerald: "Gerald",
  },
  "the-north-wind-and-the-sun.vxd": {
    Narrator: "Lily",
    Wind: "Adam",
    Sun: "Steve",
    Traveler: "Chris",
  },
};

type Cue = {
  kind: "speech" | "vocal" | "sound" | "pause" | "page";
  from: number;
  speaker: string | null;
  direction: string | null;
  text: string;
  /** The source line it is on. */
  line: { from: number; to: number };
  /** What the recording was made from: the text a voice was sent, or the sound asked for. */
  sent?: string | null;
  start: number;
  duration: number;
  element: HTMLElement | null;
};

const SELECTOR: Record<Cue["kind"], string> = {
  speech: ".vxd-speech",
  vocal: ".vxd-chip-vocal",
  sound: ".vxd-chip-sound",
  pause: ".vxd-chip-pause",
  page: ".vxd-chip-page",
};

/** What a listener hears, in order: speech, a character's sounds, sounds, pauses and page turns. */
function cuesOf(story: Story): Cue[] {
  const cues: Cue[] = [];
  for (const block of story.blocks) {
    if (block.kind === "break" || block.visibility === "book" || block.visibility === "hidden")
      continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      for (const item of [...line.items].sort((a, b) => a.range.from - b.range.from)) {
        const at = {
          from: item.range.from,
          line: { from: line.range.from, to: line.range.to },
          start: 0,
          element: null,
        };
        if (item.kind === "speech" && /[\p{L}\p{N}]/u.test(item.text)) {
          const words = item.text.split(/\s+/).length;
          cues.push({
            ...at,
            kind: "speech",
            speaker: item.speaker,
            direction: item.direction,
            text: item.text,
            duration: 0.35 + 0.34 * words,
          });
        } else if (item.kind === "vocal") {
          cues.push({
            ...at,
            kind: "vocal",
            speaker: item.speaker,
            direction: item.direction,
            text: item.description,
            duration: 1.4,
          });
        } else if (item.kind === "sound") {
          cues.push({
            ...at,
            kind: "sound",
            speaker: null,
            direction: null,
            text: item.description,
            duration: 1.8,
          });
        } else if (item.kind === "instruction" && item.name === "pause") {
          cues.push({
            ...at,
            kind: "pause",
            speaker: null,
            direction: null,
            text: item.value ?? "",
            duration: seconds(item.value),
          });
        } else if (item.kind === "instruction" && item.name === "page") {
          cues.push({
            ...at,
            kind: "page",
            speaker: null,
            direction: null,
            text: "",
            duration: 0.9,
          });
        }
      }
    }
  }
  let start = 0;
  for (const cue of cues) {
    cue.start = start;
    start += cue.duration;
  }
  return cues;
}

/** `2s`, `500ms` or `1.5` as seconds; a pause without a length is one second. */
function seconds(value: string | null): number {
  const match = value?.match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/);
  if (!match) return 1;
  const amount = Number(match[1]);
  return match[2] === "ms" ? amount / 1000 : amount;
}

/** What plays the story: its recording, or a clock until there is one. */
interface Playback {
  readonly time: number;
  readonly duration: number;
  readonly playing: boolean;
  rate: number;
  play(): void;
  pause(): void;
  seek(time: number): void;
  stop(): void;
}

/** The stand-in for a recording: a clock that runs while playing. */
class Clock implements Playback {
  time = 0;
  rate = 1;
  duration = 0;
  playing = false;
  private last = 0;
  constructor(private readonly onTick: (time: number) => void) {}
  play(): void {
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }
  pause(): void {
    this.playing = false;
  }
  seek(time: number): void {
    this.time = Math.max(0, Math.min(time, this.duration));
    this.onTick(this.time);
  }
  stop(): void {
    this.playing = false;
  }
  private frame = (now: number) => {
    if (!this.playing) return;
    this.time += ((now - this.last) / 1000) * this.rate;
    this.last = now;
    if (this.time >= this.duration) {
      this.time = this.duration;
      this.playing = false;
      showPlaying();
    }
    this.onTick(this.time);
    if (this.playing) requestAnimationFrame(this.frame);
  };
}

/** A story's recording, read every frame while it plays so the page keeps up with it. */
class Recording implements Playback {
  private readonly audio: HTMLAudioElement;
  constructor(
    src: string,
    readonly duration: number,
    private readonly onTick: (time: number) => void,
  ) {
    this.audio = new Audio(src);
    this.audio.preload = "auto";
    this.audio.addEventListener("play", showPlaying);
    this.audio.addEventListener("pause", showPlaying);
    this.audio.addEventListener("ended", () => {
      this.onTick(this.duration);
      showPlaying();
    });
  }
  get time(): number {
    return this.audio.currentTime;
  }
  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }
  get rate(): number {
    return this.audio.playbackRate;
  }
  set rate(value: number) {
    this.audio.playbackRate = value;
  }
  play(): void {
    if (this.audio.ended) this.audio.currentTime = 0;
    this.audio.play().catch(() => showPlaying());
    requestAnimationFrame(this.frame);
  }
  pause(): void {
    this.audio.pause();
  }
  seek(time: number): void {
    this.audio.currentTime = Math.max(0, Math.min(time, this.duration));
    this.onTick(this.audio.currentTime);
  }
  stop(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
  private frame = () => {
    this.onTick(this.audio.currentTime);
    if (this.playing) requestAnimationFrame(this.frame);
  };
}

/** The timings scripts/speak.mjs writes for each recording. */
type Manifest = {
  audio: string;
  voices: Record<string, string>;
  duration: number;
  cues: Array<Omit<Cue, "line" | "element"> & { line: [number, number] }>;
};

const recordings = import.meta.glob<Manifest>("./recordings/*.json", {
  eager: true,
  import: "default",
});

function manifestOf(name: string): Manifest | null {
  return recordings[`./recordings/${name.replace(/\.vxd$/, "")}.json`] ?? null;
}

const state = {
  name: "",
  story: parse(""),
  cues: [] as Cue[],
  current: -1,
  colors: new Map<string, string>(),
  voices: {} as Record<string, string>,
  rate: 1,
  userScrolled: 0,
};
let player: Playback = new Clock(tick);
const sheet = $<HTMLElement>("#script");

function load(name: string): void {
  const example = examples.find((candidate) => candidate.name === name);
  if (!example) return;
  player.stop();
  const manifest = manifestOf(name);
  state.name = name;
  history.replaceState(null, "", `#${name.replace(/\.vxd$/, "")}`);
  state.story = parse(example.text);
  state.colors = characterColors(state.story);
  state.voices = manifest?.voices ?? STORIES[name] ?? {};
  sheet.innerHTML = renderScript(state.story, { positions: true });
  state.cues = manifest
    ? manifest.cues.map((cue) => ({
        ...cue,
        line: { from: cue.line[0], to: cue.line[1] },
        element: null,
      }))
    : cuesOf(state.story);
  const last = state.cues.at(-1);
  if (manifest) player = new Recording(`./listen/${manifest.audio}`, manifest.duration, tick);
  else {
    const clock = new Clock(tick);
    clock.duration = last ? last.start + last.duration : 0;
    player = clock;
  }
  player.rate = state.rate;
  $<HTMLElement>(".mock-note").hidden = Boolean(manifest);
  for (const cue of state.cues) {
    cue.element =
      sheet.querySelector<HTMLElement>(`${SELECTOR[cue.kind]}[data-from="${cue.from}"]`) ??
      (cue.kind === "page"
        ? sheet.querySelector<HTMLElement>(`.vxd-turn[data-from="${cue.line.from}"]`)
        : null);
    cue.element?.classList.add("cue");
  }
  state.current = -1;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".story")) {
    button.setAttribute("aria-selected", String(button.dataset.name === name));
  }
  showCast();
  showTicks();
  player.seek(0);
  showPlaying();
  window.scrollTo({ top: 0 });
}

function tick(time: number): void {
  let index = -1;
  for (let i = 0; i < state.cues.length; i++) {
    if ((state.cues[i]?.start ?? 0) <= time) index = i;
    else break;
  }
  if (index !== state.current) {
    state.cues[state.current]?.element?.classList.remove("speaking");
    state.current = index;
    const cue = state.cues[index];
    if (cue) {
      cue.element?.classList.add("speaking");
      showNow(cue);
      follow(cue.element);
    }
  }
  const total = player.duration || 1;
  $<HTMLElement>("#fill").style.width = `${(time / total) * 100}%`;
  $<HTMLElement>("#progress").setAttribute(
    "aria-valuenow",
    String(Math.round((time / total) * 100)),
  );
  $<HTMLElement>("#time").textContent = `${clockTime(time)} / ${clockTime(player.duration)}`;
}

function clockTime(time: number): string {
  const whole = Math.floor(time);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The character's full name, or how the narrator is written. */
function nameOf(speaker: string): string {
  return state.story.cast.find((member) => member.handle === speaker)?.name ?? speaker;
}

function showNow(cue: Cue): void {
  const color = cue.speaker ? state.colors.get(cue.speaker) : undefined;
  const dot = `<span class="dot"${color ? ` style="--c: ${color}"` : ""}></span>`;
  const who =
    cue.kind === "speech" || cue.kind === "vocal"
      ? `${dot}<strong>${escapeHtml(nameOf(cue.speaker ?? ""))}</strong>${cue.direction ? ` <em>${escapeHtml(cue.direction)}</em>` : ""}`
      : cue.kind === "sound"
        ? `<span class="kind">Sound</span> ${escapeHtml(cue.text)}`
        : cue.kind === "pause"
          ? `<span class="kind">Pause</span> ${escapeHtml(cue.text || "1s")}`
          : `<span class="kind">Page turn</span>`;
  $<HTMLElement>("#now-short").innerHTML = who;
  $<HTMLElement>("#now-source").innerHTML = sourceLine(cue.line);
  const voice = cue.speaker ? state.voices[cue.speaker] : undefined;
  if (cue.sent !== undefined) {
    // A recording says what it was made from; tags in it are the directions a voice performed.
    const made = escapeHtml(cue.sent ?? "").replace(
      /\[[^\]]*\]/g,
      (tag) => `<span class="tag">${tag}</span>`,
    );
    const by =
      cue.kind === "speech" || (cue.kind === "vocal" && cue.sent?.startsWith("["))
        ? `${voice ?? "?"}:`
        : cue.kind === "vocal" || cue.kind === "sound" || cue.kind === "page"
          ? "Sound effect:"
          : `Silence: ${cue.text || "1s"}`;
    $<HTMLElement>("#now-sent").innerHTML = `<span class="voice">${escapeHtml(by)}</span> ${made}`;
    return;
  }
  const tag = cue.direction ? `<span class="tag">[${escapeHtml(cue.direction)}]</span> ` : "";
  $<HTMLElement>("#now-sent").innerHTML =
    cue.kind === "speech"
      ? `<span class="voice">${escapeHtml(voice ?? "?")}:</span> ${tag}${escapeHtml(cue.text)}`
      : cue.kind === "vocal"
        ? `<span class="voice">${escapeHtml(voice ?? "?")}:</span> ${tag}<span class="tag">[${escapeHtml(cue.text)}]</span>`
        : cue.kind === "sound"
          ? `<span class="voice">Sound effect:</span> ${escapeHtml(cue.text)}`
          : cue.kind === "pause"
            ? `<span class="voice">Silence:</span> ${escapeHtml(cue.text || "1s")}`
            : `<span class="voice">A page turn:</span> a short pause`;
}

/** The line as written in VoxDown, its marks colored as in the editor. */
function sourceLine(line: { from: number; to: number }): string {
  const source = state.story.source;
  const found = tokens(state.story).filter(
    (token) => token.range.from >= line.from && token.range.to <= line.to,
  );
  let html = "";
  let at = line.from;
  for (const token of found) {
    if (token.range.from < at) continue;
    html += escapeHtml(source.slice(at, token.range.from));
    const color = token.speaker ? state.colors.get(token.speaker) : undefined;
    html += `<span class="t-${token.kind}"${color ? ` style="--c: ${color}"` : ""}>${escapeHtml(source.slice(token.range.from, token.range.to))}</span>`;
    at = token.range.to;
  }
  return html + escapeHtml(source.slice(at, line.to));
}

function showCast(): void {
  const narrator = state.story.meta.narrator;
  const handles = [
    narrator,
    ...state.story.cast.map((member) => member.handle).filter((handle) => handle !== narrator),
  ];
  $<HTMLElement>("#cast").innerHTML = handles
    .map((handle) => {
      const member = state.story.cast.find((candidate) => candidate.handle === handle);
      const color = state.colors.get(handle);
      return `<li><span class="dot"${color ? ` style="--c: ${color}"` : ""}></span><span class="who">${escapeHtml(member?.name ?? handle)}</span><span class="voice">${escapeHtml(state.voices[handle] ?? "—")}</span>${member?.about ? `<span class="about">${escapeHtml(member.about)}</span>` : ""}</li>`;
    })
    .join("");
}

/** Page turns as marks along the progress bar. */
function showTicks(): void {
  const progress = $<HTMLElement>("#progress");
  for (const old of progress.querySelectorAll(".tick")) old.remove();
  for (const cue of state.cues) {
    if (cue.kind !== "page") continue;
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.left = `${(cue.start / (player.duration || 1)) * 100}%`;
    progress.append(tick);
  }
}

function glide(): ScrollBehavior {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Keeps the part being heard in view, unless the listener has just scrolled away themselves. */
function follow(element: HTMLElement | null): void {
  if (!element || !player.playing || performance.now() - state.userScrolled < 4000) return;
  const box = element.getBoundingClientRect();
  const height = window.innerHeight;
  if (box.top < height * 0.2 || box.bottom > height * 0.65) {
    window.scrollTo({ top: window.scrollY + box.top - height * 0.35, behavior: glide() });
  }
}
for (const event of ["wheel", "touchmove"]) {
  window.addEventListener(
    event,
    () => {
      state.userScrolled = performance.now();
    },
    { passive: true },
  );
}

function showPlaying(): void {
  const button = $<HTMLButtonElement>("#play");
  button.classList.toggle("playing", player.playing);
  button.setAttribute("aria-label", player.playing ? "Pause" : "Play");
}

function toggle(): void {
  if (player.playing) player.pause();
  else {
    state.userScrolled = 0;
    player.play();
  }
  showPlaying();
}

function step(by: number): void {
  const target = state.cues[Math.max(0, Math.min(state.cues.length - 1, state.current + by))];
  if (target) player.seek(target.start + 0.001);
}

// The controls

for (const name of Object.keys(STORIES)) {
  const example = examples.find((candidate) => candidate.name === name);
  if (!example) continue;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "story";
  button.setAttribute("role", "tab");
  button.dataset.name = name;
  button.innerHTML = `<span class="title">${escapeHtml(example.title)}</span><span class="by">${escapeHtml(example.byline)}</span>`;
  button.addEventListener("click", () => load(name));
  $<HTMLElement>("#stories").append(button);
}

$<HTMLButtonElement>("#play").addEventListener("click", toggle);
$<HTMLButtonElement>("#previous").addEventListener("click", () => step(-1));
$<HTMLButtonElement>("#next").addEventListener("click", () => step(1));
const RATES = [1, 1.25, 1.5, 0.75];
$<HTMLButtonElement>("#speed").addEventListener("click", (event) => {
  state.rate = RATES[(RATES.indexOf(state.rate) + 1) % RATES.length] ?? 1;
  player.rate = state.rate;
  (event.currentTarget as HTMLButtonElement).textContent = `${state.rate}×`;
});
const progress = $<HTMLElement>("#progress");
progress.addEventListener("click", (event) => {
  const box = progress.getBoundingClientRect();
  player.seek(((event.clientX - box.left) / box.width) * player.duration);
});
progress.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") step(1);
  else if (event.key === "ArrowLeft") step(-1);
  else return;
  event.preventDefault();
});

// A click on a part of the script plays from there.
sheet.addEventListener("click", (event) => {
  if (window.getSelection()?.toString()) return;
  const element = (event.target as Element).closest<HTMLElement>(".cue");
  const cue = state.cues.find((candidate) => candidate.element === element);
  if (!cue) return;
  player.seek(cue.start + 0.001);
  if (!player.playing) toggle();
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
  if (event.key === " ") {
    toggle();
    event.preventDefault();
  }
});

// The story the address names (listen.html#the-north-wind-and-the-sun), else the first.
const named = `${decodeURIComponent(location.hash.slice(1))}.vxd`;
load(named in STORIES ? named : (Object.keys(STORIES)[0] ?? ""));
