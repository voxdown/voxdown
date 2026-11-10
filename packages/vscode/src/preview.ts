/**
 * The preview's page: the story rendered by @voxdown/render, the script view or the book view,
 * with a switch between them. This module doesn't import `vscode`; the extension puts the page in
 * a webview and sends it new HTML as the story changes.
 */
import { escapeHtml, renderBook, renderScript, stylesheet } from "@voxdown/render";
import { parse } from "voxdown";

export type View = "script" | "book";

/** A story's HTML in one of the two views. The renderer escapes everything the story says. */
export function renderView(text: string, view: View): string {
  const story = parse(text);
  return view === "book" ? renderBook(story, { pages: true }) : renderScript(story);
}

export type PageOptions = {
  /** The story's HTML, from `renderView`. */
  body: string;
  view: View;
  /** The webview's `cspSource`, for images next to the story. */
  cspSource: string;
  /** A fresh random value for each page, for the one script. */
  nonce: string;
  /** Where relative image addresses start: the story's folder, as a webview address. */
  base?: string;
  /** Whether VS Code's theme is a light one, so the story starts on the right paper. */
  light: boolean;
};

/**
 * The Content-Security-Policy: nothing loads but images and the one script with this page's nonce.
 * Styles are allowed inline, because the renderer sets each character's color in a `style`
 * attribute, and a nonce would switch that off.
 */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} https: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `base-uri 'self' ${cspSource}`,
    "form-action 'none'",
  ].join("; ");
}

export function previewPage(options: PageOptions): string {
  const { body, view, cspSource, nonce, base, light } = options;
  const pressed = (name: View) => (name === view ? "true" : "false");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(cspSource, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base ? `<base href="${escapeHtml(base)}">\n` : ""}<title>VoxDown preview</title>
<style>
${stylesheet}
body { margin: 0; padding: 0 20px 48px; background: var(--vscode-editor-background); }
#story .vxd { --vxd-ink: var(--vscode-editor-foreground); --vxd-muted: var(--vscode-descriptionForeground); --vxd-paper: var(--vscode-editor-background); }
.preview-views { position: sticky; top: 0; z-index: 1; display: flex; justify-content: flex-end; gap: 4px; padding: 10px 0; background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.preview-views button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 3px 10px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font: inherit; cursor: pointer; }
.preview-views button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.preview-views button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.preview-views button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
</style>
</head>
<body>
<nav class="preview-views" aria-label="View">
<button type="button" data-view="script" aria-pressed="${pressed("script")}">Script</button>
<button type="button" data-view="book" aria-pressed="${pressed("book")}">Book</button>
</nav>
<main id="story" data-vxd-theme="${light ? "light" : "dark"}">
${body}
</main>
<script nonce="${escapeHtml(nonce)}">
${PAGE_SCRIPT}
</script>
</body>
</html>
`;
}

/**
 * The page's one script: the view switch, new HTML from the extension, and the paper following
 * VS Code's theme. The HTML it sets comes from the renderer, and the policy runs no script in it.
 */
const PAGE_SCRIPT = `(() => {
  const vscode = acquireVsCodeApi();
  const story = document.getElementById("story");
  const buttons = Array.from(document.querySelectorAll("button[data-view]"));
  const show = (view) => {
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.view === view));
  };
  const paper = () => {
    const classes = document.body.classList;
    const light = classes.contains("vscode-light") || classes.contains("vscode-high-contrast-light");
    story.dataset.vxdTheme = light ? "light" : "dark";
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      show(button.dataset.view);
      vscode.postMessage({ type: "view", view: button.dataset.view });
    });
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "update") {
      story.innerHTML = message.html;
      show(message.view);
    }
  });
  new MutationObserver(paper).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (document.body.classList.length > 0) paper();
  vscode.postMessage({ type: "ready" });
})();`;

/** A nonce: 32 letters and digits from a strong random source. */
export function makeNonce(random: (bytes: Uint8Array) => Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(random(new Uint8Array(32)), (byte) => alphabet[byte % alphabet.length]).join(
    "",
  );
}
