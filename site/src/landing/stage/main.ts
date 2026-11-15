/**
 * The Stage landing page: the recorded dragon scene as the opening act, lit line by line from the
 * recording's cues (the front page's approach), then the acts, the backstage and the curtain call.
 * The recording loads only when something is played.
 */
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import { escapeHtml } from "@voxdown/render";
import { type Story, characterColors, parse, tokens } from "voxdown";
import { examples } from "../../examples";
import manifestJson from "../../recordings/the-dragon-who-would-not-roar.json";
import "./stage.css";

type Cue = {
  kind: string;
  speaker: string | null;
  direction: string | null;
  start: number;
  duration: number;
  line: [number, number];
  text: string;
};
type Manifest = { audio: string; duration: number; voices: Record<string, string>; cues: Cue[] };

const manifest = manifestJson as unknown as Manifest;
const example = examples.find((each) => each.name === "the-dragon-who-would-not-roar.vxd");
if (!example) throw new Error("The dragon story is missing");
const story = parse(example.text);
const source = story.source;
const NARRATOR = story.meta.narrator;
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = <T extends HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};

/** Each character's colour as the Writer gives it; the narrator is the stage's own gold. */
const writerColors = characterColors(story);
const GOLD = "#f2c46d";
const SOUND = "#5eead4";
const colorOf = (speaker: string | null | undefined): string =>
  !speaker || speaker === NARRATOR ? GOLD : (writerColors.get(speaker) ?? GOLD);
/** The Writer's colours are made for paper; on the dark stage each is lifted toward the light. */
const glowOf = (speaker: string | null | undefined): string =>
  !speaker || speaker === NARRATOR ? GOLD : `color-mix(in oklab, ${colorOf(speaker)} 52%, #fff4e6)`;

function nameOf(speaker: string | null): string {
  if (!speaker || speaker === NARRATOR) return "The narrator";
  return story.cast.find((member) => member.handle === speaker)?.name ?? speaker;
}

/** A stretch of a story as written, each mark in a span coloured as the Writer colours it. */
function marked(of: Story, from: number, to: number, fresh: Set<string> = new Set()): string {
  const text = of.source;
  const colors = characterColors(of);
  let html = "";
  let at = from;
  for (const token of tokens(of)) {
    if (token.range.from < at || token.range.to > to) continue;
    html += escapeHtml(text.slice(at, token.range.from));
    const color = token.speaker ? colors.get(token.speaker) : undefined;
    const style = color ? ` style="--c: ${color}"` : "";
    const isFresh = fresh.has(token.kind) ? " fresh" : "";
    html += `<span class="t-${token.kind}${isFresh}"${style}>${escapeHtml(text.slice(token.range.from, token.range.to))}</span>`;
    at = token.range.to;
  }
  return html + escapeHtml(text.slice(at, to));
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The scene's length, rounded up as the buttons say it. */
const sceneLength = clock(Math.ceil(manifest.duration));

/* ------------------------------------------------------------------------------------------ */
/* The recording, shared by the stage and the auditions.                                       */

const player = {
  audio: undefined as HTMLAudioElement | undefined,
  /** An audition plays one stretch and stops at its end. */
  stopAt: Number.POSITIVE_INFINITY,
  audition: undefined as HTMLButtonElement | undefined,
  /** Where the scene was when an audition borrowed the recording: it carries on from there. */
  sceneAt: undefined as number | undefined,
};

function audioOf(): HTMLAudioElement {
  if (player.audio) return player.audio;
  const audio = new Audio(`../../listen/${manifest.audio}`);
  audio.preload = "auto";
  audio.addEventListener("play", () => {
    showPlaying();
    requestAnimationFrame(frame);
  });
  audio.addEventListener("pause", showPlaying);
  audio.addEventListener("ended", () => {
    player.stopAt = Number.POSITIVE_INFINITY;
    showPlaying();
  });
  player.audio = audio;
  return audio;
}

function frame(): void {
  const audio = player.audio;
  if (!audio) return;
  if (audio.currentTime >= player.stopAt) {
    audio.pause();
    player.stopAt = Number.POSITIVE_INFINITY;
  }
  tick(audio.currentTime);
  if (!audio.paused && !audio.ended) requestAnimationFrame(frame);
}

const playing = () => Boolean(player.audio && !player.audio.paused && !player.audio.ended);

/* ------------------------------------------------------------------------------------------ */
/* The stage: the scene as written, the line being heard lit in its speaker's colour.          */

const stage = $<HTMLElement>("#stage");
const reel = $<HTMLElement>("#reel");
const windowEl = $<HTMLElement>("#script-window");
const cueWho = $<HTMLElement>("#cue-who");
const cueHow = $<HTMLElement>("#cue-how");
const stagePlay = $<HTMLButtonElement>("#stage-play");
const heroPlay = $<HTMLButtonElement>("#hero-play");
const time = $<HTMLElement>("#stage-time");
const score = $<HTMLElement>("#score");
const now = $<HTMLElement>("#now");
const nowPlay = $<HTMLButtonElement>("#now-play");
const nowWho = $<HTMLElement>("#now-who");
const nowHow = $<HTMLElement>("#now-how");
let stageSeen = true;

stage.style.setProperty("--gold", GOLD);
for (const spot of stage.querySelectorAll<HTMLElement>(".spot")) {
  const who = spot.className.match(/spot-(\w+)/)?.[1] ?? "";
  spot.style.setProperty("--c", who === "sound" ? SOUND : glowOf(who));
}
for (const actor of stage.querySelectorAll<HTMLElement>(".actor"))
  actor.style.setProperty("--c", glowOf(actor.dataset.who));

const rows: Array<{ from: number; element: HTMLElement }> = [];
{
  // From the very top: the cast in the front matter waits above the title, like a programme.
  const castEnd = story.frontMatter?.range.to ?? 0;
  let at = 0;
  for (const text of source.split("\n")) {
    const row = document.createElement("p");
    row.className = "row";
    if (!text) row.classList.add("gap");
    if (at < castEnd) row.classList.add("programme");
    else if (/^%%/.test(text)) row.classList.add("programme");
    row.innerHTML = text ? marked(story, at, at + text.length) : "";
    rows.push({ from: at, element: row });
    reel.append(row);
    at += text.length + 1;
  }
  // A line clicked plays from its first cue.
  reel.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".row");
    const found = rows.find((each) => each.element === row);
    if (!found) return;
    const next = rows[rows.indexOf(found) + 1]?.from ?? Number.POSITIVE_INFINITY;
    const cue = manifest.cues.find((c) => c.line[0] >= found.from && c.line[0] < next);
    if (!cue) return;
    startAt(cue.start);
  });
}

const view = { cue: -2, row: -1, offset: 0 };

/** The lit line, held at the middle of the stage: the reel moves, the spotlight stays. */
function center(row: number): void {
  const element = rows[row]?.element;
  if (!element) return;
  const target = windowEl.clientHeight * 0.46 - (element.offsetTop + element.offsetHeight / 2);
  view.offset = target;
  reel.style.transform = `translate3d(0, ${target}px, 0)`;
}

function tick(seconds: number): void {
  const { cues, duration } = manifest;
  let cue = -1;
  for (let i = 0; i < cues.length; i++) {
    if ((cues[i]?.start ?? 0) <= seconds) cue = i;
    else break;
  }
  setProgress(seconds / duration);
  time.textContent = `${clock(seconds)} / ${sceneLength}`;
  score.setAttribute("aria-valuenow", String(Math.round(seconds)));
  score.setAttribute("aria-valuetext", `${clock(seconds)} of ${sceneLength}`);
  if (cue === view.cue) return;
  view.cue = cue;
  const heard = cues[cue];
  if (!heard) {
    light(titleRow, "", null);
    return;
  }
  let row = -1;
  for (const [i, each] of rows.entries()) if (each.from <= heard.line[0]) row = i;
  const who =
    heard.kind === "speech" || heard.kind === "vocal"
      ? (heard.speaker ?? NARRATOR)
      : heard.kind === "sound"
        ? "sound"
        : "";
  light(row, who, heard);
}

function light(row: number, who: string, heard: Cue | null): void {
  stage.dataset.speaker = who;
  if (row !== view.row) {
    rows[view.row]?.element.classList.remove("lit");
    view.row = row;
    const element = rows[row]?.element;
    if (element) {
      element.classList.add("lit");
      element.style.setProperty("--lit", who === "sound" || !who ? GOLD : glowOf(who));
    }
    center(row);
  } else if (rows[row] && who && who !== "sound") {
    rows[row].element.style.setProperty("--lit", glowOf(who));
  }
  if (!heard) {
    cueWho.textContent = "The house lights dim.";
    cueHow.textContent = "Press play: each line lights up as it is heard.";
    stage.style.setProperty("--cue", GOLD);
    return;
  }
  const kind = heard.kind;
  cueWho.textContent =
    kind === "speech" || kind === "vocal"
      ? nameOf(heard.speaker)
      : kind === "sound"
        ? "A sound"
        : kind === "pause"
          ? "A pause"
          : "A page turns";
  cueHow.textContent =
    kind === "vocal" || kind === "sound"
      ? `[${heard.text}]`
      : kind === "pause"
        ? "{pause}"
        : kind === "page"
          ? "{page}"
          : heard.direction
            ? `(${heard.direction})`
            : " ";
  stage.style.setProperty("--cue", who === "sound" ? SOUND : who ? glowOf(who) : GOLD);
  nowWho.textContent = cueWho.textContent;
  nowHow.textContent = cueHow.textContent === "\u00a0" ? "" : (cueHow.textContent ?? "");
  now.style.setProperty("--cue", who === "sound" ? SOUND : who ? glowOf(who) : GOLD);
}

/** The pill shows only while the scene plays with the stage out of sight. */
function showNow(): void {
  const on = playing() && player.stopAt === Number.POSITIVE_INFINITY && !stageSeen;
  now.classList.toggle("show", on);
  now.setAttribute("aria-hidden", String(!on));
  for (const control of now.querySelectorAll<HTMLElement>("button, a"))
    control.tabIndex = on ? 0 : -1;
}

function showPlaying(): void {
  const on = playing();
  const auditioning = on && player.stopAt !== Number.POSITIVE_INFINITY;
  stage.classList.toggle("playing", on && !auditioning);
  document.body.classList.toggle("show-on", on && !auditioning);
  for (const button of [stagePlay, heroPlay])
    button.classList.toggle("playing", on && !auditioning);
  stagePlay.setAttribute("aria-label", on && !auditioning ? "Pause the scene" : "Play the scene");
  $(".hero-play-label").textContent = on && !auditioning ? "Pause the scene" : "Hear the scene";
  for (const button of document.querySelectorAll<HTMLButtonElement>(".audition")) {
    const mine = auditioning && button === player.audition;
    button.classList.toggle("playing", mine);
    button.setAttribute("aria-pressed", String(mine));
  }
  if (!auditioning) player.audition = undefined;
  showNow();
}

function toggle(): void {
  const audio = audioOf();
  if (player.stopAt !== Number.POSITIVE_INFINITY) {
    // An audition was playing: the scene takes the recording back, from where the scene was.
    player.stopAt = Number.POSITIVE_INFINITY;
    player.audition = undefined;
    audio.currentTime = player.sceneAt ?? 0;
    player.sceneAt = undefined;
    if (audio.paused) audio.play().catch(() => showPlaying());
    else showPlaying();
    return;
  }
  if (audio.paused || audio.ended) {
    if (player.sceneAt !== undefined) {
      audio.currentTime = player.sceneAt;
      player.sceneAt = undefined;
    } else if (audio.ended) audio.currentTime = 0;
    audio.play().catch(() => showPlaying());
  } else audio.pause();
}

function startAt(seconds: number): void {
  const audio = audioOf();
  player.sceneAt = undefined;
  player.stopAt = Number.POSITIVE_INFINITY;
  player.audition = undefined;
  audio.currentTime = Math.max(0, Math.min(manifest.duration - 0.05, seconds));
  tick(audio.currentTime);
  if (audio.paused) audio.play().catch(() => showPlaying());
  else showPlaying();
}

function seek(seconds: number): void {
  const audio = audioOf();
  player.sceneAt = undefined;
  audio.currentTime = Math.max(0, Math.min(manifest.duration - 0.05, seconds));
  tick(audio.currentTime);
}

stagePlay.addEventListener("click", toggle);
nowPlay.addEventListener("click", () => player.audio?.pause());
new IntersectionObserver(
  ([entry]) => {
    stageSeen = Boolean(entry?.isIntersecting);
    showNow();
  },
  { threshold: 0.15 },
).observe(stage);
heroPlay.addEventListener("click", () => {
  toggle();
  const box = stage.getBoundingClientRect();
  if (box.top > window.innerHeight * 0.55 || box.bottom < 0)
    stage.scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" });
});

/* The score: the recording drawn as bars, each in the colour of whoever is speaking. */
let scoreWidth = 0;
const scoreLit = $<HTMLElement>(".score-lit", score);
const scoreLitInner = $<HTMLElement>(".score-lit-inner", score);
const scoreHead = $<HTMLElement>(".score-head", score);

function bars(from: number, to: number, step: number, height: number): string {
  const count = Math.round((to - from) / step);
  let svg = "";
  for (let i = 0; i < count; i++) {
    const t = from + i * step;
    const cue = manifest.cues.find((c) => c.start <= t && t < c.start + c.duration);
    // A steady, made-up texture: speech fuller than sounds, silence nearly flat.
    const n = 0.5 + 0.5 * Math.sin(i * 1.7) * Math.cos(i * 0.61 + 1.3);
    let h = 0.08;
    let color = "rgba(255,240,220,0.5)";
    if (cue?.kind === "speech") {
      h = 0.3 + 0.7 * n;
      color = colorOf(cue.speaker === NARRATOR ? null : cue.speaker);
      if (!cue.speaker || cue.speaker === NARRATOR) color = GOLD;
      else color = `color-mix(in oklab, ${color} 62%, #fff4e6)`;
    } else if (cue?.kind === "vocal") {
      h = 0.25 + 0.4 * n;
      color = `color-mix(in oklab, ${colorOf(cue.speaker)} 62%, #fff4e6)`;
    } else if (cue?.kind === "sound") {
      h = 0.18 + 0.3 * n;
      color = SOUND;
    }
    const bar = Math.max(1.5, h * height);
    svg += `<rect x="${(i * 4).toFixed(1)}" y="${((height - bar) / 2).toFixed(1)}" width="2.4" height="${bar.toFixed(1)}" rx="1.2" fill="${color}"/>`;
  }
  return `<svg viewBox="0 0 ${count * 4} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${svg}</svg>`;
}
{
  const svg = bars(0, manifest.duration, 0.5, 40);
  $<HTMLElement>(".score-dim", score).innerHTML = svg;
  scoreLitInner.innerHTML = svg;
}
let progress = 0;
function setProgress(share: number): void {
  progress = Math.max(0, Math.min(1, share));
  scoreLit.style.transform = `translate3d(${(progress - 1) * 100}%, 0, 0)`;
  scoreLitInner.style.transform = `translate3d(${(1 - progress) * 100}%, 0, 0)`;
  scoreHead.style.transform = `translate3d(${progress * scoreWidth}px, 0, 0)`;
}
function measure(): void {
  scoreWidth = score.clientWidth;
  setProgress(progress);
  if (view.row >= 0) center(view.row);
}
new ResizeObserver(measure).observe(score);
new ResizeObserver(() => view.row >= 0 && center(view.row)).observe(windowEl);
score.addEventListener("click", (event) => {
  const box = score.getBoundingClientRect();
  const seconds = ((event.clientX - box.left) / box.width) * manifest.duration;
  if (playing()) seek(seconds);
  else startAt(seconds);
});
score.addEventListener("keydown", (event) => {
  const now = player.audio?.currentTime ?? 0;
  const to =
    event.key === "ArrowRight" || event.key === "ArrowUp"
      ? now + 5
      : event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? now - 5
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? manifest.duration - 0.1
            : event.key === " " || event.key === "Enter"
              ? Number.NaN
              : undefined;
  if (to === undefined) return;
  event.preventDefault();
  if (Number.isNaN(to)) return toggle();
  seek(to);
});

// The curtain up: the title lit, before anyone presses play.
const titleRow = Math.max(
  0,
  rows.findIndex((row) => source.startsWith("# ", row.from)),
);
$("#hero-time").textContent = sceneLength;
requestAnimationFrame(() => {
  stage.classList.add("no-ease");
  light(titleRow, "", null);
  view.cue = -1;
  void reel.offsetHeight;
  stage.classList.remove("no-ease");
  time.textContent = sceneLength;
});

/* ------------------------------------------------------------------------------------------ */
/* Acts I and II: one passage, plain, then marked a kind at a time.                            */

{
  const steps: Array<{ text: string; fresh: string[] }> = [
    {
      fresh: [],
      text: `The dragon was snoring.

Sir Percival crept inside.
Clank.
Clank.
The dragon opened one eye.

“Could you not?”

Sir Percival stopped.

“I’ve only just got to sleep,” said the dragon.

“Real sheep?”`,
    },
    {
      fresh: ["mark", "name"],
      text: `The dragon was snoring.

Sir Percival crept inside.
Clank.
Clank.
The dragon opened one eye.

@Gerald “Could you not?”

Sir Percival stopped.

@Gerald “I’ve only just got to sleep,” said the dragon.

@Percival “Real sheep?”`,
    },
    {
      fresh: ["direction", "group"],
      text: `The dragon was snoring.

::: whispering
Sir Percival crept inside.
Clank.
Clank.
The dragon opened one eye.
:::

@Gerald (deep, polite and utterly unbothered) “Could you not?”

Sir Percival stopped.

@Gerald “I’ve only just got to sleep,” said the dragon.

@Percival “Real sheep?”`,
    },
    {
      fresh: ["sound", "vocal", "instruction"],
      text: `The dragon was snoring. @Gerald [snores]

::: whispering
Sir Percival crept inside.
Clank.
Clank.
{pause}
The dragon opened one eye.
:::

@Gerald (deep, polite and utterly unbothered) “Could you not?”

Sir Percival stopped.

@Gerald “I’ve only just got to sleep,” said the dragon.

@Percival “Real sheep?”`,
    },
  ];
  // The cast's front matter, so the passage colours its speakers as the whole story does.
  const front = source.slice(0, story.frontMatter?.range.to ?? 0);
  const states = $<HTMLElement>("#states");
  for (const [index, step] of steps.entries()) {
    const text = `${front}\n${step.text}`;
    const passage = parse(text);
    const start = front.length + 1;
    const state = document.createElement("pre");
    state.className = "state";
    state.dataset.state = String(index);
    if (index) state.setAttribute("aria-hidden", "true");
    state.innerHTML = marked(passage, start, text.length, new Set(step.fresh));
    states.append(state);
  }
  const manuscript = $<HTMLElement>("#manuscript");
  const numeral = $<HTMLElement>(".act-marks .numeral");
  const show = (step: number) => {
    if (manuscript.dataset.step === String(step)) return;
    manuscript.dataset.step = String(step);
    numeral.textContent = step ? "II" : "I";
    for (const state of states.children)
      state.setAttribute(
        "aria-hidden",
        String((state as HTMLElement).dataset.state !== String(step)),
      );
    for (const card of document.querySelectorAll<HTMLElement>(".cue-step"))
      card.classList.toggle("on", card.dataset.step === String(step));
  };
  show(0);
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) show(Number((entry.target as HTMLElement).dataset.step));
    },
    // On a phone the passage sits at the top, so a cue counts once it is well below it.
    { rootMargin: window.innerWidth < 760 ? "-68% 0px -24% 0px" : "-48% 0px -48% 0px" },
  );
  for (const card of document.querySelectorAll<HTMLElement>(".cue-step")) watch.observe(card);
}

/* ------------------------------------------------------------------------------------------ */
/* Act III: the cast, each with a line from the recording to audition.                         */

{
  const auditions: Record<string, [number, number]> = {
    Narrator: [1, 1],
    King: [5, 7],
    Percival: [40, 40],
    Gerald: [35, 36],
  };
  const list = $<HTMLElement>("#cast-list");
  const members = story.cast.filter((member) => auditions[member.handle]);
  for (const member of members) {
    const [first, last] = auditions[member.handle] as [number, number];
    const from = manifest.cues[first] as Cue;
    const to = manifest.cues[last] as Cue;
    const item = document.createElement("li");
    item.className = "player reveal";
    item.style.setProperty("--c", glowOf(member.handle));
    const name = member.handle === NARRATOR ? "The Narrator" : member.name;
    const voice = manifest.voices[member.handle];
    item.innerHTML = `
      <span class="medal" aria-hidden="true">${escapeHtml(name.replace(/^(The|Sir) /, "").slice(0, 1))}</span>
      <h3>${escapeHtml(name)}</h3>
      <p class="about">${escapeHtml(member.about ?? "")}</p>
      <p class="line"><code>${marked(story, from.line[0], from.line[1])}</code></p>
      <p class="voice">${voice ? `Voiced by “${escapeHtml(voice)}”` : ""}</p>
      <button class="audition" type="button" aria-pressed="false">
        <svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
        <svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
        <span>Hear ${escapeHtml(name.replace(/^The /, "the "))}</span>
      </button>`;
    const button = $<HTMLButtonElement>(".audition", item);
    button.addEventListener("click", () => {
      const audio = audioOf();
      if (player.audition === button && !audio.paused) {
        audio.pause();
        return;
      }
      if (player.sceneAt === undefined && player.stopAt === Number.POSITIVE_INFINITY)
        player.sceneAt = audio.ended ? 0 : audio.currentTime;
      player.audition = button;
      player.stopAt = to.start + to.duration + 0.25;
      audio.currentTime = Math.max(0, from.start - 0.05);
      if (audio.paused) audio.play().catch(() => showPlaying());
      else showPlaying();
    });
    list.append(item);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Act IV: one passage in every edition.                                                      */

{
  const FROM = 2016;
  const TO = 2322;
  const blocks = story.blocks.filter(
    (block) => block.kind === "paragraph" && block.range.from >= FROM && block.range.to <= TO,
  );
  $("#ed-source").innerHTML = `<pre>${marked(story, FROM, TO)}</pre>`;

  type Said = { who: string; how: string | null; text: string; quoted: boolean; vocal: boolean };
  const paragraphs: Said[][] = blocks.map((block) =>
    block.kind === "paragraph"
      ? block.lines.flatMap((line) =>
          line.items.flatMap((item): Said[] =>
            item.kind === "speech"
              ? [
                  {
                    who: item.speaker,
                    how: item.direction,
                    text: item.text,
                    quoted: item.quoted,
                    vocal: false,
                  },
                ]
              : item.kind === "vocal"
                ? [
                    {
                      who: item.speaker,
                      how: null,
                      text: item.description,
                      quoted: false,
                      vocal: true,
                    },
                  ]
                : [],
          ),
        )
      : [],
  );

  const book = paragraphs
    .map(
      (said) =>
        `<p>${said
          .filter((each) => !each.vocal)
          .map((each) => (each.quoted ? `“${escapeHtml(each.text)}”` : escapeHtml(each.text)))
          .join(" ")}</p>`,
    )
    .join("");
  $("#ed-book").innerHTML =
    `<p class="running">The Dragon Who Would Not Roar</p>${book}<p class="folio">9</p>`;

  const upper = (who: string) =>
    nameOf(who === NARRATOR ? null : who)
      .replace(/^The /, "")
      .toUpperCase();
  const lines = paragraphs.flat();
  $("#ed-script").innerHTML = lines
    .map(
      (each) =>
        `<p style="--c: ${glowOf(each.who)}"><b>${escapeHtml(upper(each.who))}</b>${
          each.vocal
            ? `<span class="s-sound">[${escapeHtml(each.text)}]</span>`
            : `${each.how ? `<i>(${escapeHtml(each.how)})</i> ` : ""}${escapeHtml(each.text)}`
        }</p>`,
    )
    .join("");

  let sides = "";
  for (const [i, each] of lines.entries()) {
    if (each.who !== "Percival") continue;
    const before = lines
      .slice(0, i)
      .reverse()
      .find((other) => other.who !== "Percival" && !other.vocal);
    if (before) {
      const words = before.text.split(/\s+/);
      sides += `<p class="cueline">…${escapeHtml(words.slice(-4).join(" "))}</p>`;
    }
    sides += `<p class="mine"><b>SIR PERCIVAL</b>${escapeHtml(each.text)}</p>`;
  }
  $("#ed-sides").innerHTML = sides;

  const first = manifest.cues[35] as Cue;
  const last = manifest.cues[43] as Cue;
  const castRows = story.cast
    .map(
      (member) =>
        `<li style="--c: ${glowOf(member.handle)}"><span>${escapeHtml(member.handle === NARRATOR ? "Narrator" : member.name)}</span><span>${escapeHtml(manifest.voices[member.handle] ?? "")}</span></li>`,
    )
    .join("");
  $("#ed-audio").innerHTML = `
    <div class="mini-player"><span class="mini-play" aria-hidden="true"></span><span><b>The battle</b><small>${clock(first.start)} – ${clock(last.start + last.duration)}</small></span></div>
    <div class="mini-wave">${bars(first.start, last.start + last.duration, 0.25, 30)}</div>
    <ul class="voices">${castRows}</ul>
    <p class="engines">Kokoro, free on your computer · or ElevenLabs, OpenAI, Azure on your own account</p>`;

  const ms = paragraphs
    .map(
      (said) =>
        `<p>${said
          .filter((each) => !each.vocal)
          .map((each) => (each.quoted ? `“${escapeHtml(each.text)}”` : escapeHtml(each.text)))
          .join(" ")}</p>`,
    )
    .join("");
  $("#ed-ms").innerHTML = `<p class="ms-head">Name / DRAGON / 9</p>${ms}`;
}

/* ------------------------------------------------------------------------------------------ */
/* Scrolling: the house lights, things arriving, the editions dealt out, the curtains.         */

{
  const masthead = $<HTMLElement>("#masthead");
  const onScroll = () => masthead.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const arrive = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          arrive.unobserve(entry.target);
        }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  for (const element of document.querySelectorAll(".reveal, .editions, .curtain-call, .screen"))
    arrive.observe(element);

  // The editions are dealt from one pile: each card starts where the pile is, then takes its seat.
  const editions = $<HTMLElement>("#editions");
  const deal = () => {
    if (calm.matches || window.innerWidth < 760 || editions.classList.contains("in")) return;
    const box = editions.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    for (const [i, card] of [...editions.children].entries()) {
      const element = card as HTMLElement;
      element.style.transform = "";
      const own = element.getBoundingClientRect();
      const dx = cx - (own.left + own.width / 2);
      const dy = cy - (own.top + own.height / 2);
      element.style.setProperty(
        "--from",
        `translate(${dx}px, ${dy}px) rotate(${(i - 2.5) * 4}deg)`,
      );
    }
    editions.classList.add("dealt");
  };
  deal();

  // Pictures still being painted: the stage looks finished without them.
  for (const image of document.querySelectorAll<HTMLImageElement>("img.art")) {
    const missing = () =>
      image.closest(".actor, .mic, .book-art, .hoard")?.classList.add("missing");
    image.addEventListener("error", missing);
    if (image.complete && image.naturalWidth === 0) missing();
  }
}
