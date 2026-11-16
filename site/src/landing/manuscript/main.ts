/**
 * The Manuscript landing page: a passage marked in red pencil that sets into VoxDown, the same
 * passage as a book page, a script and voices, and the recorded dragon scene read along on a book
 * page. The recordings and their cue timings are the Listen page's; each loads only when played.
 */
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/recursive/full.css";
import "./manuscript.css";
import { escapeHtml } from "@voxdown/render";
import { type Story, characterColors, parse, tokens } from "voxdown";
import { examples } from "../../examples";

document.documentElement.classList.add("js");

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
const ASSETS = "../../landing/manuscript/";

/* ───────────────────────── The images, each optional ───────────────────────── */

// The red pencil: drawn in SVG until (and unless) the hand-drawn image arrives.
for (const name of ["circle", "arrow", "underline", "bracket"]) {
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const root = document.documentElement;
    root.style.setProperty(`--pen-${name}`, `url("${ASSETS}pencil-${name}.webp")`);
    root.classList.add(`has-pen-${name}`);
  };
  image.src = `${ASSETS}pencil-${name}.webp`;
}
// The pen and the owl: shown when they load, gone without a trace when they don't.
for (const img of document.querySelectorAll<HTMLImageElement>("img[data-optional]")) {
  const ready = () => img.classList.add("loaded");
  const gone = () => img.remove();
  if (img.complete) img.naturalWidth ? ready() : img.getAttribute("loading") === "lazy" || gone();
  img.addEventListener("load", ready);
  img.addEventListener("error", gone);
}

/* ───────────────────────── VoxDown, coloured and printed ───────────────────────── */

/** The narrator's handle, and each speech's words by speaker (the Writer tints them). */
function saidRanges(story: Story): Array<{ from: number; to: number; speaker: string }> {
  const out: Array<{ from: number; to: number; speaker: string }> = [];
  for (const block of story.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines)
      for (const item of line.items) {
        if (item.kind !== "speech" || item.speaker === story.meta.narrator) continue;
        const range = ("textRange" in item && item.textRange) || item.range;
        out.push({ from: range.from, to: range.to, speaker: item.speaker });
      }
  }
  return out;
}

/** The text as written, each mark coloured as the Writer colours it. */
function marked(story: Story, from: number, to: number, colors: Map<string, string>): string {
  const source = story.source;
  const said = saidRanges(story);
  const plain = (a: number, b: number) => {
    let html = "";
    let at = a;
    for (const range of said) {
      if (range.to <= at || range.from >= b) continue;
      const start = Math.max(range.from, at);
      const end = Math.min(range.to, b);
      html += escapeHtml(source.slice(at, start));
      html += `<span class="t-said" style="--c: ${colors.get(range.speaker) ?? "#2563eb"}">${escapeHtml(source.slice(start, end))}</span>`;
      at = end;
    }
    return html + escapeHtml(source.slice(at, b));
  };
  let html = "";
  let at = from;
  for (const token of tokens(story)) {
    if (token.range.from < at || token.range.to > to) continue;
    html += plain(at, token.range.from);
    const color = token.speaker ? colors.get(token.speaker) : undefined;
    html += `<span class="t-${token.kind}"${color ? ` style="--c: ${color}"` : ""}>${escapeHtml(source.slice(token.range.from, token.range.to))}</span>`;
    at = token.range.to;
  }
  return html + plain(at, to);
}

/** What the book prints of a stretch of the text: the marks gone, stress in italics. */
const UNPRINTED = new Set([
  "mark",
  "name",
  "direction",
  "sound",
  "vocal",
  "instruction",
  "note",
  "comment",
  "group",
  "heading",
  "frontmatter",
  "break",
]);
function printed(story: Story, from: number, to: number): string {
  const source = story.source;
  let text = "";
  let at = from;
  for (const token of tokens(story)) {
    if (token.range.from < at || token.range.to > to) continue;
    text += source.slice(at, token.range.from);
    if (!UNPRINTED.has(token.kind)) text += source.slice(token.range.from, token.range.to);
    at = token.range.to;
  }
  text += source.slice(at, to);
  text = text
    .replace(/\\(.)/g, "$1")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return escapeHtml(text).replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/** The story's name for someone: the cast's, and the narrator plainly. */
function nameIn(story: Story, speaker: string | null | undefined): string {
  if (!speaker || speaker === story.meta.narrator) return "The narrator";
  return story.cast.find((member) => member.handle === speaker)?.name ?? speaker;
}

/** Each paragraph line of a story, by where it starts. */
function linesOf(story: Story) {
  return story.blocks.flatMap((block) => (block.kind === "paragraph" ? block.lines : []));
}

/* ───────────────────────── The recordings ───────────────────────── */

type Cue = {
  kind: string;
  speaker: string | null;
  direction: string | null;
  start: number;
  line: [number, number];
};
type Manifest = { audio: string; duration: number; cues: Cue[] };
const recordings = import.meta.glob<Manifest>("../../recordings/*.json", {
  eager: true,
  import: "default",
});
const scenes = examples
  .map((example) => ({
    example,
    slug: example.name.replace(/\.vxd$/, ""),
    manifest: recordings[`../../recordings/${example.name.replace(/\.vxd$/, "")}.json`],
  }))
  .filter(
    (scene): scene is { example: (typeof examples)[number]; slug: string; manifest: Manifest } =>
      Boolean(scene.manifest),
  )
  .sort((a, b) => Number(b.slug.includes("dragon")) - Number(a.slug.includes("dragon")));
const dragon = scenes[0];
if (!dragon) throw new Error("No recorded dragon");

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The cue being heard at a moment, or -1 before the first. */
function cueAt(cues: Cue[], seconds: number): number {
  let cue = -1;
  for (let i = 0; i < cues.length; i++) {
    if ((cues[i]?.start ?? 0) <= seconds) cue = i;
    else break;
  }
  return cue;
}

/** One recording plays at a time, for the passage or for the read-along. */
type Owner = "passage" | "reader";
const player = {
  audio: undefined as HTMLAudioElement | undefined,
  file: "",
  owner: "reader" as Owner,
  stopAt: Number.POSITIVE_INFINITY,
};
const isPlaying = () => Boolean(player.audio && !player.audio.paused && !player.audio.ended);

/* ───────────────────────── The little player that follows you ───────────────────────── */

const mini = $("#mini");
const miniNow = $<HTMLAnchorElement>("#mini-now");
const miniPlay = $<HTMLButtonElement>("#mini-play");
const inView = { reader: false, passage: false };
{
  const watch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target.classList.contains("reader-body")) inView.reader = entry.isIntersecting;
      else inView.passage = entry.isIntersecting;
    }
    updateMini();
  });
  watch.observe($(".reader-body"));
  watch.observe($(".voices-page"));
}
function miniText(text: string): void {
  if (text && miniNow.dataset.text !== text) {
    miniNow.dataset.text = text;
    miniNow.innerHTML = `<span class="mini-k">Now</span> ${escapeHtml(text)}`;
  }
}
function updateMini(): void {
  const playing = isPlaying();
  const visible = player.owner === "reader" ? inView.reader : inView.passage;
  const show = playing && !visible;
  mini.hidden = !show;
  miniNow.href = player.owner === "reader" ? "#read-along" : "#marks";
  miniPlay.classList.toggle("playing", playing);
}
miniPlay.addEventListener("click", () => player.audio?.pause());

function audioFor(file: string, owner: Owner): HTMLAudioElement {
  if (!player.audio || player.file !== file) {
    player.audio?.pause();
    const audio = new Audio(`../../listen/${file}`);
    audio.preload = "auto";
    audio.addEventListener("play", () => {
      refresh();
      requestAnimationFrame(frame);
    });
    audio.addEventListener("pause", refresh);
    audio.addEventListener("ended", refresh);
    player.audio = audio;
    player.file = file;
  }
  if (player.owner !== owner) {
    player.audio.pause();
    player.owner = owner;
    passageTick(-1);
  }
  return player.audio;
}

function frame(): void {
  const audio = player.audio;
  if (!audio) return;
  if (player.owner === "passage" && audio.currentTime >= player.stopAt) {
    audio.pause();
    passageTick(-1);
    return;
  }
  if (player.owner === "passage") passageTick(audio.currentTime);
  else readerTick(audio.currentTime);
  if (!audio.paused && !audio.ended) requestAnimationFrame(frame);
}

/* ───────────────────────── I. The marks: the passage ───────────────────────── */

const story = parse(dragon.example.text);
const colors = characterColors(story);
const source = story.source;
const passageFrom = source.indexOf("@(warmly)");
const passageTo = source.indexOf("\n", source.indexOf("“Most of them.”"));
// The passage's paragraphs, each a line of the source.
const passageLines: Array<[number, number]> = [];
{
  let at = passageFrom;
  for (const text of source.slice(passageFrom, passageTo).split("\n")) {
    if (text.trim()) passageLines.push([at, at + text.length]);
    at += text.length + 1;
  }
}

// The set: the passage as written.
$("#set").innerHTML = passageLines
  .map(([from, to]) => `<span class="set-p">${marked(story, from, to, colors)}</span>`)
  .join("\n\n");

// The book page.
$("#form-book").innerHTML = `<p class="bp-head">The Dragon Who Would Not Roar</p>${passageLines
  .map(([from, to], i) => {
    const html = printed(story, from, to);
    return i === 0
      ? `<p class="bp first"><span class="drop">${html.slice(0, 1)}</span>${html.slice(1)}</p>`
      : `<p class="bp">${html}</p>`;
  })
  .join("")}<p class="bp-folio">1</p>`;

// The script: each line with its speaker and how it's said, the sounds as cues.
{
  const lines = linesOf(story);
  let html = "";
  for (const [from, to] of passageLines) {
    const line = lines.find((each) => each.range.from === from);
    const items = line?.items ?? [];
    const speech = items.find(
      (item) => item.kind === "speech" && item.speaker !== story.meta.narrator,
    );
    const lead = items.find((item) => item.kind === "speech");
    const who = speech && speech.kind === "speech" ? speech.speaker : undefined;
    const how =
      (speech && speech.kind === "speech" && speech.direction) ||
      (lead && lead.kind === "speech" && lead.direction) ||
      "";
    const sounds = items
      .filter((item) => item.kind === "sound")
      .map(
        (item) =>
          `<span class="sp-sound">${escapeHtml(source.slice(item.range.from + 1, item.range.to - 1))}</span>`,
      )
      .join(" ");
    html += `<div class="sp-line">${
      who
        ? `<p class="sp-who" style="--c: ${colors.get(who)}">${escapeHtml(nameIn(story, who))}</p>`
        : `<p class="sp-who narr">Narrator</p>`
    }<p class="sp-text">${how ? `<i class="sp-how">${escapeHtml(how)}</i> ` : ""}${printed(story, from, to)}${sounds ? ` ${sounds}` : ""}</p></div>`;
  }
  $("#form-script").innerHTML = html;
}

// The voices: the cast from the story's front matter.
{
  const cast = $("#form-cast");
  for (const member of story.cast) {
    const li = document.createElement("li");
    li.dataset.speaker = member.handle;
    const color = colors.get(member.handle);
    if (color) li.style.setProperty("--c", color);
    li.innerHTML = `<span class="cast-dot" aria-hidden="true"></span><span class="cast-name">${escapeHtml(member.name)}</span><span class="cast-about">${escapeHtml(member.about ?? "")}</span>`;
    cast.append(li);
  }
}

// The passage's own stretch of the recording: from its first line to the page turn after it.
const passageCues = dragon.manifest.cues;
const passageStart = passageCues.find((cue) => cue.line[0] >= passageFrom)?.start ?? 0;
const passageEnd =
  passageCues.find((cue) => cue.line[0] > passageTo)?.start ?? dragon.manifest.duration;
const passageButton = $<HTMLButtonElement>("#passage-play");
const passageNow = $("#passage-now");
const PASSAGE_IDLE = "Voiced with ElevenLabs from this text, marks and all.";

function passageTick(seconds: number): void {
  const cue = seconds < 0 ? undefined : passageCues[cueAt(passageCues, seconds)];
  for (const li of document.querySelectorAll<HTMLElement>("#form-cast li"))
    li.classList.toggle(
      "speaking",
      Boolean(
        cue &&
          (cue.kind === "speech" || cue.kind === "vocal") &&
          li.dataset.speaker === cue.speaker,
      ),
    );
  const text = !cue
    ? PASSAGE_IDLE
    : cue.kind === "sound"
      ? "A sound: armor squeaking"
      : `${nameIn(story, cue.speaker)}${cue.direction ? `, ${cue.direction}` : ""}`;
  if (passageNow.textContent !== text) passageNow.textContent = text;
  miniText(seconds < 0 ? "" : text);
}

passageButton.addEventListener("click", () => {
  const audio = audioFor(dragon.manifest.audio, "passage");
  if (isPlaying()) {
    audio.pause();
    return;
  }
  player.stopAt = passageEnd;
  if (audio.currentTime < passageStart || audio.currentTime >= passageEnd - 0.2)
    audio.currentTime = passageStart;
  audio.play().catch(refresh);
});

/* ───────────────────────── I. The marks: the steps ───────────────────────── */

const craft = $("#craft");
const steps = [...document.querySelectorAll<HTMLElement>(".step")];
const progress = $("#progress");
let ticking = false;
function onScroll(): void {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    // The step whose top has passed the reading line.
    const line = window.innerHeight * (window.innerWidth < 800 ? 0.78 : 0.55);
    let step = 0;
    for (const each of steps)
      if (each.getBoundingClientRect().top < line) step = Number(each.dataset.step);
    if (craft.dataset.step !== String(step)) craft.dataset.step = String(step);
    for (const each of steps) each.classList.toggle("current", Number(each.dataset.step) === step);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
  });
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
onScroll();

/* ───────────────────────── Reveals ───────────────────────── */

{
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          seen.unobserve(entry.target);
        }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
  );
  for (const each of document.querySelectorAll(".reveal, .chapter-head, .galley"))
    seen.observe(each);
}

/* ───────────────────────── II. Read along ───────────────────────── */

const reader = {
  index: 0,
  story: parse(""),
  colors: new Map<string, string>(),
  rows: [] as Array<{ from: number; element: HTMLElement }>,
  current: -1,
  row: -1,
  view: "print" as "print" | "marks",
};
const readerText = $("#reader-text");
const readerScroll = $("#reader-scroll");
const readerMark = $("#reader-mark");
const readerPlay = $<HTMLButtonElement>("#reader-play");
const readerWho = $("#reader-who");
const readerHow = $("#reader-how");
const readerFill = $("#reader-fill");
const readerTrack = $("#reader-track");
const readerTime = $("#reader-time");
const readerDur = $("#reader-dur");
const heroPlay = $<HTMLButtonElement>("#hero-play");

function showScene(index: number): void {
  const scene = scenes[index];
  if (!scene) return;
  if (player.owner === "reader") player.audio?.pause();
  reader.index = index;
  reader.current = -1;
  reader.row = -1;
  reader.story = parse(scene.example.text);
  reader.colors = characterColors(reader.story);
  const src = reader.story.source;
  const heading = reader.story.blocks.find((block) => block.kind === "heading");
  const start = heading?.range.from ?? 0;
  const lines = linesOf(reader.story);
  readerText.replaceChildren();
  reader.rows = [];
  let at = start;
  let grouped = false;
  for (const text of src.slice(start).split("\n")) {
    const from = at;
    at += text.length + 1;
    if (!text.trim()) continue;
    const row = document.createElement("p");
    row.className = "rr";
    const book = printed(reader.story, from, from + text.length);
    const fence = /^\s*:::/.test(text);
    if (/^#\s/.test(text)) row.classList.add("rr-title");
    else if (/^#{2,}\s/.test(text)) row.classList.add("rr-heading");
    if (/^\{page\}\s*$/.test(text)) row.classList.add("rr-page");
    if (/^\{book only\}/.test(text)) row.classList.add("rr-bookonly");
    if (
      fence ||
      (!book && !/^\{page\}/.test(text)) ||
      /\{hidden\}/.test(text) ||
      /^\{audio only\}/.test(text)
    )
      row.classList.add("only-marks");
    if (grouped && !fence) row.classList.add("rr-group");
    if (fence) grouped = !grouped;
    const speaker = lines
      .find((line) => line.range.from === from)
      ?.items.find((item) => item.kind === "speech" && item.speaker !== reader.story.meta.narrator);
    const color =
      speaker && speaker.kind === "speech" ? reader.colors.get(speaker.speaker) : undefined;
    if (color) row.style.setProperty("--c", color);
    row.innerHTML = `<span class="pv">${/^\{page\}/.test(text) ? "❦" : book}</span><span class="mv">${marked(reader.story, from, from + text.length, reader.colors)}</span>`;
    readerText.append(row);
    reader.rows.push({ from, element: row });
  }
  readerScroll.scrollTop = 0;
  readerMark.classList.remove("on");
  for (const [i, button] of document.querySelectorAll<HTMLButtonElement>(".scene-tab").entries()) {
    button.setAttribute("aria-selected", String(i === index));
    button.tabIndex = i === index ? 0 : -1;
  }
  $("#reader-head").textContent = scene.example.title;
  $<HTMLAnchorElement>("#reader-open").href = `../../writer/#example=${scene.slug}`;
  readerDur.textContent = clock(scene.manifest.duration);
  readerTime.textContent = "0:00";
  readerFill.style.transform = "scaleX(0)";
  readerTrack.setAttribute("aria-valuenow", "0");
  readerTrack.setAttribute("aria-valuetext", "0:00");
  readerWho.textContent = "Ready when you are.";
  readerWho.style.removeProperty("--c");
  readerHow.textContent = "Press play; the page follows the voices.";
  // The cast, by name and colour.
  $("#reader-cast").innerHTML = reader.story.cast
    .map(
      (member) =>
        `<span class="rc" style="--c: ${reader.colors.get(member.handle) ?? "var(--ink-3)"}">${escapeHtml(member.name)}</span>`,
    )
    .join("");
  refresh();
}

function readerTick(seconds: number): void {
  const scene = scenes[reader.index];
  if (!scene) return;
  const { cues, duration } = scene.manifest;
  const cue = cueAt(cues, seconds);
  const share = Math.min(1, seconds / duration);
  readerFill.style.transform = `scaleX(${share})`;
  readerTrack.setAttribute("aria-valuenow", String(Math.round(share * 100)));
  readerTrack.setAttribute("aria-valuetext", clock(seconds));
  readerTime.textContent = clock(seconds);
  const heard = cues[cue];
  if (heard && cue !== reader.current) {
    reader.current = cue;
    const speaking = heard.kind === "speech" || heard.kind === "vocal";
    const who = speaking
      ? nameIn(reader.story, heard.speaker)
      : heard.kind === "sound"
        ? "A sound"
        : heard.kind === "pause"
          ? "A pause"
          : "A page turns";
    readerWho.textContent = who;
    const color = speaking && heard.speaker ? reader.colors.get(heard.speaker) : undefined;
    if (color) readerWho.style.setProperty("--c", color);
    else readerWho.style.removeProperty("--c");
    const how = heard.direction ?? "";
    readerHow.textContent = how;
    miniText(`${who}${how ? `, ${how}` : ""}`);
  }
  // The row the heard part is on, or the nearest one shown before it.
  let row = -1;
  if (heard) for (const [i, each] of reader.rows.entries()) if (each.from <= heard.line[0]) row = i;
  while (row > 0 && hidden(row)) row--;
  if (row !== reader.row) {
    reader.row = row;
    for (const [i, each] of reader.rows.entries())
      each.element.classList.toggle("heard", i === row);
    placeMark();
  }
}

const hidden = (row: number) =>
  reader.view === "print" && Boolean(reader.rows[row]?.element.classList.contains("only-marks"));

/** The red bracket beside the line being heard, and the page scrolled to it. */
function placeMark(): void {
  const lit = reader.rows[reader.row]?.element;
  if (!lit) {
    readerMark.classList.remove("on");
    return;
  }
  readerMark.classList.add("on");
  readerMark.style.height = `${lit.offsetHeight + 8}px`;
  readerMark.style.transform = `translateY(${lit.offsetTop - 4}px)`;
  const target = lit.offsetTop - readerScroll.clientHeight * 0.38;
  if (Math.abs(readerScroll.scrollTop - target) > 4)
    readerScroll.scrollTo({ top: target, behavior: calm.matches ? "auto" : "smooth" });
}

function toggleReader(): void {
  const scene = scenes[reader.index];
  if (!scene) return;
  const audio = audioFor(scene.manifest.audio, "reader");
  player.stopAt = Number.POSITIVE_INFINITY;
  if (audio.paused || audio.ended) {
    if (audio.ended) audio.currentTime = 0;
    audio.play().catch(refresh);
  } else audio.pause();
}

function seek(share: number): void {
  const scene = scenes[reader.index];
  if (!scene) return;
  const audio = audioFor(scene.manifest.audio, "reader");
  audio.currentTime = Math.max(0, Math.min(1, share)) * scene.manifest.duration;
  readerTick(audio.currentTime);
}

/** Every play button, as the recording stands. */
function refresh(): void {
  const playing = isPlaying();
  const scene = scenes[reader.index];
  const readerOn = playing && player.owner === "reader" && player.file === scene?.manifest.audio;
  const passageOn = playing && player.owner === "passage";
  readerPlay.classList.toggle("playing", readerOn);
  readerPlay.setAttribute("aria-label", readerOn ? "Pause the scene" : "Play the scene");
  readerText.classList.toggle("playing", readerOn);
  const heroOn = readerOn && reader.index === 0;
  heroPlay.classList.toggle("playing", heroOn);
  $(".listen-label").textContent = heroOn ? "Pause the dragon scene" : "Hear the dragon scene";
  passageButton.classList.toggle("playing", passageOn);
  $(".passage-label").textContent = passageOn ? "Pause" : "Hear these lines";
  if (!passageOn && player.owner === "passage" && !playing) passageTick(-1);
  updateMini();
}

// The scene tabs, by title, with arrow keys between them.
{
  const pick = $("#scene-pick");
  for (const [index, scene] of scenes.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "reader-scroll");
    button.textContent = scene.example.title;
    button.addEventListener("click", () => showScene(index));
    button.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = (reader.index + step + scenes.length) % scenes.length;
      showScene(next);
      pick.querySelectorAll<HTMLButtonElement>(".scene-tab")[next]?.focus();
    });
    pick.append(button);
  }
}
readerPlay.addEventListener("click", toggleReader);
heroPlay.addEventListener("click", () => {
  const wasPlaying = isPlaying() && player.owner === "reader" && reader.index === 0;
  if (reader.index !== 0) showScene(0);
  toggleReader();
  if (!wasPlaying)
    $("#read-along").scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "start" });
});
readerTrack.addEventListener("click", (event) => {
  const box = readerTrack.getBoundingClientRect();
  seek((event.clientX - box.left) / box.width);
});
readerTrack.addEventListener("keydown", (event) => {
  const scene = scenes[reader.index];
  if (!scene) return;
  const now = player.owner === "reader" ? (player.audio?.currentTime ?? 0) : 0;
  const step =
    event.key === "ArrowRight" || event.key === "ArrowUp"
      ? 5
      : event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -5
        : 0;
  if (event.key === "Home") seek(0);
  else if (event.key === "End") seek(0.999);
  else if (!step) return;
  else seek((now + step) / scene.manifest.duration);
  event.preventDefault();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(".view-pick button"))
  button.addEventListener("click", () => {
    reader.view = button.dataset.view === "marks" ? "marks" : "print";
    for (const each of document.querySelectorAll<HTMLButtonElement>(".view-pick button"))
      each.setAttribute("aria-checked", String(each === button));
    readerText.classList.toggle("as-print", reader.view === "print");
    readerText.classList.toggle("as-marks", reader.view === "marks");
    reader.row = -1;
    if (player.owner === "reader" && player.audio) readerTick(player.audio.currentTime);
  });
showScene(0);

/* ───────────────────────── Space and resize ───────────────────────── */

window.addEventListener("resize", () => {
  if (reader.row >= 0) placeMark();
});
