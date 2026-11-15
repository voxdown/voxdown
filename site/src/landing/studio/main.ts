/**
 * The studio landing page: a recorded scene lit line by line in the hero, one passage pinned and
 * turned into plain text, marks, a book, a script and an audiobook as the page scrolls, and the
 * Writer's features as a bento. The recordings load only when played.
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
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/* ------------------------------------------------------------------ the recordings */

type Cue = {
  kind: string;
  speaker: string | null;
  direction: string | null;
  start: number;
  duration?: number;
  line: [number, number];
};
type Manifest = { audio: string; duration: number; cues: Cue[] };
const recordings = import.meta.glob<Manifest>("../../recordings/*.json", {
  eager: true,
  import: "default",
});
const manifestOf = (name: string) =>
  recordings[`../../recordings/${name.replace(/\.vxd$/, "")}.json`];

const scenes = examples
  .map((example) => ({ example, manifest: manifestOf(example.name) }))
  .filter((s): s is { example: (typeof examples)[number]; manifest: Manifest } =>
    Boolean(s.manifest),
  )
  .sort(
    (a, b) => Number(b.example.name.includes("dragon")) - Number(a.example.name.includes("dragon")),
  );

/** One sound at a time on the page: starting one pauses the other. */
const players = new Set<HTMLAudioElement>();
function claim(audio: HTMLAudioElement): void {
  for (const other of players) if (other !== audio && !other.paused) other.pause();
}
function makeAudio(file: string): HTMLAudioElement {
  const audio = new Audio(`../../listen/${file}`);
  audio.preload = "auto";
  players.add(audio);
  audio.addEventListener("play", () => claim(audio));
  return audio;
}

/* ------------------------------------------------------------------ marks, coloured */

/** What each mark is, for the hero's tooltip and its "spot the marks" buttons. */
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

/* ------------------------------------------------------------------ the hero's scene */

const sheet = $("#sheet");
const demoPlay = $<HTMLButtonElement>("#demo-play");
const heroPlay = $<HTMLButtonElement>("#hero-play");
const nowText = $("#now-text");
const nowDot = $("#now-dot");
const fill = $("#track-fill");
const track = $("#track");
const time = $("#time");
const heroTime = $("#hero-time");
const tip = $("#tip");

/** The kind of mark the "spot the marks" buttons are showing, if any. */
let spot = "";

const hero = {
  index: 0,
  story: parse(""),
  colors: new Map<string, string>(),
  rows: [] as Array<{ from: number; element: HTMLElement }>,
  current: -1,
  row: -1,
  audio: undefined as HTMLAudioElement | undefined,
};

function nameOf(story: Story, speaker: string | null): string {
  if (!speaker || speaker === story.meta.narrator) return "The narrator";
  return story.cast.find((member) => member.handle === speaker)?.name ?? speaker;
}

function showScene(index: number): void {
  const scene = scenes[index];
  if (!scene) return;
  hero.audio?.pause();
  hero.audio = undefined;
  hero.index = index;
  hero.current = -1;
  hero.row = -1;
  hero.story = parse(scene.example.text);
  hero.colors = characterColors(hero.story);
  const source = hero.story.source;
  const heading = hero.story.blocks.find((block) => block.kind === "heading");
  const start = heading?.range.from ?? 0;
  const lines = hero.story.blocks.flatMap((block) =>
    block.kind === "paragraph" ? block.lines : [],
  );
  sheet.replaceChildren();
  hero.rows = [];
  let at = start;
  for (const text of source.slice(start).replace(/\s+$/, "").split("\n")) {
    const row = document.createElement("div");
    row.className = text ? "row" : "row gap";
    row.innerHTML = text ? marked(hero.story, at, at + text.length, hero.colors) : "";
    const speaker = lines
      .find((line) => line.range.from === at)
      ?.items.find((item) => item.kind === "speech")?.speaker;
    const color = speaker ? hero.colors.get(speaker) : undefined;
    if (color) row.style.setProperty("--c", color);
    sheet.append(row);
    hero.rows.push({ from: at, element: row });
    at += text.length + 1;
  }
  sheet.scrollTop = 0;
  for (const [i, tab] of document.querySelectorAll<HTMLButtonElement>(".demo-tab").entries()) {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  }
  $<HTMLAnchorElement>("#demo-open").href =
    `../../writer/#example=${scene.example.name.replace(/\.vxd$/, "")}`;
  nowText.textContent = "Press play: the line being heard lights up.";
  nowDot.style.removeProperty("--c");
  time.textContent = clock(scene.manifest.duration);
  heroTime.textContent = clock(scene.manifest.duration);
  $(".hero-play-label").textContent = scene.example.name.includes("dragon")
    ? "Hear the dragon scene"
    : "Hear the fable";
  fill.style.transform = "scaleX(0)";
  track.setAttribute("aria-valuenow", "0");
  track.setAttribute("aria-valuetext", "0:00");
  applySpot();
  showHeroPlaying();
}

function heroAudio(): HTMLAudioElement {
  if (hero.audio) return hero.audio;
  const scene = scenes[hero.index] as (typeof scenes)[number];
  const audio = makeAudio(scene.manifest.audio);
  audio.addEventListener("play", () => {
    showHeroPlaying();
    requestAnimationFrame(heroFrame);
  });
  audio.addEventListener("pause", showHeroPlaying);
  audio.addEventListener("ended", showHeroPlaying);
  hero.audio = audio;
  return audio;
}

function heroFrame(): void {
  const audio = hero.audio;
  if (!audio) return;
  heroTick(audio.currentTime);
  if (!audio.paused && !audio.ended) requestAnimationFrame(heroFrame);
}

function heroTick(seconds: number): void {
  const scene = scenes[hero.index] as (typeof scenes)[number];
  const { cues, duration } = scene.manifest;
  let cue = -1;
  for (let i = 0; i < cues.length; i++) {
    if ((cues[i]?.start ?? 0) <= seconds) cue = i;
    else break;
  }
  const share = Math.min(1, seconds / duration);
  fill.style.transform = `scaleX(${share})`;
  track.setAttribute("aria-valuenow", String(Math.round(share * 100)));
  track.setAttribute("aria-valuetext", clock(seconds));
  time.textContent = `${clock(seconds)} / ${clock(duration)}`;
  const heard = cues[cue];
  let row = -1;
  if (heard) for (const [i, each] of hero.rows.entries()) if (each.from <= heard.line[0]) row = i;
  if (heard && cue !== hero.current) {
    hero.current = cue;
    const direction = heard.direction ? `, ${heard.direction}` : "";
    nowText.textContent =
      heard.kind === "speech" || heard.kind === "vocal"
        ? `${nameOf(hero.story, heard.speaker)}${direction}`
        : heard.kind === "sound"
          ? "A sound"
          : heard.kind === "pause"
            ? "A pause"
            : "A page turns";
    const color =
      heard.speaker && heard.speaker !== hero.story.meta.narrator
        ? hero.colors.get(heard.speaker)
        : undefined;
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
  const playing = Boolean(hero.audio && !hero.audio.paused && !hero.audio.ended);
  demoPlay.classList.toggle("playing", playing);
  demoPlay.setAttribute("aria-label", playing ? "Pause the scene" : "Play the scene");
  sheet.classList.toggle("playing", playing);
  heroPlay.classList.toggle("playing", playing);
  $("#demo").classList.toggle("is-playing", playing);
  const scene = scenes[hero.index];
  const label = scene?.example.name.includes("dragon") ? "the dragon scene" : "the fable";
  $(".hero-play-label").textContent = playing ? `Pause ${label}` : `Hear ${label}`;
}

function toggleHero(): void {
  const audio = heroAudio();
  if (audio.paused || audio.ended) {
    if (audio.ended) audio.currentTime = 0;
    audio.play().catch(() => showHeroPlaying());
  } else audio.pause();
}

function seekHero(share: number): void {
  const scene = scenes[hero.index] as (typeof scenes)[number];
  const audio = heroAudio();
  audio.currentTime = Math.max(0, Math.min(1, share)) * scene.manifest.duration;
  heroTick(audio.currentTime);
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
      tabs.querySelectorAll<HTMLButtonElement>(".demo-tab")[next]?.focus();
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
    const scene = scenes[hero.index] as (typeof scenes)[number];
    const now = hero.audio?.currentTime ?? 0;
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
    if (!step) return;
    event.preventDefault();
    seekHero((now + step) / scene.manifest.duration);
  });
  showScene(0);
}

/* The "spot the marks" buttons: one kind of mark at a time, glowing in the sheet. */
function applySpot(): void {
  sheet.dataset.spot = spot;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".chip-k"))
    button.setAttribute("aria-pressed", String(button.dataset.spot === spot));
  if (!spot) return;
  const first = sheet.querySelector<HTMLElement>(`[data-spot="${spot}"]`);
  const playing = hero.audio && !hero.audio.paused;
  if (first && !playing) {
    const row = first.closest<HTMLElement>(".row");
    if (
      row &&
      (row.offsetTop < sheet.scrollTop || row.offsetTop > sheet.scrollTop + sheet.clientHeight - 30)
    )
      sheet.scrollTo({ top: row.offsetTop - 40, behavior: calm.matches ? "auto" : "smooth" });
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".chip-k"))
  button.addEventListener("click", () => {
    spot = spot === button.dataset.spot ? "" : (button.dataset.spot ?? "");
    applySpot();
  });

/* A tooltip that names the mark under the pointer. */
function explain(element: HTMLElement): string {
  const kind = element.className.replace(/^t-/, "");
  const text = element.textContent ?? "";
  const who = element.dataset.who ? nameOf(hero.story, element.dataset.who) : "";
  if (kind === "mark" || kind === "name") return `Who speaks: ${who}`;
  if (kind === "direction") return "How it’s said: a direction for the voice";
  if (kind === "group") return "A passage grouped under one voice or direction";
  if (kind === "sound") return "A sound in the world of the story";
  if (kind === "vocal") return `${who}’s own sound`;
  if (kind === "note") return "A note for the performer, never read aloud";
  if (kind === "heading") return "A heading";
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
  const frame = $("#demo").getBoundingClientRect();
  const half = tip.offsetWidth / 2 + 10;
  const x = Math.min(Math.max(box.left - frame.left + box.width / 2, half), frame.width - half);
  tip.style.transform = `translate(${x}px, ${box.top - frame.top - 8}px) translate(-50%, -100%)`;
  tip.classList.add("on");
});
sheet.addEventListener("pointerleave", () => tip.classList.remove("on"));
sheet.addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });

/* ------------------------------------------------------------------ one passage, five lives */

const dragon = examples.find((example) => example.name.includes("dragon"));
const dragonManifest = manifestOf("the-dragon-who-would-not-roar.vxd");
const FIRST = "@Gerald [yawns]";
const LAST = "{pause 2s}";

if (dragon && dragonManifest) {
  const full = dragon.text;
  const from = full.indexOf(FIRST);
  const to = full.indexOf(LAST, from) + LAST.length;
  const passage = full.slice(from, to);
  const front = full.slice(0, full.indexOf("---", 4) + 3);
  const mini = parse(`${front}\n\n${passage}\n`);
  const colors = characterColors(mini);
  const miniStart = mini.source.indexOf(FIRST);

  // 0: the words alone, as they might first be typed.
  const plain = passage
    .replace(/@\w+ \[[^\]]*\] /g, "")
    .replace(/@\(\w+\) /g, "")
    .replace(/@\w+ (\([^)]*\) )?/g, "")
    .replace(/\n*\{pause 2s\}$/, "")
    .trim();
  const plainHtml = plain
    .split(/\n\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  // 1: the same lines, marked.
  const markedHtml = mini.source
    .slice(miniStart)
    .replace(/\s+$/, "")
    .split("\n\n")
    .reduce(
      (out, paragraph) => {
        const at = mini.source.indexOf(paragraph, out.at);
        out.html += `<p>${marked(mini, at, at + paragraph.length, colors)}</p>`;
        out.at = at + paragraph.length;
        return out;
      },
      { html: "", at: miniStart },
    ).html;

  // 2 and 3: the book and the script, by the same renderer and stylesheet the Writer uses.
  const style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.prepend(style);
  const book = renderBook(mini, { header: false });
  const script = renderScript(mini, { header: false });

  // 4: the lines as voices on a timeline, from the recording's own cues.
  const SEG_FROM = 94.0;
  const SEG_TO = 116.6;
  const cues = dragonManifest.cues.filter(
    (cue) => cue.line[0] >= from && cue.line[0] < to && cue.start >= SEG_FROM - 1,
  );
  const lanes = [
    { key: "Narrator", name: "Narrator" },
    { key: "Gerald", name: "Gerald" },
    { key: "Percival", name: "Sir Percival" },
    { key: "", name: "Silence" },
  ];
  const span = SEG_TO - SEG_FROM;
  const laneHtml = lanes
    .map((lane) => {
      const bits = cues
        .filter((cue) =>
          lane.key ? cue.speaker === lane.key : cue.kind === "pause" || cue.kind === "sound",
        )
        .map((cue) => {
          const x = ((cue.start - SEG_FROM) / span) * 100;
          const w = (((cue.duration ?? 1) as number) / span) * 100;
          return `<i style="--x:${x.toFixed(2)}%;--w:${w.toFixed(2)}%" data-start="${cue.start}" data-end="${cue.start + (cue.duration ?? 1)}"></i>`;
        })
        .join("");
      const color = lane.key && lane.key !== "Narrator" ? colors.get(lane.key) : undefined;
      return `<div class="lane${lane.key ? "" : " lane-quiet"}"${color ? ` style="--c:${color}"` : ""}><span>${escapeHtml(lane.name)}</span><div class="lane-track">${bits}</div></div>`;
    })
    .join("");
  const audioHtml = `<div class="audio-panel">
      <div class="audio-now"><span class="audio-dot"></span><span class="audio-who" data-audio-who>Gerald, yawning</span><span class="audio-clock" data-audio-clock>0:00 / 0:22</span></div>
      <p class="audio-line" data-audio-line>“Is it a long doom? Only I’ve got a nap at four.”</p>
      <div class="lanes-live">${laneHtml}<div class="playhead-rail"><div class="playhead" data-playhead></div></div></div>
      <p class="audio-cast">Narrator <b>George</b> · Gerald <b>Gerald</b> · Sir Percival <b>Harry</b> <span>ElevenLabs voices</span></p>
    </div>`;

  const panels = [
    `<div class="pnl pnl-plain"><div class="pnl-text">${plainHtml}</div></div>`,
    `<div class="pnl pnl-marked"><div class="pnl-text">${markedHtml}</div></div>`,
    `<div class="pnl pnl-book"><div class="book-page" data-vxd-theme="light"><p class="book-run">The Dragon Who Would Not Roar</p>${book}<p class="book-folio">23</p></div></div>`,
    `<div class="pnl pnl-script"><div class="script-page" data-vxd-theme="light"><p class="script-head">SCENE 3 · THE BATTLE</p>${script}</div></div>`,
    `<div class="pnl pnl-audio">${audioHtml}</div>`,
  ];

  // The sticky stage on wide screens; each step's own panel on narrow ones.
  const stageBody = $("#stage-body");
  stageBody.innerHTML = panels
    .map((html, i) => `<div class="layer" data-layer="${i}">${html}</div>`)
    .join("");
  for (const holder of document.querySelectorAll<HTMLElement>("[data-panel]"))
    holder.innerHTML = panels[Number(holder.dataset.panel)] ?? "";

  // Lines the audio speaks, to show the one being heard.
  const lineAt = (cue: Cue) => {
    const text = full.slice(cue.line[0], cue.line[1]);
    const quotes = text.match(/“[^”]*”/g);
    if (cue.kind === "pause") return "{pause 2s}";
    if (cue.speaker === "Narrator") {
      const outside = text
        .replace(/@\w+ (\([^)]*\) )?/g, "")
        .replace(/“[^”]*”,?/g, "")
        .trim();
      return outside.replace(/^,?\s*/, "").replace(/\s*@\(\w+\)\s*$/, "");
    }
    if (!quotes) return text.replace(/@\w+ (\([^)]*\) )?/, "");
    // The quote this cue speaks: the one whose words it holds.
    return (
      quotes.find((q) => (cue.direction === "proudly" ? q.includes("practicing") : true)) ??
      quotes[0]
    );
  };

  // The segment player: these lines only.
  let seg: HTMLAudioElement | undefined;
  const segButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-seg-play]")];
  const segRoots = () => [...document.querySelectorAll<HTMLElement>(".audio-panel")];
  let segCue = -1;
  const segTick = () => {
    if (!seg) return;
    const t = seg.currentTime;
    if (t >= SEG_TO) {
      seg.pause();
      seg.currentTime = SEG_FROM;
    }
    const share = Math.max(0, Math.min(1, (t - SEG_FROM) / span));
    let index = -1;
    for (let i = 0; i < cues.length; i++) if ((cues[i]?.start ?? 0) <= t) index = i;
    for (const root of segRoots()) {
      $("[data-playhead]", root).style.transform = `translateX(${(share * 100).toFixed(2)}cqw)`;
      $("[data-audio-clock]", root).textContent =
        `${clock(Math.max(0, t - SEG_FROM))} / ${clock(span)}`;
      for (const bit of root.querySelectorAll<HTMLElement>(".lane-track i"))
        bit.classList.toggle(
          "on",
          Number(bit.dataset.start) <= t && t < Number(bit.dataset.end) + 0.15,
        );
    }
    if (index !== segCue && cues[index]) {
      segCue = index;
      const cue = cues[index] as Cue;
      const who =
        cue.kind === "vocal"
          ? "Gerald, yawning"
          : cue.kind === "pause"
            ? "A pause, two seconds"
            : `${nameOf(mini, cue.speaker === "Narrator" ? null : cue.speaker)}${cue.direction ? `, ${cue.direction}` : ""}`;
      const color = cue.speaker && cue.speaker !== "Narrator" ? colors.get(cue.speaker) : undefined;
      for (const root of segRoots()) {
        $("[data-audio-who]", root).textContent = who;
        $("[data-audio-line]", root).textContent = cue.kind === "vocal" ? "[yawns]" : lineAt(cue);
        if (color) root.style.setProperty("--now", color);
        else root.style.removeProperty("--now");
      }
    }
    if (!seg.paused) requestAnimationFrame(segTick);
  };
  const showSeg = () => {
    const playing = Boolean(seg && !seg.paused);
    for (const button of segButtons) {
      button.classList.toggle("playing", playing);
      $(".seg-label", button).textContent = playing ? "Pause" : "Play these lines";
    }
    for (const root of segRoots()) root.classList.toggle("playing", playing);
  };
  for (const button of segButtons)
    button.addEventListener("click", () => {
      if (!seg) {
        seg = makeAudio(dragonManifest.audio);
        seg.addEventListener("play", () => {
          showSeg();
          requestAnimationFrame(segTick);
        });
        seg.addEventListener("pause", showSeg);
      }
      const audio = seg;
      if (audio.paused) {
        // Play within the click, silent until the audio can be placed at these lines.
        if (audio.readyState >= 1) {
          if (audio.currentTime < SEG_FROM || audio.currentTime >= SEG_TO - 0.1)
            audio.currentTime = SEG_FROM;
        } else {
          audio.muted = true;
          audio.addEventListener(
            "loadedmetadata",
            () => {
              audio.currentTime = SEG_FROM;
              audio.muted = false;
            },
            { once: true },
          );
        }
        audio.play().catch(showSeg);
      } else audio.pause();
    });

  // Which step is in view, and so which layer the stage shows.
  const steps = [...document.querySelectorAll<HTMLElement>(".step")];
  const pills = [...document.querySelectorAll<HTMLElement>("#stage-pills i")];
  const progress = $("#stage-progress");
  const stage = $("#stage");
  const show = (index: number) => {
    stage.dataset.at = String(index);
    for (const layer of stageBody.querySelectorAll<HTMLElement>(".layer"))
      layer.classList.toggle("on", Number(layer.dataset.layer) === index);
    for (const [i, pill] of pills.entries()) pill.classList.toggle("on", i === index);
    for (const [i, step] of steps.entries()) step.classList.toggle("on", i === index);
    progress.style.transform = `scaleX(${(index + 1) / steps.length})`;
  };
  show(0);
  const seen = new Map<Element, number>();
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        seen.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      let best = -1;
      let bestRatio = 0;
      for (const [i, step] of steps.entries()) {
        const ratio = seen.get(step) ?? 0;
        if (ratio > bestRatio) {
          best = i;
          bestRatio = ratio;
        }
      }
      if (best >= 0) show(best);
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.01, 0.5, 1] },
  );
  for (const step of steps) watcher.observe(step);
}

/* ------------------------------------------------------------------ the Writer's picture */

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-look]"))
  button.addEventListener("click", () => {
    const look = button.dataset.look;
    $<HTMLImageElement>("#shot").src = `../../front/writer-${look}.jpg`;
    for (const other of document.querySelectorAll<HTMLButtonElement>("[data-look]"))
      other.setAttribute("aria-pressed", String(other === button));
  });

/* ------------------------------------------------------------------ the clay pictures */

// A picture not there yet (or not at all) simply isn't drawn: never a broken image.
for (const image of document.querySelectorAll<HTMLImageElement>("img[data-clay]")) {
  const ready = () => image.classList.add("loaded");
  const gone = () => image.classList.add("missing");
  if (image.complete) image.naturalWidth ? ready() : gone();
  image.addEventListener("load", ready);
  image.addEventListener("error", gone);
}

/* ------------------------------------------------------------------ motion */

// Things rise into view as they arrive; with reduced motion they are simply there.
{
  const items = document.querySelectorAll<HTMLElement>(".reveal");
  if (calm.matches || !("IntersectionObserver" in window)) {
    for (const item of items) item.classList.add("in");
  } else {
    const rise = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            rise.unobserve(entry.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    for (const item of items) rise.observe(item);
  }
}

// The clay pictures drift a little against the scroll; the header firms up once the page moves.
{
  const header = $("#top");
  const floaters = [...document.querySelectorAll<HTMLElement>(".clay")];
  const darks = [...document.querySelectorAll<HTMLElement>(".dark")];
  let queued = false;
  const update = () => {
    queued = false;
    const y = window.scrollY;
    header.classList.toggle("scrolled", y > 8);
    const mid = header.offsetHeight / 2;
    header.classList.toggle(
      "on-dark",
      darks.some((band) => {
        const box = band.getBoundingClientRect();
        return box.top <= mid && box.bottom >= mid;
      }),
    );
    if (calm.matches) return;
    for (const item of floaters) {
      const box = item.parentElement?.getBoundingClientRect();
      if (!box || box.bottom < -200 || box.top > window.innerHeight + 200) continue;
      const centre = box.top + box.height / 2 - window.innerHeight / 2;
      item.style.setProperty("--drift", `${(centre * -0.06).toFixed(1)}px`);
    }
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
