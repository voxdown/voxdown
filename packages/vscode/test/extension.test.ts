import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activate } from "../src/extension";
import {
  events,
  DiagnosticSeverity,
  TextDocument,
  Uri,
  ViewColumn,
  recorded,
  window,
  workspace,
} from "./vscode-stub";

/** The extension against a stand-in for VS Code (test/vscode-stub.ts). */

const story = (text: string, name = "tale.vxd", languageId = "voxdown") =>
  new TextDocument(Uri.file(`/stories/${name}`), languageId, text);

const subscriptions: Array<{ dispose: () => unknown }> = [];

function start(): void {
  const context = { subscriptions, extensionUri: Uri.file("/extension") };
  activate(context as unknown as Parameters<typeof activate>[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  workspace.textDocuments = [];
  window.activeTextEditor = undefined;
  recorded.panels.length = 0;
  recorded.executed.length = 0;
  recorded.messages.length = 0;
  recorded.symbolProviders.length = 0;
});

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) subscription.dispose();
  recorded.diagnostics.clear();
  vi.useRealTimers();
});

describe("the extension", () => {
  it("contributes its two commands and an outline", () => {
    start();
    expect([...recorded.commands.keys()].sort()).toEqual([
      "voxdown.openPreview",
      "voxdown.showCheatSheet",
    ]);
    expect(recorded.symbolProviders.map((entry) => entry.selector)).toEqual([
      { language: "voxdown" },
    ]);
  });

  it("shows the core's warnings for open VoxDown documents only", () => {
    const open = story("@Gerald “Could you not?");
    workspace.textDocuments = [open, story("@Gerald “Hi", "notes.md", "markdown")];
    start();
    const [diagnostic, ...rest] = recorded.diagnostics.get(open.uri.toString()) ?? [];
    expect(rest).toEqual([]);
    expect(diagnostic?.source).toBe("voxdown");
    expect(diagnostic?.code).toBe("unclosed-quote");
    expect(diagnostic?.severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostic?.range.start).toEqual({ line: 0, character: 8 });
    expect(recorded.diagnostics.has(Uri.file("/stories/notes.md").toString())).toBe(false);
  });

  it("updates them a moment after typing, and clears them on close", () => {
    start();
    const document = story("Once upon a time.");
    events.open.fire(document);
    expect(recorded.diagnostics.get(document.uri.toString())).toEqual([]);
    document.setText("Once upon a time. {pause soon}");
    events.change.fire({ document });
    expect(recorded.diagnostics.get(document.uri.toString())).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(recorded.diagnostics.get(document.uri.toString())?.map((d) => d.code)).toEqual([
      "pause-value",
    ]);
    events.close.fire(document);
    expect(recorded.diagnostics.has(document.uri.toString())).toBe(false);
  });

  it("outlines headings and scene breaks", () => {
    start();
    const provider = recorded.symbolProviders[0]?.provider;
    const symbols =
      provider?.provideDocumentSymbols(story("# Title\n\nOnce.\n\n---\n\nTwice.")) ?? [];
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Title"]);
    expect(symbols[0]?.children.map((symbol) => symbol.name)).toEqual(["Scene 2"]);
    expect(symbols[0]?.children[0]?.selectionRange.start).toEqual({ line: 4, character: 0 });
  });

  it("opens the bundled cheat sheet in the Markdown preview", async () => {
    start();
    await recorded.commands.get("voxdown.showCheatSheet")?.();
    expect(recorded.executed).toEqual([
      { command: "markdown.showPreview", args: [Uri.file("/extension/dist/CHEATSHEET.md")] },
    ]);
  });
});

describe("the preview", () => {
  it("opens beside the story, with scripts on and only the story's folders readable", () => {
    start();
    window.activeTextEditor = { document: story("@Gerald (yawning) “I’m tired.”") };
    recorded.commands.get("voxdown.openPreview")?.();
    const [panel, ...others] = recorded.panels;
    expect(others).toEqual([]);
    expect(panel?.title).toBe("Script: tale.vxd");
    expect(panel?.showOptions).toEqual({ viewColumn: ViewColumn.Beside, preserveFocus: true });
    expect(panel?.webview.options).toMatchObject({ enableScripts: true, enableCommandUris: false });
    expect(panel?.webview.options.localResourceRoots).toEqual([Uri.file("/stories")]);
    const html = panel?.webview.html ?? "";
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("vxd-script");
    expect(html).toContain("yawning");
    expect(html).toContain('<base href="https://test.vscode-cdn.net/stories/">');
  });

  it("switches to the book view, follows typing, and opens only once", () => {
    start();
    const document = story("@Gerald (yawning) “I’m tired.”");
    window.activeTextEditor = { document };
    recorded.commands.get("voxdown.openPreview")?.();
    const panel = recorded.panels[0];
    if (!panel) throw new Error("no panel");
    const posted = panel.webview.posted as Array<{ type: string; html: string; view: string }>;

    panel.webview.received.fire({ type: "ready" });
    expect(posted.at(-1)?.view).toBe("script");

    panel.webview.received.fire({ type: "view", view: "book" });
    expect(posted.at(-1)?.view).toBe("book");
    expect(posted.at(-1)?.html).toContain("vxd-book");
    expect(posted.at(-1)?.html).not.toContain("yawning");
    expect(panel.title).toBe("Book: tale.vxd");

    document.setText("@Gerald “Fine,” said the dragon.");
    events.change.fire({ document });
    vi.advanceTimersByTime(200);
    expect(posted.at(-1)?.html).toContain("said the dragon");

    panel.webview.received.fire({ type: "view", view: "<script>" });
    panel.webview.received.fire("nonsense");
    expect(posted.at(-1)?.view).toBe("book");

    recorded.commands.get("voxdown.openPreview")?.();
    expect(recorded.panels).toHaveLength(1);
    expect(panel.revealed).toBe(1);
  });

  it("follows another VoxDown editor, and says what to do with none", () => {
    start();
    recorded.commands.get("voxdown.openPreview")?.();
    expect(recorded.panels).toHaveLength(0);
    expect(recorded.messages).toEqual(["Open a VoxDown file to preview it."]);

    window.activeTextEditor = { document: story("One.") };
    recorded.commands.get("voxdown.openPreview")?.();
    const panel = recorded.panels[0];
    events.activeEditor.fire({ document: story("Two.", "other.vxd") });
    expect(panel?.title).toBe("Script: other.vxd");
    expect(panel?.webview.html).toContain("Two.");
    events.activeEditor.fire({ document: story("# Notes", "notes.md", "markdown") });
    expect(panel?.title).toBe("Script: other.vxd");

    panel?.dispose();
    recorded.commands.get("voxdown.openPreview")?.();
    expect(recorded.panels).toHaveLength(2);
  });
});
