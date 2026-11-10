/**
 * Just enough of the `vscode` API to run the extension in tests, recording what it does. The real
 * one exists only inside VS Code; vitest.config.ts points `vscode` here.
 */

type Listener<T> = (value: T) => unknown;

export class EventEmitter<T> {
  private listeners: Array<Listener<T>> = [];
  readonly event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((other) => other !== listener);
      },
    };
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
  ) {}
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  static from(parts: { scheme: string; path: string }): Uri {
    return new Uri(parts.scheme, parts.path);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    const parts = base.path.split("/");
    for (const segment of segments) {
      if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    return new Uri(base.scheme, parts.join("/"));
  }
  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    this.start = typeof a === "number" ? new Position(a, b as number) : a;
    this.end = typeof a === "number" ? new Position(c ?? 0, d ?? 0) : (b as Position);
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  code?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: DiagnosticSeverity,
  ) {}
}

export enum SymbolKind {
  String = 14,
  Event = 23,
}

export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  constructor(
    readonly name: string,
    readonly detail: string,
    readonly kind: SymbolKind,
    readonly range: Range,
    readonly selectionRange: Range,
  ) {}
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
}

export enum ColorThemeKind {
  Light = 1,
  Dark = 2,
  HighContrast = 3,
  HighContrastLight = 4,
}

/** A text document the tests can edit. */
export class TextDocument {
  constructor(
    readonly uri: Uri,
    readonly languageId: string,
    private text: string,
  ) {}
  getText(): string {
    return this.text;
  }
  setText(text: string): void {
    this.text = text;
  }
  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset).split("\n");
    return new Position(before.length - 1, before[before.length - 1]?.length ?? 0);
  }
}

// What the extension did, for the tests to look at.

export const recorded = {
  diagnostics: new Map<string, Diagnostic[]>(),
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executed: [] as Array<{ command: string; args: unknown[] }>,
  symbolProviders: [] as Array<{
    selector: unknown;
    provider: { provideDocumentSymbols: (document: TextDocument) => DocumentSymbol[] };
  }>,
  panels: [] as WebviewPanel[],
  messages: [] as string[],
};

export const events = {
  open: new EventEmitter<TextDocument>(),
  change: new EventEmitter<{ document: TextDocument }>(),
  close: new EventEmitter<TextDocument>(),
  activeEditor: new EventEmitter<{ document: TextDocument } | undefined>(),
};

class Webview {
  html = "";
  options: Record<string, unknown>;
  readonly cspSource = "https://test.vscode-cdn.net";
  readonly posted: unknown[] = [];
  readonly received = new EventEmitter<unknown>();
  readonly onDidReceiveMessage = this.received.event;
  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
  asWebviewUri(uri: Uri): Uri {
    return Uri.from({ scheme: "https", path: `test.vscode-cdn.net${uri.path}` });
  }
  postMessage(message: unknown): Promise<boolean> {
    this.posted.push(message);
    return Promise.resolve(true);
  }
}

export class WebviewPanel {
  title: string;
  iconPath?: Uri;
  readonly webview: Webview;
  revealed = 0;
  private readonly disposed = new EventEmitter<void>();
  readonly onDidDispose = this.disposed.event;
  constructor(
    readonly viewType: string,
    title: string,
    readonly showOptions: unknown,
    options: Record<string, unknown>,
  ) {
    this.title = title;
    this.webview = new Webview(options);
  }
  reveal(): void {
    this.revealed++;
  }
  dispose(): void {
    this.disposed.fire();
  }
}

export const workspace = {
  textDocuments: [] as TextDocument[],
  onDidOpenTextDocument: events.open.event,
  onDidChangeTextDocument: events.change.event,
  onDidCloseTextDocument: events.close.event,
  getWorkspaceFolder: (_uri: Uri) => ({ uri: Uri.file("/stories") }),
};

export const window = {
  activeTextEditor: undefined as { document: TextDocument } | undefined,
  activeColorTheme: { kind: ColorThemeKind.Dark },
  onDidChangeActiveTextEditor: events.activeEditor.event,
  createWebviewPanel: (
    viewType: string,
    title: string,
    showOptions: unknown,
    options: Record<string, unknown>,
  ) => {
    const panel = new WebviewPanel(viewType, title, showOptions, options);
    recorded.panels.push(panel);
    return panel;
  },
  showInformationMessage: (message: string) => {
    recorded.messages.push(message);
    return Promise.resolve(undefined);
  },
};

export const languages = {
  createDiagnosticCollection: (_name: string) => ({
    set: (uri: Uri, diagnostics: Diagnostic[]) =>
      recorded.diagnostics.set(uri.toString(), diagnostics),
    delete: (uri: Uri) => recorded.diagnostics.delete(uri.toString()),
    dispose: () => recorded.diagnostics.clear(),
  }),
  registerDocumentSymbolProvider: (
    selector: unknown,
    provider: (typeof recorded.symbolProviders)[number]["provider"],
  ) => {
    recorded.symbolProviders.push({ selector, provider });
    return { dispose: () => {} };
  },
};

export const commands = {
  registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
    recorded.commands.set(command, callback);
    return { dispose: () => recorded.commands.delete(command) };
  },
  executeCommand: (command: string, ...args: unknown[]) => {
    recorded.executed.push({ command, args });
    return Promise.resolve(undefined);
  },
};
