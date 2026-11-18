import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import type { FountainDocument } from "./fountain";
import type { ScreenplayLayout } from "./layout";
import { MAX_LINES, MAX_SOURCE, fountainName, readSource, writeSource } from "./source";
import { type StudioDraft, keepDraft, recentDrafts } from "./storage";
import "./studio.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $("app");
const name = $<HTMLInputElement>("name");
const margins = $<HTMLInputElement>("margins");
const pdfButton = $<HTMLButtonElement>("pdf");
const paper = $<HTMLSelectElement>("paper");
const preview = $("preview");
const page = $("page");
let worker: Worker | undefined;
try {
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
} catch {}
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

type Result = {
  id: number;
  document?: FountainDocument;
  layout?: ScreenplayLayout;
  error?: string;
};
let source = readSource("");
let draftId = crypto.randomUUID();
let revision = 0;
let keptRevision = -1;
let lastDownload = "";
let hasWork = false;
let latest: Result | undefined;
let requestId = 0;
let currentRequest = 0;
let parseGeneration = 0;
let previewPage = 0;
let saving: ReturnType<typeof setTimeout> | undefined;
let parsing: ReturnType<typeof setTimeout> | undefined;
let recovering = true;
let exporting = false;
let workerFailed = !worker;
let replacing = false;
const pending = new Map<
  number,
  {
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const editorExtensions: Extension = [
  history(),
  search(),
  EditorView.lineWrapping,
  highlightActiveLine(),
  markField,
  placeholder("INT. SOMEWHERE - DAY\n\nStart a scene, or open a Fountain screenplay."),
  EditorView.contentAttributes.of({
    "aria-label": "Fountain screenplay",
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
    }
  }),
];
const view = new EditorView({
  parent: $("editor"),
  state: EditorState.create({ extensions: editorExtensions }),
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
  app.inert = true;
  try {
    if (await persist()) return true;
    return (
      text() === lastDownload ||
      window.confirm(
        "Browser recovery is unavailable. Replacing this draft may lose your changes. Cancel to download it first, or OK to replace it.",
      )
    );
  } finally {
    app.inert = false;
    replacing = false;
  }
}

function showSource(value: string, fileName: string): void {
  const next = readSource(value);
  clearTimeout(saving);
  clearTimeout(parsing);
  recovering = true;
  source = next;
  draftId = crypto.randomUUID();
  revision = 0;
  keptRevision = -1;
  name.value = fountainName(fileName);
  // A new document starts a fresh undo history, so Undo never reveals another screenplay.
  view.setState(EditorState.create({ doc: next.normalized, extensions: editorExtensions }));
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

function askWorker(): Promise<Result> {
  if (workerFailed)
    return Promise.reject(
      new Error("The screenplay worker stopped. Download your Fountain file, then reload Studio."),
    );
  const id = ++requestId;
  currentRequest = id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error("Layout took too long. Your source is safe; shorten the draft or reload Studio."),
      );
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    worker?.postMessage({ id, source: view.state.doc.toString(), paper: paper.value });
  });
}
if (worker)
  worker.onmessage = (event: MessageEvent<Result>) => {
    const result = event.data;
    const job = pending.get(result.id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(result.id);
    job.resolve(result);
  };
if (worker)
  worker.onerror = () => {
    workerFailed = true;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(
        new Error(
          "Screenplay layout stopped. Your text is safe; download Fountain and reload to try again.",
        ),
      );
    }
    pending.clear();
    pdfButton.disabled = true;
    notice(
      "Screenplay layout stopped. Your text is safe; download Fountain and reload to try again.",
    );
  };
function scheduleParse(delay = 180): void {
  clearTimeout(parsing);
  const generation = ++parseGeneration;
  latest = undefined;
  currentRequest = ++requestId;
  pdfButton.disabled = true;
  $("counts").textContent = "Updating pages…";
  parsing = setTimeout(async () => {
    try {
      const result = await askWorker();
      if (result.id !== currentRequest) return;
      applyResult(result);
    } catch (error) {
      if (generation !== parseGeneration) return;
      $("counts").textContent = "Preview unavailable";
      notice(error instanceof Error ? error.message : "Could not update the preview.");
    }
  }, delay);
}
function applyResult(result: Result): void {
  latest = result;
  const document = result.document;
  if (document) {
    decorate(document);
    const scenes = document.elements.filter((element) => element.kind === "scene");
    $("scene-count").textContent = String(scenes.length);
    const buttons = scenes.slice(0, 500).map((scene) => {
      const button = documentNode("button", scene.text);
      button.type = "button";
      button.dataset.line = String(scene.line);
      button.addEventListener("click", () => {
        const at = view.state.doc.line(Math.min(scene.line, view.state.doc.lines)).from;
        view.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: "start" }),
        });
        app.classList.remove("outline-open", "mobile-preview");
        $("outline-toggle").setAttribute("aria-expanded", "false");
        updatePreviewToggle();
        view.focus();
      });
      return button;
    });
    $("scene-list").replaceChildren(...buttons);
    if (scenes.length > 500)
      $("scene-list").append(
        documentNode(
          "p",
          "Showing the first 500 scenes. Use Find (Ctrl/⌘ F) to reach later scenes.",
        ),
      );
    updateCurrentScene(view.state.doc.lineAt(view.state.selection.main.head).number);
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
function updateCurrentScene(line: number): void {
  const buttons = [...$("scene-list").querySelectorAll<HTMLButtonElement>("button")];
  const current = buttons.filter((button) => Number(button.dataset.line) <= line).at(-1);
  for (const button of buttons) {
    const next = String(button === current);
    if (button.getAttribute("aria-current") !== next) button.setAttribute("aria-current", next);
  }
}
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
  const shown = mobile
    ? app.classList.contains("mobile-preview")
    : !app.classList.contains("no-preview");
  preview.hidden = !shown;
  $("preview-toggle").setAttribute("aria-pressed", String(shown));
  $("preview-toggle").textContent = mobile && shown ? "Back to writing" : "Page preview";
}
$("preview-toggle").addEventListener("click", () => {
  if (matchMedia("(max-width: 700px)").matches) app.classList.toggle("mobile-preview");
  else app.classList.toggle("no-preview");
  updatePreviewToggle();
});
matchMedia("(max-width: 700px)").addEventListener("change", updatePreviewToggle);
updatePreviewToggle();
$("outline-toggle").addEventListener("click", () => {
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
  hasWork = true;
  void persist();
});
$("help").addEventListener("click", () => $<HTMLDialogElement>("guide").showModal());
for (const button of document.querySelectorAll<HTMLButtonElement>("dialog .close"))
  button.addEventListener("click", () => button.closest("dialog")?.close());
$("open").addEventListener("click", () => $<HTMLInputElement>("file").click());
$("file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("file");
  const file = input.files?.[0];
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
    if (await mayReplace()) showSource(value, file.name);
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
$("recent").addEventListener("click", async () => {
  try {
    const drafts = await recentDrafts();
    $("draft-list").replaceChildren(
      ...drafts.map((draft) => {
        const button = documentNode("button", draft.name);
        button.type = "button";
        button.append(
          documentNode(
            "small",
            `${new Date(draft.updated).toLocaleString()} · ${draft.source.length.toLocaleString()} characters`,
          ),
        );
        button.addEventListener("click", async () => {
          if (!(await mayReplace())) return;
          try {
            showSource(draft.source, draft.name);
            $<HTMLDialogElement>("recovery-dialog").close();
          } catch (error) {
            notice(String(error));
          }
        });
        return button;
      }),
    );
    if (!drafts.length)
      $("draft-list").append(
        documentNode("p", "No drafts yet. Your work will appear here as you write."),
      );
    $<HTMLDialogElement>("recovery-dialog").showModal();
  } catch {
    notice("Browser recovery is unavailable. You can still open and download Fountain files.");
  }
});
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
    pdfButton.textContent = "Export PDF";
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
  app.inert = true;
  try {
    const drafts = await Promise.race([
      recentDrafts(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Recovery timed out")), 3000),
      ),
    ]);
    let id: string | null = null;
    try {
      id = sessionStorage.getItem("studio-recovery-id");
    } catch {}
    const recovered = drafts.find((draft) => draft.id === id) ?? drafts[0];
    if (recovered) {
      source = readSource(recovered.source);
      name.value = recovered.name;
      view.setState(EditorState.create({ doc: source.normalized, extensions: editorExtensions }));
      hasWork = false;
      $("recovery").textContent = "Recovered draft · edits will be kept as a new copy";
    } else $("recovery").textContent = "Local recovery ready · download to keep a file";
  } catch {
    $("recovery").textContent = "Recovery unavailable — download your Fountain file";
  }
  recovering = false;
  app.inert = false;
  scheduleParse(0);
}
void start();
