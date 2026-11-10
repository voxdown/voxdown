/**
 * The VoxDown extension: warnings as diagnostics, an outline, the cheat sheet, and a live preview
 * in the script view or the book view. Colors come from the grammar in `syntaxes/`.
 */
import { webcrypto } from "node:crypto";
import { escapeHtml } from "@voxdown/render";
import { parse } from "voxdown";
import * as vscode from "vscode";
import { DIAGNOSTIC_SOURCE, type DiagnosticInfo, diagnose } from "./diagnostics";
import { type OutlineEntry, outline } from "./outline";
import { type View, makeNonce, previewPage, renderView } from "./preview";

const LANGUAGE = "voxdown";
/** How long typing pauses before the warnings and the preview catch up, in milliseconds. */
const DIAGNOSTICS_DELAY = 300;
const PREVIEW_DELAY = 150;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    ...diagnostics(),
    vscode.languages.registerDocumentSymbolProvider(
      { language: LANGUAGE },
      { provideDocumentSymbols },
    ),
    vscode.commands.registerCommand("voxdown.showCheatSheet", () =>
      vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.joinPath(context.extensionUri, "dist", "CHEATSHEET.md"),
      ),
    ),
    vscode.commands.registerCommand("voxdown.openPreview", () => openPreview(context)),
  );
}

export function deactivate(): void {}

// Diagnostics

function diagnostics(): vscode.Disposable[] {
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancel = (document: vscode.TextDocument) => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const refresh = (document: vscode.TextDocument) => {
    cancel(document);
    if (document.languageId !== LANGUAGE) return;
    collection.set(document.uri, diagnose(document.getText()).map(toDiagnostic));
  };
  const later = (document: vscode.TextDocument) => {
    if (document.languageId !== LANGUAGE) return;
    cancel(document);
    timers.set(
      document.uri.toString(),
      setTimeout(() => refresh(document), DIAGNOSTICS_DELAY),
    );
  };
  vscode.workspace.textDocuments.forEach(refresh);
  return [
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => later(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancel(document);
      collection.delete(document.uri);
    }),
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  ];
}

function toDiagnostic(info: DiagnosticInfo): vscode.Diagnostic {
  const range = new vscode.Range(
    info.start.line,
    info.start.character,
    info.end.line,
    info.end.character,
  );
  const severity =
    info.severity === "information"
      ? vscode.DiagnosticSeverity.Information
      : vscode.DiagnosticSeverity.Warning;
  const diagnostic = new vscode.Diagnostic(range, info.message, severity);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = info.code;
  return diagnostic;
}

// Outline

function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const toRange = (range: { from: number; to: number }) =>
    new vscode.Range(document.positionAt(range.from), document.positionAt(range.to));
  const toSymbol = (entry: OutlineEntry): vscode.DocumentSymbol => {
    const symbol = new vscode.DocumentSymbol(
      entry.name,
      entry.detail,
      entry.kind === "heading" ? vscode.SymbolKind.String : vscode.SymbolKind.Event,
      toRange(entry.range),
      toRange(entry.selection),
    );
    symbol.children = entry.children.map(toSymbol);
    return symbol;
  };
  return outline(parse(document.getText())).map(toSymbol);
}

// Preview

/** The one preview panel. It shows the VoxDown document last active in an editor. */
let preview: Preview | undefined;

function openPreview(context: vscode.ExtensionContext): void {
  const document = vscode.window.activeTextEditor?.document;
  if (document?.languageId !== LANGUAGE) {
    if (preview) preview.reveal();
    else void vscode.window.showInformationMessage("Open a VoxDown file to preview it.");
    return;
  }
  if (preview) {
    preview.show(document);
    preview.reveal();
  } else {
    preview = new Preview(context, document);
    context.subscriptions.push(preview);
  }
}

class Preview implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private document: vscode.TextDocument;
  private view: View = "script";
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext, document: vscode.TextDocument) {
    this.document = document;
    this.panel = vscode.window.createWebviewPanel(
      "voxdown.preview",
      this.title(),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, enableCommandUris: false, localResourceRoots: this.roots() },
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "images", "icon.png");
    this.load();
    this.disposables.push(
      this.panel.onDidDispose(() => this.closed()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === this.document) this.later();
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === LANGUAGE && editor.document !== this.document) {
          this.show(editor.document);
        }
      }),
    );
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  /** Closes the panel, when the extension stops. */
  dispose(): void {
    if (preview === this) this.panel.dispose();
  }

  /** Shows another document. Its folder becomes where images are read from. */
  show(document: vscode.TextDocument): void {
    if (document === this.document) return;
    this.document = document;
    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: this.roots(),
    };
    this.load();
  }

  private load(): void {
    const webview = this.panel.webview;
    const folder = this.folder();
    this.panel.title = this.title();
    webview.html = previewPage({
      body: this.render(),
      view: this.view,
      cspSource: webview.cspSource,
      nonce: makeNonce((bytes) => webcrypto.getRandomValues(bytes)),
      ...(folder ? { base: `${webview.asWebviewUri(folder).toString()}/` } : {}),
      light: [vscode.ColorThemeKind.Light, vscode.ColorThemeKind.HighContrastLight].includes(
        vscode.window.activeColorTheme.kind,
      ),
    });
  }

  private later(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), PREVIEW_DELAY);
  }

  private update(): void {
    clearTimeout(this.timer);
    this.panel.title = this.title();
    void this.panel.webview.postMessage({ type: "update", html: this.render(), view: this.view });
  }

  private receive(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const { type, view } = message as { type?: unknown; view?: unknown };
    if (type === "view" && (view === "script" || view === "book")) {
      this.view = view;
      this.update();
    } else if (type === "ready") {
      this.update();
    }
  }

  private render(): string {
    try {
      return renderView(this.document.getText(), this.view);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `<p>The preview could not be drawn: ${escapeHtml(message)}</p>`;
    }
  }

  private title(): string {
    const name = this.document.uri.path.split("/").pop() || "Untitled";
    return `${this.view === "book" ? "Book" : "Script"}: ${name}`;
  }

  /** The story's folder, for its images. Untitled documents have none. */
  private folder(): vscode.Uri | undefined {
    if (this.document.uri.scheme === "untitled") return undefined;
    return vscode.Uri.joinPath(this.document.uri, "..");
  }

  /** The story's folder and its workspace folder, where its images may be. */
  private roots(): vscode.Uri[] {
    const folder = this.folder();
    const workspace = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri;
    const roots = new Map<string, vscode.Uri>();
    for (const uri of [folder, workspace]) if (uri) roots.set(uri.toString(), uri);
    return [...roots.values()];
  }

  private closed(): void {
    clearTimeout(this.timer);
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    if (preview === this) preview = undefined;
  }
}
