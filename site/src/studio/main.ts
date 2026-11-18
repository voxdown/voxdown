import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import { mountBackup } from "./backup";
import type { FountainDocument } from "./fountain";
import type { ScreenplayLayout } from "./layout";
import { mountLibrary } from "./library";
import { adjacentScene, filterOutline, itemAtLine, outlineOf, pageAtSource } from "./navigation";
import { mountPalette } from "./palette";
import { type StudioPreferences, readPreferences, savePreferences } from "./preferences";
import { ScreenplayScheduler, type WorkerResult, isSupersededRequest } from "./scheduler";
import { MAX_LINES, MAX_SOURCE, fountainName, readSource, writeSource } from "./source";
import { type StudioDraft, getDraft, keepDraft, listDrafts } from "./storage";
import { rememberParsedSource } from "./syntax";
import { type WritingMark, smartPairs, toggleWritingMark } from "./typing";
import { mountWorkbench } from "./workbench";
import { insertScreenplayParagraph, screenplayCompletions, setScreenplayLine } from "./writing";
import "./studio.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $("app");
function setWorkspaceLocked(locked: boolean): void {
  app.inert = locked;
  const header = document.querySelector<HTMLElement>(".app-header");
  if (header) header.inert = locked;
}
const name = $<HTMLInputElement>("name");
const margins = $<HTMLInputElement>("margins");
const pdfButton = $<HTMLButtonElement>("pdf");
const paper = $<HTMLSelectElement>("paper");
const preview = $("preview");
const page = $("page");
const pairs = $<HTMLInputElement>("smart-pairs");
const pairConfiguration = new Compartment();
try {
  pairs.checked = localStorage.getItem("studio-smart-pairs") !== "off";
} catch {}
const preferences = readPreferences();
const scheduler = new ScreenplayScheduler(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);
const marks = StateEffect.define<DecorationSet>();
const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(marks)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

type Result = WorkerResult;
let source = readSource("");
let draftId = crypto.randomUUID();
let revision = 0;
let keptRevision = -1;
let lastDownload = "";
let hasWork = false;
let latest: Result | undefined;
let parsedDocument: FountainDocument | undefined;
let outlineItems: ReturnType<typeof outlineOf> = [];
let activeOutline: HTMLButtonElement | undefined;
const outlineButtons = new Map<number, HTMLButtonElement>();
let parseGeneration = 0;
let previewPage = 0;
let saving: ReturnType<typeof setTimeout> | undefined;
let parsing: ReturnType<typeof setTimeout> | undefined;
let recovering = true;
let exporting = false;
let replacing = false;
let fileGeneration = 0;
const editorExtensions: Extension = [
  history(),
  search(),
  autocompletion({
    override: [screenplayCompletions(() => parsedDocument)],
    maxRenderedOptions: 10,
  }),
  EditorView.lineWrapping,
  highlightActiveLine(),
  markField,
  placeholder("INT. SOMEWHERE - DAY\n\nStart a scene, or open a Fountain screenplay."),
  EditorView.contentAttributes.of({
    "aria-label": "Fountain screenplay",
    tabindex: "0",
    spellcheck: "true",
    autocapitalize: "off",
    autocorrect: "off",
  }),
  EditorState.transactionFilter.of((tr) => {
    if (tr.newDoc.length > MAX_SOURCE || tr.newDoc.lines > MAX_LINES) {
      notice(
        "This draft has reached the 500,000-character or 20,000-line limit. Download it and continue in a new file.",
      );
      return [];
    }
    return tr;
  }),
  keymap.of([
    { key: "Alt-PageUp", run: () => moveScene(-1) },
    { key: "Alt-PageDown", run: () => moveScene(1) },
    { key: "Mod-Enter", run: insertScreenplayParagraph },
    { key: "Ctrl-Space", run: startCompletion },
    { key: "Mod-b", run: () => format("bold") },
    { key: "Mod-i", run: () => format("italic") },
    { key: "Mod-u", run: () => format("underline") },
    { key: "Mod-Shift-m", run: () => format("note") },
    {
      key: "Mod-s",
      run: () => {
        downloadSource();
        return true;
      },
    },
    ...defaultKeymap,
    ...historyKeymap,
    ...searchKeymap,
  ]),
  EditorView.updateListener.of((update) => {
    if (update.docChanged && !recovering) {
      revision++;
      hasWork = true;
      keptRevision = -1;
      $("recovery").textContent = "Keeping this draft…";
      clearTimeout(saving);
      saving = setTimeout(() => void persist(), 350);
      scheduleParse();
    }
    if (update.selectionSet || update.docChanged) {
      const line = update.state.doc.lineAt(update.state.selection.main.head).number;
      $("position").textContent = `Line ${line}`;
      updateCurrentScene(line);
      if (preferences.typewriter && update.docChanged && !view.compositionStarted) {
        requestAnimationFrame(() => {
          if (preferences.typewriter)
            view.dispatch({
              effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
            });
        });
      }
    }
  }),
];
const view = new EditorView({
  parent: $("editor"),
  state: editingState(),
});

document.querySelector<HTMLAnchorElement>(".skip")?.addEventListener("click", (event) => {
  event.preventDefault();
  view.focus();
});
const workbench = mountWorkbench(document.body, jumpToLine);
$("workbench").addEventListener("click", () => workbench.open());
const backup = mountBackup(document.body, {
  current: () => ({ name: title(), source: text(), draftId }),
  replace: async (value, fileName) => {
    if (!(await mayReplace())) return false;
    showSource(value, fileName);
    return true;
  },
  download,
  notice,
});
const palette = mountPalette(document.body, [
  {
    label: "Toggle live margins",
    run: () => {
      margins.checked = !margins.checked;
      margins.dispatchEvent(new Event("change"));
    },
  },
  ...(
    [
      ["Use A4 paper", "a4"],
      ["Use US Letter paper", "letter"],
    ] as const
  ).map(([label, value]) => ({
    label,
    run: () => {
      paper.value = value;
      paper.dispatchEvent(new Event("change"));
    },
  })),
  { label: "Portable backup and restore", run: () => backup.open() },
  ...[
    ["New screenplay", "new"],
    ["Open Fountain file", "open"],
    ["Download Fountain", "download"],
    ["Export PDF", "pdf"],
    ["Recovery and snapshots", "recent"],
    ["Focus writing", "focus-mode"],
    ["Preferences", "preferences"],
    ["Fountain guide", "help"],
    ["Show caret on page", "caret-page"],
    ["Go to preview source", "page-source"],
  ].map(([label, id]) => ({
    label: label ?? "",
    run: () => $(id ?? "").click(),
    enabled: () => !$<HTMLButtonElement>(id ?? "").disabled,
  })),
  ...[
    ["Writing statistics", "statistics"],
    ["Character dialogue", "characters"],
    ["Private notes", "notes"],
    ["Source diagnostics", "diagnostics"],
  ].map(([label, section]) => ({ label: label ?? "", run: () => workbench.open(section) })),
  {
    label: "Previous scene",
    shortcut: "Alt PageUp",
    run: () => {
      moveScene(-1);
    },
  },
  {
    label: "Next scene",
    shortcut: "Alt PageDown",
    run: () => {
      moveScene(1);
    },
  },
]);
$("commands").addEventListener("click", () => palette.open());
document.addEventListener("keydown", (event) => {
  if (recovering || replacing) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "k" &&
    !event.isComposing &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    palette.open();
  }
});

function editingState(doc = ""): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      pairConfiguration.of(
        pairs.checked
          ? smartPairs(() =>
              notice(
                "Bracket wrapping cannot cross a private comment. Select ordinary text or turn pairing off in Preferences.",
              ),
            )
          : [],
      ),
      editorExtensions,
    ],
  });
}

function applyPreferences(): void {
  document.documentElement.dataset.theme = preferences.theme;
  if (preferences.focus) app.classList.remove("mobile-preview", "outline-open");
  document.documentElement.style.setProperty("--editor-size", `${preferences.textSize}px`);
  app.classList.toggle("focus-writing", preferences.focus);
  $("focus-mode").setAttribute("aria-pressed", String(preferences.focus));
  $<HTMLSelectElement>("theme").value = preferences.theme;
  $<HTMLSelectElement>("text-size").value = String(preferences.textSize);
  $<HTMLInputElement>("typewriter").checked = preferences.typewriter;
  updatePreviewToggle();
  view.requestMeasure();
}
function keepPreferences(): void {
  applyPreferences();
  if (!savePreferences(preferences))
    notice("Preferences apply for this session; browser storage is unavailable.");
}
$("focus-mode").addEventListener("click", () => {
  preferences.focus = !preferences.focus;
  keepPreferences();
});
$("preferences").addEventListener("click", () =>
  $<HTMLDialogElement>("preferences-dialog").showModal(),
);
$("theme").addEventListener("change", () => {
  preferences.theme = $<HTMLSelectElement>("theme").value as StudioPreferences["theme"];
  keepPreferences();
});
$("text-size").addEventListener("change", () => {
  preferences.textSize = Number(
    $<HTMLSelectElement>("text-size").value,
  ) as StudioPreferences["textSize"];
  keepPreferences();
});
$("typewriter").addEventListener("change", () => {
  preferences.typewriter = $<HTMLInputElement>("typewriter").checked;
  keepPreferences();
});
applyPreferences();

function format(mark: WritingMark): boolean {
  if (view.compositionStarted) return false;
  if (
    mark !== "note" &&
    view.state.selection.ranges.some((range) =>
      view.state.sliceDoc(range.from, range.to).includes("\n"),
    )
  ) {
    notice(
      "Fountain emphasis belongs within one source line. Select the words on one line to format them.",
    );
    view.focus();
    return true;
  }
  if (
    mark === "note" &&
    view.state.selection.ranges.some((range) =>
      /\n[ \t]?\n/.test(view.state.sliceDoc(range.from, range.to)),
    )
  ) {
    notice(
      "A note cannot cross an empty paragraph. Select one paragraph, or use /* … */ to omit several.",
    );
    view.focus();
    return true;
  }
  const handled = toggleWritingMark(mark)(view);
  if (!handled && mark !== "note")
    notice(
      "Select a single text span outside private comments to change its emphasis. Private comments and mixed formatting have been kept unchanged.",
    );
  if (!handled && mark === "note")
    notice(
      "Select text outside an existing note, or select one complete note to remove its brackets. Notes cannot be nested.",
    );
  view.focus();
  return handled;
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-writing-mark]")) {
  button.addEventListener("click", () => format(button.dataset.writingMark as WritingMark));
}
pairs.addEventListener("change", () => {
  view.dispatch({
    effects: pairConfiguration.reconfigure(
      pairs.checked
        ? smartPairs(() =>
            notice(
              "Bracket wrapping cannot cross a private comment. Select ordinary text or turn pairing off in Preferences.",
            ),
          )
        : [],
    ),
  });
  try {
    localStorage.setItem("studio-smart-pairs", pairs.checked ? "on" : "off");
  } catch {}
});
$("element-action").addEventListener("change", () => {
  const select = $<HTMLSelectElement>("element-action");
  const type = select.value as "scene" | "action" | "character" | "parenthetical" | "transition";
  if (type && !setScreenplayLine(type)(view)) {
    notice(
      "Place the caret on one ordinary source line to change its element. Notes, title fields, and outline markers are kept intact.",
    );
  }
  select.value = "";
  view.focus();
});

function notice(message: string): void {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
function text(): string {
  return writeSource(source, view.state.doc.toString());
}
function title(): string {
  return fountainName(name.value);
}
function download(bytes: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function downloadSource(): void {
  const value = text();
  download(value, title(), "text/plain;charset=utf-8");
  lastDownload = value;
  notice(
    "Fountain download started. Keep the downloaded file as an independent copy of your screenplay.",
  );
}
async function persist(): Promise<boolean> {
  if (!hasWork) return true;
  const captured = revision;
  const id = draftId;
  const draft: StudioDraft = { id, name: title(), source: text(), updated: Date.now() };
  try {
    await keepDraft(draft);
    if (draftId === id && revision === captured) {
      keptRevision = captured;
      $("recovery").textContent = "Draft kept in this browser";
      try {
        sessionStorage.setItem("studio-recovery-id", id);
      } catch {}
    }
    return true;
  } catch {
    $("recovery").textContent = "Recovery unavailable — download your Fountain file";
    return false;
  }
}
async function mayReplace(): Promise<boolean> {
  if (replacing || recovering) return false;
  replacing = true;
  setWorkspaceLocked(true);
  try {
    if (await persist()) return true;
    return (
      text() === lastDownload ||
      window.confirm(
        "Browser recovery is unavailable. Replacing this draft may lose your changes. Cancel to download it first, or OK to replace it.",
      )
    );
  } finally {
    setWorkspaceLocked(false);
    replacing = false;
  }
}

function showSource(value: string, fileName: string): void {
  const next = readSource(value);
  fileGeneration++;
  clearTimeout(saving);
  clearTimeout(parsing);
  recovering = true;
  source = next;
  parsedDocument = undefined;
  draftId = crypto.randomUUID();
  revision = 0;
  keptRevision = -1;
  name.value = fountainName(fileName);
  // A new document starts a fresh undo history, so Undo never reveals another screenplay.
  view.setState(editingState(next.normalized));
  recovering = false;
  hasWork = true;
  lastDownload = "";
  previewPage = 0;
  notice(
    next.mixed
      ? "This file has mixed line endings. Downloading unchanged preserves them; edits use the first line-ending style."
      : "",
  );
  void persist();
  scheduleParse(0);
  view.focus();
}

$("retry-preview").addEventListener("click", () => {
  scheduler.restart();
  scheduleParse(0);
});
function scheduleParse(delay = 180): void {
  clearTimeout(parsing);
  const generation = ++parseGeneration;
  latest = undefined;
  workbench.stale();
  pdfButton.disabled = true;
  $("counts").textContent = "Updating pages…";
  parsing = setTimeout(async () => {
    try {
      const result = await scheduler.request(
        view.state.doc.toString(),
        paper.value === "a4" ? "a4" : "letter",
      );
      if (generation !== parseGeneration) return;
      applyResult(result);
    } catch (error) {
      if (generation !== parseGeneration || isSupersededRequest(error)) return;
      $("retry-preview").hidden = false;
      $("counts").textContent = "Preview unavailable";
      notice(error instanceof Error ? error.message : "Could not update the preview.");
    }
  }, delay);
}
function applyResult(result: Result): void {
  latest = result;
  $("retry-preview").hidden = true;
  const document = result.document;
  if (document) {
    parsedDocument = document;
    rememberParsedSource(view.state.doc, document);
    workbench.update(document, view.state.doc.toString());
    decorate(document);
    const scenes = document.elements.filter((element) => element.kind === "scene");
    $("scene-count").textContent = String(scenes.length);
    outlineItems = outlineOf(document);
    renderOutline();
    $("counts").textContent =
      `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"} · ${result.layout?.pages.filter((p) => p.number !== null).length ?? "—"} pages`;
  }
  const messages = [
    ...(document?.warnings.map((w) => `Line ${w.line}: ${w.message}`) ?? []),
    ...(result.layout?.warnings ?? []),
    ...(result.error ? [result.error] : []),
  ];
  $("issues").textContent = [...new Set(messages)].join(" ");
  $("issues").hidden = !messages.length;
  pdfButton.disabled =
    exporting || !result.layout || Boolean(result.error) || Boolean(document?.warnings.length);
  renderPage();
}
function documentNode<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function decorate(document: FountainDocument): void {
  const ranges = margins.checked
    ? document.elements.map((element) => {
        const line = view.state.doc.line(Math.min(element.line, view.state.doc.lines));
        return Decoration.line({ class: `f-${element.kind}` }).range(line.from);
      })
    : [];
  view.dispatch({ effects: marks.of(Decoration.set(ranges, true)) });
}
function jumpToLine(line: number): void {
  const at = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from;
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: "center" }),
  });
  app.classList.remove("outline-open", "mobile-preview");
  $("outline-toggle").setAttribute("aria-expanded", "false");
  updatePreviewToggle();
  view.focus();
}
function moveScene(direction: -1 | 1): boolean {
  if (!parsedDocument) return false;
  const line = adjacentScene(
    parsedDocument,
    view.state.doc.lineAt(view.state.selection.main.head).number,
    direction,
  );
  if (line !== undefined) jumpToLine(line);
  return true;
}
function renderOutline(): void {
  const found = filterOutline(outlineItems, $<HTMLInputElement>("scene-search").value);
  outlineButtons.clear();
  activeOutline = undefined;
  $("scene-list").replaceChildren(
    ...found.items.map((item) => {
      const button = documentNode("button", item.text);
      button.type = "button";
      button.dataset.line = String(item.line);
      button.classList.toggle("section-link", item.kind === "section");
      button.addEventListener("click", () => jumpToLine(item.line));
      outlineButtons.set(item.line, button);
      return button;
    }),
  );
  if (!found.total) $("scene-list").append(documentNode("p", "No matching scenes or sections."));
  if (found.total > found.items.length)
    $("scene-list").append(
      documentNode("p", "Showing 500 matches. Narrow your search to find later scenes."),
    );
  updateCurrentScene(view.state.doc.lineAt(view.state.selection.main.head).number);
}
$("scene-search").addEventListener("input", renderOutline);
function updateCurrentScene(line: number): void {
  const item = outlineItems[itemAtLine(outlineItems, line)];
  const next = item ? outlineButtons.get(item.line) : undefined;
  if (next === activeOutline) return;
  activeOutline?.removeAttribute("aria-current");
  next?.setAttribute("aria-current", "true");
  activeOutline = next;
}
$("caret-page").addEventListener("click", () => {
  if (!latest?.layout) return;
  previewPage = pageAtSource(
    latest.layout,
    view.state.doc.lineAt(view.state.selection.main.head).number,
  );
  renderPage();
});
$("page-source").addEventListener("click", () => {
  const line = latest?.layout?.pages[previewPage]?.lines.find(
    (row) => row.sourceLine > 0,
  )?.sourceLine;
  if (line) jumpToLine(line);
  else notice("This page has no screenplay source line. Choose a screenplay page first.");
});
function renderPage(): void {
  const layout = latest?.layout;
  if (!layout) {
    page.replaceChildren();
    $("page-label").textContent = latest?.error ? "Preview needs attention" : "Updating…";
    $<HTMLButtonElement>("previous").disabled = true;
    $<HTMLButtonElement>("next").disabled = true;
    return;
  }
  previewPage = Math.max(0, Math.min(previewPage, layout.pages.length - 1));
  const current = layout.pages[previewPage];
  page.style.aspectRatio = `${layout.width} / ${layout.height}`;
  page.style.setProperty("--page-width", String(layout.width));
  page.style.setProperty("--full-width", `${layout.width * (4 / 3)}px`);
  page.replaceChildren(
    ...(current?.lines ?? []).map((line) => {
      const row = document.createElement("div");
      row.className = "page-line";
      row.style.left = `${(line.x / layout.width) * 100}%`;
      row.style.top = `${(line.y / layout.height) * 100}%`;
      for (const run of line.runs) {
        const span = documentNode("span", run.text);
        if (run.bold) span.style.fontWeight = "700";
        if (run.italic) span.style.fontStyle = "italic";
        if (run.underline) span.style.textDecoration = "underline";
        row.append(span);
      }
      return row;
    }),
  );
  $("page-label").textContent =
    `${current?.number === null ? "Title page" : `Page ${current?.number}`} · ${previewPage + 1} of ${layout.pages.length}`;
  $<HTMLButtonElement>("previous").disabled = previewPage <= 0;
  $<HTMLButtonElement>("next").disabled = previewPage >= layout.pages.length - 1;
}
function updatePreviewToggle(): void {
  const mobile = matchMedia("(max-width: 700px)").matches;
  const shown =
    !preferences.focus &&
    (mobile ? app.classList.contains("mobile-preview") : !app.classList.contains("no-preview"));
  preview.hidden = !shown;
  $("preview-toggle").setAttribute("aria-pressed", String(shown));
  $("preview-toggle").textContent = mobile && shown ? "Back to writing" : "Page preview";
}
$("preview-toggle").addEventListener("click", () => {
  if (preferences.focus) {
    preferences.focus = false;
    keepPreferences();
    if (matchMedia("(max-width: 700px)").matches) app.classList.add("mobile-preview");
    else app.classList.remove("no-preview");
    updatePreviewToggle();
    return;
  }
  if (matchMedia("(max-width: 700px)").matches) app.classList.toggle("mobile-preview");
  else app.classList.toggle("no-preview");
  updatePreviewToggle();
});
matchMedia("(max-width: 700px)").addEventListener("change", updatePreviewToggle);
updatePreviewToggle();
$("outline-toggle").addEventListener("click", () => {
  if (preferences.focus) {
    preferences.focus = false;
    keepPreferences();
  }
  const open = app.classList.toggle("outline-open");
  $("outline-toggle").setAttribute("aria-expanded", String(open));
});
margins.addEventListener("change", () => {
  if (latest?.document) decorate(latest.document);
});
paper.addEventListener("change", () => {
  previewPage = 0;
  scheduleParse(0);
});
$("previous").addEventListener("click", () => {
  previewPage--;
  renderPage();
});
$("next").addEventListener("click", () => {
  previewPage++;
  renderPage();
});
$("zoom").addEventListener("click", () => {
  const full = page.classList.toggle("full-size");
  $("zoom").setAttribute("aria-pressed", String(full));
  $("zoom").textContent = full ? "Fit page" : "Full size";
});
$("download").addEventListener("click", downloadSource);
name.addEventListener("change", () => {
  name.value = title();
  revision++;
  keptRevision = -1;
  hasWork = true;
  $("recovery").textContent = "Keeping this draft…";
  void persist();
});
$("help").addEventListener("click", () => $<HTMLDialogElement>("guide").showModal());
for (const button of document.querySelectorAll<HTMLButtonElement>("dialog .close"))
  button.addEventListener("click", () => button.closest("dialog")?.close());
$("open").addEventListener("click", () => $<HTMLInputElement>("file").click());
$("file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("file");
  const file = input.files?.[0];
  const ticket = ++fileGeneration;
  input.value = "";
  if (!file) return;
  try {
    if (!/\.(fountain|txt)$/i.test(file.name))
      throw new Error(
        "Open a .fountain or .txt screenplay. VoxDown .vxd stories belong in Writer.",
      );
    if (file.size > MAX_SOURCE * 4)
      throw new Error("This file is too large for experimental Studio. Open a smaller screenplay.");
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await file.arrayBuffer(),
    );
    readSource(value);
    if (ticket !== fileGeneration) return;
    if (await mayReplace()) {
      if (ticket === fileGeneration) showSource(value, file.name);
    }
  } catch (error) {
    notice(
      error instanceof Error
        ? error.message
        : "Could not open the file. Use a UTF-8 Fountain file.",
    );
  }
});
$("new").addEventListener("click", async () => {
  if (await mayReplace()) showSource("", "Untitled.fountain");
});
const example =
  "Title: The Last Light\nCredit: Written by\nAuthor: VoxDown\n\n# One light left\n\nINT. LIGHTHOUSE - NIGHT #1#\n\nRain beads on the glass. MARA watches the dark water.\n\nMARA\n(quietly)\nSomeone is still out there.\n\nJONAH\nThen we leave the light on.\n\n[[Try changing a line. This note stays out of the PDF.]]\n\nEXT. HARBOR - DAWN #2#\n\nA small boat emerges from the fog.\n\nMARA\nI see them.\n\nJONAH ^\nI see them too.\n\n> FADE OUT.\n";
$("example").addEventListener("click", async () => {
  if (await mayReplace()) showSource(example, "The Last Light.fountain");
});
const library = mountLibrary(document.body, {
  current: () => ({ name: title(), source: text(), draftId }),
  replace: async (value, fileName) => {
    if (!(await mayReplace())) return false;
    showSource(value, fileName);
    return true;
  },
  notice,
});
$("recent").addEventListener("click", () => library.open());
pdfButton.addEventListener("click", async () => {
  const result = latest;
  if (!result?.layout || result.document?.warnings.length || exporting) return;
  const fileName = title().replace(/\.fountain$/i, ".pdf");
  exporting = true;
  pdfButton.disabled = true;
  pdfButton.textContent = "Making PDF…";
  try {
    const { screenplayPdf } = await import("./pdf");
    const bytes = await screenplayPdf(result.layout, result.document?.title.title);
    download(new Uint8Array(bytes).buffer, fileName, "application/pdf");
    notice("PDF download started. It contains the screenplay as it was when you chose Export PDF.");
  } catch (error) {
    notice(
      error instanceof Error
        ? error.message
        : "PDF export failed. Your Fountain file is unchanged; download it and try again.",
    );
  } finally {
    exporting = false;
    const fullLabel = documentNode("span", "Export PDF");
    fullLabel.className = "desktop-label";
    const smallLabel = documentNode("span", "PDF");
    smallLabel.className = "mobile-label";
    pdfButton.replaceChildren(fullLabel, smallLabel);
    pdfButton.disabled = !latest?.layout || Boolean(latest?.document?.warnings.length);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (hasWork && keptRevision !== revision && text() !== lastDownload) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(saving);
    void persist();
  }
});

async function start(): Promise<void> {
  // Prevent typing into a draft which is about to be replaced by recovery.
  setWorkspaceLocked(true);
  try {
    const recovered = await Promise.race([
      (async () => {
        let id: string | null = null;
        try {
          id = sessionStorage.getItem("studio-recovery-id");
        } catch {}
        if (id) {
          const draft = await getDraft(id);
          if (draft) return draft;
        }
        const first = (await listDrafts({ limit: 1 })).items[0];
        return first ? getDraft(first.id) : undefined;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Recovery timed out")), 3000),
      ),
    ]);
    if (recovered) {
      source = readSource(recovered.source);
      name.value = recovered.name;
      view.setState(editingState(source.normalized));
      hasWork = false;
      $("recovery").textContent = "Recovered draft · edits will be kept as a new copy";
    } else $("recovery").textContent = "Local recovery ready · download to keep a file";
  } catch {
    $("recovery").textContent = "Recovery unavailable — download your Fountain file";
  }
  recovering = false;
  setWorkspaceLocked(false);
  scheduleParse(0);
}
void start();
