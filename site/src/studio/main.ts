import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
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
import { mountAdaptation } from "./adaptation-dialog";
import { mountBackup } from "./backup";
import { mountBreakdown } from "./breakdown-dialog";
import { mountCoach } from "./coach";
import { mountCompareDialog } from "./compare-dialog";
import { mountFileDrop } from "./drop-files";
import { mountFdxExport } from "./fdx-dialog";
import { mountFdxImport } from "./fdx-import-dialog";
import type { FountainDocument } from "./fountain";
import type { ScreenplayLayout } from "./layout";
import { mountLearning } from "./learning-dialog";
import { mountLibrary } from "./library";
import { LocalFileController } from "./local-file";
import { mountLocations } from "./location-dialog";
import { mountWorkspaceMenus } from "./menus";
import { adjacentScene, filterOutline, itemAtLine, outlineOf, pageAtSource } from "./navigation";
import { type NoticeLifetime, createNoticePresenter } from "./notice";
import { mountNumberingDialog } from "./numbering-dialog";
import { createStudioOffline } from "./offline";
import { pageGuideLocations, pageGuides, setPageGuides } from "./page-guides";
import { type StudioCommand, mountPalette } from "./palette";
import { mountWorkspacePanels } from "./panels";
import { type StudioPreferences, readPreferences, savePreferences } from "./preferences";
import { mountPreviewSpace } from "./preview-space";
import { assertUnambiguousOmissions } from "./public-source";
import { mountReference } from "./reference";
import { mountRehearsal } from "./rehearsal-dialog";
import { mountRename } from "./rename-dialog";
import { mountScopedReplace } from "./replace-dialog";
import { mountSceneBoard } from "./scene-board";
import { ScreenplayScheduler, type WorkerResult, isSupersededRequest } from "./scheduler";
import { screenplayKeymap } from "./screenplay-keymap";
import { mountActorSides } from "./sides-dialog";
import { MAX_SOURCE, encodeUtf8Losslessly, fountainName, readSource, writeSource } from "./source";
import { sourceEditProblem } from "./source-input";
import { mountSpeechEditor } from "./speech-dialog";
import { type StudioDraft, getDraft, keepDraft, listDrafts } from "./storage";
import { mountStorageHealth } from "./storage-health";
import { rememberParsedSource } from "./syntax";
import { type WritingMark, smartPairs, toggleWritingMark } from "./typing";
import { mountWorkbench } from "./workbench";
import { insertScreenplayParagraph, screenplayCompletions, setScreenplayLine } from "./writing";
import "./studio.css";
import "./workbench.css";
import "./palette.css";
import "./panels.css";
import "./shell.css";
import "./dialog-layout.css";

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
const pageGuideConfiguration = new Compartment();
const screenplayKeyConfiguration = new Compartment();
const localFile = new LocalFileController();
const notices = createNoticePresenter($("notice"));
let fileSavedRevision = -1;
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
    const problem = sourceEditProblem(tr);
    if (problem) {
      notice(problem);
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
        if (localFile.available) void saveToFile();
        else downloadSource();
        return true;
      },
    },
    ...defaultKeymap,
    ...historyKeymap,
    ...searchKeymap,
  ]),
  EditorView.updateListener.of((update) => {
    if (update.docChanged && !recovering) {
      notices.sourceEdited();
      revision++;
      hasWork = true;
      keptRevision = -1;
      updateFileControls();
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
  previewSpace.restore(false);
  view.focus();
});
const referencePanel = mountReference(preview, () => {
  if (preferences.focus) {
    preferences.focus = false;
    keepPreferences();
  }
  if (matchMedia("(max-width: 700px)").matches) app.classList.add("mobile-preview");
  else app.classList.remove("no-preview");
  updatePreviewToggle();
});
const previewSpace = mountPreviewSpace(
  {
    app,
    preview,
    writing: $("writing"),
    outline: $("outline"),
    button: $<HTMLButtonElement>("expand-preview"),
  },
  () => view.focus(),
);

const workspacePanels = mountWorkspacePanels({
  app,
  workspace: $("workspace"),
  outline: $("outline"),
  writing: $("writing"),
  preview,
  outlineToggle: $<HTMLButtonElement>("outline-toggle"),
  outlineClose: $<HTMLButtonElement>("outline-close"),
});

const scopedReplace = mountScopedReplace(document.body, {
  current: () => ({
    source: view.state.doc.toString(),
    id: draftId,
    position: view.state.selection.main.head,
    selection: { from: view.state.selection.main.from, to: view.state.selection.main.to },
  }),
  apply: (snapshot, plan) => {
    if (
      snapshot.id !== draftId ||
      snapshot.source !== view.state.doc.toString() ||
      recovering ||
      replacing
    )
      return false;
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    notice(`Replaced ${plan.changes.length} matches. Undo restores the previous text.`, "success");
    return true;
  },
});
const coach = mountCoach(
  document.body,
  () => ({ source: view.state.doc.toString(), position: view.state.selection.main.head }),
  () => view.focus(),
);
$("line-help").addEventListener("click", () => coach.open());
const rename = mountRename(document.body, {
  current: () => ({ source: view.state.doc.toString(), id: draftId }),
  apply: (snapshot, plan) => {
    if (
      snapshot.id !== draftId ||
      snapshot.source !== view.state.doc.toString() ||
      recovering ||
      replacing
    )
      return false;
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    notice(
      `Renamed ${plan.changes.length} character cues. ${plan.skipped.length} cues were left unchanged. Undo restores the original names.`,
      plan.skipped.length ? "important" : "success",
    );
    return true;
  },
});
const sceneBoard = mountSceneBoard(document.body, {
  current: () => ({ source: view.state.doc.toString(), id: draftId }),
  apply: (snapshot, plan) => {
    if (
      snapshot.id !== draftId ||
      snapshot.source !== view.state.doc.toString() ||
      recovering ||
      replacing
    )
      return false;
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    notice(
      plan.kind === "synopsis"
        ? `Updated scene ${plan.sceneIndex + 1} synopsis. Undo restores the previous outline.`
        : `Moved scene ${plan.moved.fromIndex + 1} to position ${plan.moved.toIndex + 1}. Undo restores the previous order.`,
      "success",
    );
    return true;
  },
  jump: (snapshot, line) => {
    if (snapshot.id !== draftId || snapshot.source !== view.state.doc.toString()) return false;
    jumpToLine(line);
    return true;
  },
});
$("scene-cards").addEventListener("click", () => sceneBoard.open());
const locations = mountLocations(document.body, {
  current: () => ({ source: view.state.doc.toString(), id: draftId }),
  apply: (snapshot, plan) => {
    if (
      snapshot.id !== draftId ||
      snapshot.source !== view.state.doc.toString() ||
      recovering ||
      replacing
    )
      return false;
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    notice(
      `Renamed ${plan.changes.length} scene locations. Undo restores the previous headings.`,
      "success",
    );
    return true;
  },
  jump: (snapshot, line) => {
    if (snapshot.id !== draftId || snapshot.source !== view.state.doc.toString()) return false;
    jumpToLine(line);
    return true;
  },
});
const numbering = mountNumberingDialog(document.body, {
  current: () => ({ source: view.state.doc.toString(), id: draftId }),
  apply: (snapshot, plan) => {
    if (
      snapshot.id !== draftId ||
      snapshot.source !== view.state.doc.toString() ||
      recovering ||
      replacing
    )
      return false;
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    notice(`Numbered ${plan.changes.length} scene headings. Undo restores the previous labels.`);
    return true;
  },
});
const actorSides = mountActorSides(document.body, {
  current: () => ({
    source: view.state.doc.toString(),
    name: title(),
    paper: paper.value as "letter" | "a4",
  }),
  download,
});
const fdxExport = mountFdxExport(document.body, {
  current: () => ({ source: view.state.doc.toString(), name: title() }),
  download,
});
const breakdown = mountBreakdown(document.body, {
  current: () => ({ source: view.state.doc.toString(), name: title() }),
  download,
});
const comparison = mountCompareDialog(document.body, {
  current: () => ({ source: text(), name: title() }),
});
const adaptation = mountAdaptation(document.body, {
  current: () => ({ source: view.state.doc.toString(), name: title() }),
  download,
});
const fdxImport = mountFdxImport(document.body, {
  openScreenplay: async (value, isCurrent) => {
    if (!(await mayReplace()) || !isCurrent()) return false;
    showSource(value.source, value.name);
    return true;
  },
});
const rehearsal = mountRehearsal(document.body, {
  current: () => ({ source: view.state.doc.toString(), name: title() }),
});
const learning = mountLearning(document.body, {
  returnToWriting: () => view.focus(),
  openExample: () => $("example").click(),
});
$("practice-fountain").addEventListener("click", () => {
  $<HTMLDialogElement>("guide").close();
  $("help").focus();
  learning.open();
});
const speechEditor = mountSpeechEditor(document.body, {
  current: () => ({ source: view.state.doc.toString(), id: draftId }),
  apply: (snapshot, plan) => {
    if (
      snapshot.id !== draftId ||
      snapshot.source !== view.state.doc.toString() ||
      recovering ||
      replacing
    )
      return false;
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    notice("Updated the selected speech. Undo restores its previous words.", "success");
    return true;
  },
});
const workbench = mountWorkbench(document.body, jumpToLine, {
  rename: () => rename.open(),
  sides: () => actorSides.open(),
  editSpeech: (line, original) => {
    if (original !== view.state.doc.toString()) {
      notice(
        "The screenplay changed. Wait for the preview to update, then reopen Character dialogue.",
      );
      return;
    }
    speechEditor.open(line);
  },
});
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
const storageHealth = mountStorageHealth(document.body, {
  download: downloadSource,
  backup: () => backup.open(),
  recover: () => library.open(),
});
$("storage-health").addEventListener("click", () => {
  $<HTMLDialogElement>("preferences-dialog").close();
  $("commands").focus();
  storageHealth.open();
});
const offline = createStudioOffline((status) => {
  $("offline-status").textContent = status.message;
  $("offline-status").dataset.state = status.state;
  $<HTMLButtonElement>("offline-prepare").disabled =
    status.state === "unavailable" || status.state === "preparing" || status.state === "checking";
  $("offline-prepare").textContent =
    status.state === "preparing"
      ? "Preparing…"
      : status.state === "ready"
        ? "Check offline files"
        : "Prepare for offline use";
});
$("offline-prepare").addEventListener("click", () => void offline.prepare());
const commands: StudioCommand[] = [
  {
    label: "Toggle scene outline",
    category: "Writing space",
    run: () => $("outline-toggle").click(),
  },
  {
    label: "Toggle page preview",
    category: "Writing space",
    run: () => $("preview-toggle").click(),
  },
  {
    label: "Scene and cast breakdown",
    category: "Plan and revise",
    keywords: "production roles scenes csv report dialogue action",
    run: () => breakdown.open(),
  },
  {
    label: "Number scenes",
    category: "Plan and revise",
    keywords: "numbering renumber labels production",
    run: () => numbering.open(),
  },
  {
    label: "Compare with local Fountain file",
    category: "Plan and revise",
    keywords: "diff changes versions word revision",
    run: () => comparison.open(),
  },
  {
    label: "Adapt screenplay to VoxDown",
    category: "Export and perform",
    keywords: "vxd voice audiobook writer conversion",
    run: () => adaptation.open(),
  },
  {
    label: "Import Final Draft XML (FDX)",
    category: "Files and recovery",
    keywords: "open convert interchange",
    run: () => fdxImport.open(),
  },
  {
    label: "Rehearsal cue cards",
    category: "Export and perform",
    keywords: "practice lines memorize actor role",
    run: () => rehearsal.open(),
  },
  {
    label: "Practice Fountain step by step",
    category: "Learn and inspect",
    keywords: "tutorial learn beginner lessons syntax",
    run: () => learning.open(),
  },
  {
    label: "Locations and location rename",
    category: "Plan and revise",
    keywords: "setting place slugline",
    run: () => locations.open(),
  },
  {
    label: "Open text reference beside screenplay",
    category: "Writing space",
    keywords: "research notes split",
    run: () => referencePanel.open(),
  },
  {
    label: "Scoped find and replace",
    category: "Plan and revise",
    keywords: "search dialogue action replace all",
    run: () => scopedReplace.open(),
  },
  {
    label: "Storage and backups",
    category: "Files and recovery",
    keywords: "quota persistence disk",
    run: () => storageHealth.open(),
  },
  {
    label: "Actor sides PDF",
    category: "Export and perform",
    keywords: "cast role performer rehearsal",
    run: () => actorSides.open(),
  },
  {
    label: "Export Final Draft XML (FDX)",
    category: "Export and perform",
    keywords: "interchange screenplay",
    run: () => fdxExport.open(),
  },
  {
    label: "Scene cards and rearrangement",
    category: "Plan and revise",
    keywords: "index cards board reorder move synopsis",
    run: () => sceneBoard.open(),
  },
  {
    label: "Rename a character",
    category: "Plan and revise",
    keywords: "cast name cue",
    run: () => rename.open(),
  },
  {
    label: "Explain the current Fountain line",
    category: "Learn and inspect",
    keywords: "help syntax element",
    run: () => coach.open(),
  },
  {
    label: "Save Fountain to file",
    category: "Files and recovery",
    keywords: "write local",
    shortcut: "Ctrl/⌘ S",
    run: () => void saveToFile(),
    enabled: () => localFile.available && !localFile.busy,
  },
  {
    label: "Save Fountain as…",
    category: "Files and recovery",
    keywords: "write local",
    run: () => void saveToFile(true),
    enabled: () => localFile.available && !localFile.busy,
  },
  {
    label: "Prepare Studio for offline use",
    category: "Files and recovery",
    keywords: "internet cache install",
    run: () => {
      $<HTMLDialogElement>("preferences-dialog").showModal();
      $("offline-prepare").focus();
    },
    enabled: () => offline.status().state !== "unavailable",
  },
  {
    label: "Toggle live margins",
    category: "Writing space",
    keywords: "indentation",
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
    category: "Export and perform",
    keywords: "page setup print size",
    run: () => {
      paper.value = value;
      paper.dispatchEvent(new Event("change"));
    },
  })),
  {
    label: "Portable backup and restore",
    category: "Files and recovery",
    keywords: "archive import export",
    run: () => backup.open(),
  },
  ...[
    ["New screenplay", "new", "Files and recovery"],
    ["Open Fountain file", "open", "Files and recovery"],
    ["Download Fountain", "download", "Files and recovery"],
    ["Export PDF", "pdf", "Export and perform", "print pages"],
    ["Recovery and snapshots", "recent", "Files and recovery", "compare versions restore history"],
    ["Focus writing", "focus-mode", "Writing space", "distraction free"],
    [
      "Preferences",
      "preferences",
      "Writing space",
      "theme font text size typewriter brackets keyboard",
    ],
    ["Fountain guide", "help", "Learn and inspect"],
    ["Show caret on page", "caret-page", "Navigate"],
    ["Go to preview source", "page-source", "Navigate"],
  ].map(([label, id, category, keywords]) => ({
    label: label ?? "",
    category: category ?? "Other",
    keywords: keywords ?? "",
    run: () => $(id ?? "").click(),
    enabled: () => !$<HTMLButtonElement>(id ?? "").disabled,
  })),
  ...[
    ["Writing statistics", "statistics"],
    ["Character dialogue", "characters"],
    ["Private notes", "notes"],
    ["Source diagnostics", "diagnostics"],
  ].map(([label, section]) => ({
    label: label ?? "",
    category: section === "characters" ? "Plan and revise" : "Learn and inspect",
    keywords: section === "characters" ? "speech edit cast role" : "",
    run: () => workbench.open(section),
  })),
  {
    label: "Previous scene",
    category: "Navigate",
    keywords: "jump",
    shortcut: "Alt PageUp",
    run: () => {
      moveScene(-1);
    },
  },
  {
    label: "Next scene",
    category: "Navigate",
    keywords: "jump",
    shortcut: "Alt PageDown",
    run: () => {
      moveScene(1);
    },
  },
];
const fileOrder = [
  "New screenplay",
  "Open Fountain file",
  "Save Fountain to file",
  "Save Fountain as…",
  "Download Fountain",
  "Import Final Draft XML (FDX)",
  "Recovery and snapshots",
  "Portable backup and restore",
  "Storage and backups",
  "Prepare Studio for offline use",
];
commands.sort(
  (a, b) =>
    (fileOrder.includes(a.label) ? fileOrder.indexOf(a.label) : fileOrder.length) -
    (fileOrder.includes(b.label) ? fileOrder.indexOf(b.label) : fileOrder.length),
);
const palette = mountPalette(document.body, commands);
const workspaceMenus = mountWorkspaceMenus(commands);
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
    workspaceMenus.close(true);
    palette.open();
  }
});

function editingState(doc = ""): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      screenplayKeyConfiguration.of(preferences.screenplayKeys ? screenplayKeymap() : []),
      pageGuideConfiguration.of(preferences.pageGuides ? pageGuides() : []),
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
  if (preferences.focus) previewSpace.restore(false);
  document.documentElement.dataset.theme = preferences.theme;
  if (preferences.focus) app.classList.remove("mobile-preview", "outline-open");
  document.documentElement.style.setProperty("--editor-size", `${preferences.textSize}px`);
  app.classList.toggle("focus-writing", preferences.focus);
  $("focus-mode").setAttribute("aria-pressed", String(preferences.focus));
  $("mobile-focus").setAttribute("aria-pressed", String(preferences.focus));
  $("mobile-focus").setAttribute(
    "aria-label",
    preferences.focus ? "Exit focus writing" : "Focus writing",
  );
  $("mobile-focus").textContent = preferences.focus ? "Exit focus" : "Focus";
  $<HTMLSelectElement>("theme").value = preferences.theme;
  $<HTMLSelectElement>("text-size").value = String(preferences.textSize);
  $<HTMLInputElement>("typewriter").checked = preferences.typewriter;
  $<HTMLInputElement>("page-guides").checked = preferences.pageGuides;
  $<HTMLInputElement>("screenplay-keys").checked = preferences.screenplayKeys;
  updatePreviewToggle();
  view.requestMeasure();
}
function keepPreferences(): void {
  applyPreferences();
  if (!savePreferences(preferences))
    notice("Preferences apply for this session; browser storage is unavailable.");
}
for (const id of ["focus-mode", "mobile-focus"])
  $(id).addEventListener("click", () => {
    preferences.focus = !preferences.focus;
    keepPreferences();
    view.focus();
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
$("page-guides").addEventListener("change", () => {
  preferences.pageGuides = $<HTMLInputElement>("page-guides").checked;
  view.dispatch({
    effects: pageGuideConfiguration.reconfigure(preferences.pageGuides ? pageGuides() : []),
  });
  updatePageGuides();
  keepPreferences();
});
$("screenplay-keys").addEventListener("change", () => {
  preferences.screenplayKeys = $<HTMLInputElement>("screenplay-keys").checked;
  view.dispatch({
    effects: screenplayKeyConfiguration.reconfigure(
      preferences.screenplayKeys ? screenplayKeymap() : [],
    ),
  });
  keepPreferences();
});
applyPreferences();
updateFileControls();

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

function notice(message: string, lifetime: NoticeLifetime = "important"): void {
  notices.show(message, lifetime);
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
  try {
    download(encodeUtf8Losslessly(value), title(), "text/plain;charset=utf-8");
  } catch (error) {
    notice(
      error instanceof Error
        ? error.message
        : "Could not prepare an exact Fountain download. Your screenplay is unchanged.",
    );
    return;
  }
  lastDownload = value;
  notice(
    "Fountain download started. Keep the downloaded file as an independent copy of your screenplay.",
    "success",
  );
}
function updateFileControls(): void {
  const button = $<HTMLButtonElement>("save-file");
  button.hidden = !localFile.available;
  button.disabled = localFile.busy;
  button.textContent = localFile.busy ? "Saving…" : localFile.filename ? "Save" : "Save to file…";
  $("file-status").textContent = localFile.filename
    ? `${localFile.filename} · ${fileSavedRevision === revision ? "File saved" : "Edits not yet saved to file"}`
    : "";
  $("file-status").hidden = !localFile.filename;
}
async function saveToFile(saveAs = false): Promise<void> {
  if (recovering || replacing) return;
  if (!localFile.available) {
    downloadSource();
    return;
  }
  const capturedId = draftId;
  const capturedRevision = revision;
  const value = text();
  const pending =
    saveAs || !localFile.filename ? localFile.saveAs(value, title()) : localFile.save(value);
  updateFileControls();
  const result = await pending;
  if (capturedId !== draftId) {
    updateFileControls();
    return;
  }
  if (result.status === "saved") {
    fileSavedRevision = capturedRevision;
    // A linked file can change externally; it is not an independent downloaded copy.
    // Keep recovery-loss guards tied to actual downloads, even after a successful Save.
    notice(
      revision === capturedRevision
        ? `Saved to ${result.filename}.`
        : `Saved an earlier version to ${result.filename}. Your newer edits are still in the editor; save again.`,
      revision === capturedRevision ? "success" : "important",
    );
  } else if (result.status === "conflict") {
    notice(
      `The file ${result.filename} changed outside Studio. It was not overwritten. Use Save As with a different filename, or Download, to keep your edits.`,
    );
  } else if (result.status === "error") {
    notice(result.message);
  } else if (result.status === "busy") {
    notice("A file save is already in progress. Your edits remain available here.");
  } else if (result.status === "cancelled") {
    notice("File save cancelled. Your screenplay is unchanged.");
  }
  updateFileControls();
}
$("save-file").addEventListener("click", () => void saveToFile());
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
  previewSpace.restore(false);
  const next = readSource(value);
  localFile.disconnect();
  fileSavedRevision = -1;
  fileGeneration++;
  clearTimeout(saving);
  clearTimeout(parsing);
  recovering = true;
  source = next;
  parsedDocument = undefined;
  draftId = crypto.randomUUID();
  revision = 0;
  updateFileControls();
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
  updatePageGuides();
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
  updatePageGuides();
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
    const scriptPages = result.layout?.pages.filter((p) => p.number !== null).length;
    $("counts").textContent =
      `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"} · ${scriptPages ?? "—"} script ${scriptPages === 1 ? "page" : "pages"}`;
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
function updatePageGuides(): void {
  if (!preferences.pageGuides) return;
  view.dispatch({
    effects: setPageGuides.of(latest?.layout ? pageGuideLocations(latest.layout) : []),
  });
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
  previewSpace.restore(false);
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
  if (!found.total)
    $("scene-list").append(
      documentNode(
        "p",
        outlineItems.length
          ? "No matching scenes or sections."
          : "Your scenes will appear here. Start a heading with INT. or EXT.",
      ),
    );
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
  referencePanel.showPage();
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
  $("preview-toggle").textContent = mobile ? (shown ? "Writing" : "Preview") : "Preview";
}
$("preview-toggle").addEventListener("click", () => {
  previewSpace.restore(false);
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
  previewSpace.restore(false);
  if (preferences.focus) {
    preferences.focus = false;
    keepPreferences();
  }
  workspacePanels.toggleOutline();
});
margins.addEventListener("change", () => {
  if (latest?.document) decorate(latest.document);
});
paper.addEventListener("change", () => {
  previewPage = 0;
  scheduleParse(0);
  updatePageGuides();
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
  updateFileControls();
  keptRevision = -1;
  hasWork = true;
  $("recovery").textContent = "Keeping this draft…";
  void persist();
});
$("help").addEventListener("click", () => $<HTMLDialogElement>("guide").showModal());
for (const button of document.querySelectorAll<HTMLButtonElement>("dialog .close"))
  button.addEventListener("click", () => button.closest("dialog")?.close());
$("open").addEventListener("click", () => $<HTMLInputElement>("file").click());
async function openFountainFile(file: File) {
  const ticket = ++fileGeneration;
  try {
    if (!/\.(fountain|txt)$/i.test(file.name))
      throw new Error(
        "Open a .fountain or .txt screenplay. For .fdx, use Commands → Import Final Draft XML. VoxDown .vxd stories belong in Writer.",
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
    if (ticket !== fileGeneration) return;
    notice(
      error instanceof Error
        ? error.message
        : "Could not open the file. Use a UTF-8 Fountain file.",
    );
  }
}
$("file").addEventListener("change", () => {
  const input = $<HTMLInputElement>("file");
  const file = input.files?.[0];
  input.value = "";
  if (file) void openFountainFile(file);
  else fileGeneration++;
});
mountFileDrop(document, {
  open: (file) => void openFountainFile(file),
  notice,
  locked: () => recovering || replacing,
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
  download,
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
    if (result.document) assertUnambiguousOmissions(view.state.doc.toString(), result.document);
    const { screenplayPdf } = await import("./pdf");
    const bytes = await screenplayPdf(result.layout, result.document?.title.title);
    download(new Uint8Array(bytes).buffer, fileName, "application/pdf");
    notice(
      "PDF download started. It contains the screenplay as it was when you chose Export PDF.",
      "success",
    );
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
  let unreadableSavedSource = false;
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
      try {
        source = readSource(recovered.source);
      } catch (error) {
        unreadableSavedSource = true;
        throw error;
      }
      name.value = recovered.name;
      view.setState(editingState(source.normalized));
      hasWork = false;
      $("recovery").textContent = "Recovered draft · edits will be kept as a new copy";
    } else $("recovery").textContent = "Local recovery ready · download to keep a file";
  } catch {
    $("recovery").textContent = unreadableSavedSource
      ? "This saved draft could not be reopened. It remains unchanged under Recover. Open its entry there to download recovery JSON."
      : "Recovery unavailable — download your Fountain file";
  }
  recovering = false;
  setWorkspaceLocked(false);
  scheduleParse(0);
}
void start();
