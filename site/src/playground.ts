/**
 * The playground: write on the left page, see what it becomes on the right. Everything runs in the
 * browser; the story is kept in this browser's local storage and in links you choose to copy.
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Character, scriptEditor, setShowMarks } from "@voxdown/editor";
import {
  characterColors,
  escapeHtml,
  renderBook,
  renderDocument,
  renderScript,
  stylesheet,
} from "@voxdown/render";
import {
  type Story,
  format,
  fromFountain,
  lines,
  linesToCsv,
  parse,
  textByCharacter,
} from "voxdown";
import { examples } from "./examples";
import "./style.css";

type Tab = "script" | "book" | "lines" | "csv" | "sides";
const TABS: readonly Tab[] = ["script", "book", "lines", "csv", "sides"];
const STORAGE = "voxdown-playground";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const rendererStyle = document.createElement("style");
rendererStyle.textContent = stylesheet;
document.head.append(rendererStyle);

const state = {
  story: parse(""),
  name: "story.vxd",
  tab: "script" as Tab,
  colors: new Map<string, string>(),
};

// The left page

const editorHost = $<HTMLElement>("#editor");
const characters = (): readonly Character[] =>
  [...state.colors].map(([handle, color]) => ({
    handle,
    name: state.story.cast.find((member) => member.handle === handle)?.name ?? handle,
    color,
    ...(state.story.cast.some((member) => member.handle === handle) ? {} : { provisional: true }),
  }));

const view = new EditorView({
  parent: editorHost,
  extensions: [
    scriptEditor({ characters }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) schedule();
    }),
    EditorView.contentAttributes.of({ "aria-label": "Story" }),
  ],
});

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(refresh, 120);
}

/** Puts a story on the left page, the cursor where the story starts so the front matter folds. */
function load(text: string, name: string): void {
  state.name = name;
  $<HTMLElement>("#file-name").textContent = name;
  const story = parse(text);
  const start = story.frontMatter ? Math.min(story.frontMatter.range.to + 2, text.length) : 0;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(start),
    scrollIntoView: true,
  });
  view.scrollDOM.scrollTop = 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".example")) {
    button.setAttribute("aria-current", String(button.dataset.name === name));
  }
  refresh();
}

function refresh(): void {
  const text = view.state.doc.toString();
  state.story = parse(text);
  state.colors = characterColors(state.story);
  try {
    localStorage.setItem(STORAGE, JSON.stringify({ name: state.name, text }));
  } catch {
    // Private windows may refuse; the story still works.
  }
  showWarnings(state.story);
  showOutput();
}

function showWarnings(story: Story): void {
  const status = $<HTMLElement>("#status");
  const list = $<HTMLOListElement>("#warnings");
  const problems = story.warnings.filter((warning) => warning.severity === "warning");
  status.className = problems.length ? "status-warn" : "status-ok";
  status.textContent = problems.length
    ? `${problems.length} ${problems.length === 1 ? "warning" : "warnings"}`
    : "No warnings";
  list.replaceChildren(
    ...story.warnings.map((warning) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "warning";
      button.innerHTML = `<span class="where">${warning.line}:${warning.column}</span> ${escapeHtml(warning.message)} <code>${escapeHtml(warning.code)}</code>`;
      button.addEventListener("click", () => {
        view.dispatch({
          selection: EditorSelection.range(warning.range.from, warning.range.to),
          scrollIntoView: true,
        });
        view.focus();
      });
      item.append(button);
      return item;
    }),
  );
  $<HTMLDetailsElement>("#warnings-box").hidden = story.warnings.length === 0;
}

// The right page

function showOutput(): void {
  const sheet = $<HTMLElement>("#output");
  const story = state.story;
  const heard = lines(story);
  const said = heard.filter((line) => line.kind === "speech" || line.kind === "vocal");
  const voices = new Set(said.map((line) => line.speaker));
  $<HTMLElement>("#summary").textContent =
    `${said.length} ${said.length === 1 ? "line" : "lines"} said by ${voices.size} ${voices.size === 1 ? "voice" : "voices"}`;
  const download = $<HTMLButtonElement>("#download-output");
  switch (state.tab) {
    case "script":
      sheet.innerHTML = renderScript(story);
      download.textContent = "Download HTML";
      break;
    case "book":
      sheet.innerHTML = renderBook(story, { pages: true });
      download.textContent = "Download HTML";
      break;
    case "lines":
      sheet.innerHTML = linesTable(story);
      download.textContent = "Download JSON";
      break;
    case "csv":
      sheet.innerHTML = `<pre>${escapeHtml(linesToCsv(lines(story, { speechOnly: true })))}</pre>`;
      download.textContent = "Download CSV";
      break;
    case "sides":
      sheet.innerHTML = sides(story);
      download.textContent = "Download text";
      break;
  }
}

function linesTable(story: Story): string {
  const rows = lines(story).map((line, index) => {
    const color = line.speaker ? state.colors.get(line.speaker) : undefined;
    const who = line.speaker
      ? `<span class="speaker-dot"${color ? ` style="--c: ${color}"` : ""}></span>${escapeHtml(line.speaker)}`
      : `<span class="kind">${escapeHtml(line.kind === "instruction" ? `{${line.name}}` : line.kind)}</span>`;
    const text = line.kind === "vocal" || line.kind === "sound" ? `[${line.text}]` : line.text;
    return `<tr><td class="n">${index + 1}</td><td class="who">${who}</td><td class="direction">${escapeHtml(line.direction ?? "")}</td><td class="text">${escapeHtml(text)}</td><td class="n">${line.scene}</td><td class="n">${escapeHtml(line.page)}</td></tr>`;
  });
  return `<p class="sheet-note">The spoken script as data: what <code>lines()</code> returns, and what <em>Download JSON</em> saves.</p><table><thead><tr><th>#</th><th>Who</th><th>Direction</th><th>Text</th><th>Scene</th><th>Page</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function sides(story: Story): string {
  const parts = [...textByCharacter(story)].map(([name, text]) => {
    const color = state.colors.get(name);
    const full = story.cast.find((member) => member.handle === name)?.name ?? name;
    return `<section class="side"><h3><span class="speaker-dot"${color ? ` style="--c: ${color}"` : ""}></span>${escapeHtml(full)}</h3><pre>${escapeHtml(text)}</pre></section>`;
  });
  return `<p class="sheet-note">What each character says, in order: a performer's sides.</p>${parts.join("")}`;
}

function selectTab(tab: Tab, focus = false): void {
  state.tab = tab;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  showOutput();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  button.addEventListener("click", () => selectTab(button.dataset.tab as Tab));
  button.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(TABS.indexOf(state.tab) + step + TABS.length) % TABS.length] as Tab;
    selectTab(next, true);
    event.preventDefault();
  });
}

// Files in and out

function save(content: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const base = () => state.name.replace(/\.(?:vxd|md|fountain|txt)$/i, "") || "story";

$<HTMLButtonElement>("#download-output").addEventListener("click", () => {
  const story = state.story;
  switch (state.tab) {
    case "script":
    case "book":
      save(
        renderDocument(story, state.tab, { pages: state.tab === "book" }),
        `${base()}.html`,
        "text/html",
      );
      break;
    case "lines":
      save(`${JSON.stringify(lines(story), null, 2)}\n`, `${base()}.json`, "application/json");
      break;
    case "csv":
      save(linesToCsv(lines(story, { speechOnly: true })), `${base()}.csv`, "text/csv");
      break;
    case "sides": {
      const text = [...textByCharacter(story)]
        .map(([name, said]) => `== ${name} ==\n${said}`)
        .join("\n");
      save(text, `${base()}-sides.txt`, "text/plain");
      break;
    }
  }
});

$<HTMLButtonElement>("#download-story").addEventListener("click", () => {
  save(view.state.doc.toString(), `${base()}.vxd`, "text/markdown");
});

$<HTMLButtonElement>("#format").addEventListener("click", () => {
  const before = view.state.doc.toString();
  const curly = $<HTMLInputElement>("#curly").checked;
  const after = format(before, curly ? { quotes: "curly" } : {});
  if (after === before) return;
  // Replace only what changed, so the cursor and the scroll stay put.
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  view.dispatch({ changes: { from: start, to: endBefore, insert: after.slice(start, endAfter) } });
});

$<HTMLInputElement>("#show-marks").addEventListener("change", (event) => {
  view.dispatch({ effects: setShowMarks.of((event.target as HTMLInputElement).checked) });
});

$<HTMLButtonElement>("#new-story").addEventListener("click", () => {
  load(
    [
      "---",
      "voxdown: 1.0",
      "title: A new story",
      "language: en-US",
      "cast:",
      "  Wanda:",
      "---",
      "",
      "# A new story",
      "",
      "@(warmly) Once upon a time, there was a witch called Wanda.",
      "",
      "@Wanda “Hello,” said Wanda. [a cat purrs]",
      "",
    ].join("\n"),
    "new-story.vxd",
  );
  view.focus();
});

const picker = $<HTMLInputElement>("#file-input");
$<HTMLButtonElement>("#open-file").addEventListener("click", () => picker.click());
picker.addEventListener("change", () => {
  const file = picker.files?.[0];
  if (file) void openFile(file);
  picker.value = "";
});

async function openFile(file: File): Promise<void> {
  const text = await file.text();
  if (/\.fountain$/i.test(file.name)) {
    load(fromFountain(text), file.name.replace(/\.fountain$/i, ".vxd"));
  } else {
    load(text, file.name);
  }
}

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  event.preventDefault();
  void openFile(file);
});

// Links: the story in the address itself, compressed. Nothing is sent anywhere.

async function compress(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decompress(encoded: string): Promise<string> {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

$<HTMLButtonElement>("#copy-link").addEventListener("click", async () => {
  const hash = `#story=${await compress(view.state.doc.toString())}`;
  const url = `${location.origin}${location.pathname}${hash}`;
  history.replaceState(null, "", hash);
  const button = $<HTMLButtonElement>("#copy-link");
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Link in the address bar";
  }
  setTimeout(() => {
    button.textContent = "Copy link";
  }, 2000);
});

// The shelf

const shelf = $<HTMLUListElement>("#examples");
for (const example of examples) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "example";
  button.dataset.name = example.name;
  button.innerHTML = `<span class="title">${escapeHtml(example.title)}</span><span class="by">${escapeHtml(example.byline)}</span>`;
  button.addEventListener("click", () => load(example.text, example.name));
  item.append(button);
  shelf.append(item);
}

// Start: a shared link, else the last story, else the first example.

async function start(): Promise<void> {
  const shared = /^#story=([\w-]+)$/.exec(location.hash)?.[1];
  if (shared) {
    try {
      load(await decompress(shared), "shared-story.vxd");
      return;
    } catch {
      // A damaged link: fall through to the last story.
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as {
      name: string;
      text: string;
    } | null;
    if (saved?.text) {
      load(saved.text, saved.name);
      return;
    }
  } catch {
    // Nothing saved.
  }
  const first = examples.find((example) => example.name.startsWith("the-dragon")) ?? examples[0];
  if (first) load(first.text, first.name);
}

selectTab("script");
void start();
