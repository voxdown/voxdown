import { arrangeDialogHeader, dialogDisclosure, dialogSection } from "./dialog-layout";

// Vite supplies the same build identity to Writer and Studio in this static site.
declare const __WRITER_BUILD__: { commit: string; date: string } | undefined;

const repository = "https://github.com/voxdown/voxdown";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function link(label: string, href: string) {
  const anchor = node("a", label);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function helpDialog(host: HTMLElement, id: string, label: string) {
  const dialog = node("dialog");
  dialog.id = id;
  dialog.className = "studio-help-dialog";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  const title = node("h2", label);
  title.id = `${id}-title`;
  const close = node("button", "Close");
  close.type = "button";
  close.setAttribute("aria-label", `Close ${label}`);
  close.onclick = () => dialog.close();
  arrangeDialogHeader(dialog, title, close);
  let opener: HTMLElement | undefined;
  dialog.addEventListener("close", () => {
    if (opener?.isConnected && !document.querySelector("dialog[open]")) opener.focus();
  });
  host.append(dialog);
  return {
    dialog,
    open() {
      if (dialog.open) return;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      dialog.showModal();
      dialog.scrollTop = 0;
    },
  };
}

/** Studio's application help, separate from the Fountain syntax guide. */
export function mountStudioHelp(host: HTMLElement) {
  const about = helpDialog(host, "studio-about", "About VoxDown Studio");
  const identity = node("div");
  identity.className = "studio-about-identity";
  const icon = node("img");
  icon.src = "../icon.svg";
  icon.alt = "";
  icon.width = icon.height = 40;
  const identityText = node("div");
  identityText.append(node("strong", "VoxDown Studio"));
  const build = typeof __WRITER_BUILD__ === "undefined" ? undefined : __WRITER_BUILD__;
  const version = node(
    "p",
    build
      ? `Experimental · Built ${build.date}${build.commit ? ` (${build.commit})` : ""}`
      : "Experimental",
  );
  version.className = "studio-help-muted";
  identityText.append(version);
  identity.append(icon, identityText);
  const privacy = node("div");
  privacy.className = "studio-help-privacy";
  privacy.append(
    node("strong", "Your screenplay stays on this device."),
    node(
      "p",
      "Editing and export happen in your browser. Studio has no account or server sync. Recovery drafts are kept in this browser, not in a cloud backup.",
    ),
    node(
      "p",
      "Clearing site data, private browsing or browser storage limits can remove recovery drafts. Save your Fountain file or download a Studio backup to keep an independent copy.",
    ),
  );
  const links = node("ul");
  links.className = "studio-help-links";
  for (const [label, href] of [
    ["VoxDown homepage", "../"],
    ["Open VoxDown Writer", "../writer/"],
    ["Source code", repository],
    ["What’s new", `${repository}/blob/main/CHANGELOG.md`],
    ["Report a problem or suggest a feature", `${repository}/issues`],
  ] as const) {
    const item = node("li");
    item.append(link(label, href));
    links.append(item);
  }
  const license = node("p", "Free and open source. Made by Etienne Ackermann. ");
  license.append(link("MIT license", `${repository}/blob/main/LICENSE`));
  const credits = dialogDisclosure(
    "Credits",
    node(
      "p",
      "Built with CodeMirror for editing and pdf-lib for PDF export. The interface uses Recursive and Literata; screenplays use Courier Prime. Thanks to the people who make these open-source tools and typefaces.",
    ),
  );
  about.dialog.append(
    identity,
    node(
      "p",
      "An experimental browser workspace for Fountain screenplays: write in plain text, review the printed pages and export your script. VoxDown Writer remains the home for writing VoxDown stories.",
    ),
    privacy,
    links,
    license,
    credits,
  );

  const shortcuts = helpDialog(host, "studio-shortcuts", "Keyboard shortcuts");
  const apple = /Mac|iPad|iPhone|iPod/.test(`${navigator.platform} ${navigator.userAgent}`);
  const keys = (value: string) =>
    value.replaceAll("Mod", apple ? "⌘" : "Ctrl").replaceAll("Alt", apple ? "Option" : "Alt");
  function group(title: string, entries: readonly (readonly [string, string])[]) {
    const list = node("dl");
    list.className = "studio-shortcut-list";
    for (const [combo, description] of entries) {
      const term = node("dt");
      term.append(node("kbd", keys(combo)));
      list.append(term, node("dd", description));
    }
    return dialogSection(title, list);
  }
  shortcuts.dialog.append(
    node(
      "p",
      "Writing shortcuts work while the screenplay has focus. Commands and this shortcut reference are available throughout the workspace.",
    ),
    group("Workspace", [
      ["Mod+K / Mod+Shift+P", "Find a command"],
      ["Mod+/", "Open keyboard shortcuts"],
      ["F10", "Move focus to the menus"],
      ["Mod+Shift+F", "Toggle Focus writing"],
      ["Mod+\\", "Show or hide page preview"],
      ["Mod+Shift+\\", "Show or hide scenes"],
      ["Mod+Shift+O", "Find a scene"],
      ["F6 / Shift+F6", "Move between visible workspace regions"],
      [
        "Escape",
        "Close a dialog or menu; otherwise leave Focus or return from phone preview to writing",
      ],
      ["Escape, then Tab", "Move focus out of the editor"],
    ]),
    group("Files and search", [
      ["Mod+O", "Open a Fountain file"],
      ["Mod+P", "Export screenplay PDF"],
      ["Mod+S", "Save Fountain; download a copy when direct file saving is unavailable"],
      [
        "Mod+Shift+S",
        "Save Fountain as a new file; download a copy when direct file saving is unavailable",
      ],
      ["Mod+F", "Find and replace in the screenplay"],
    ]),
    group("Writing", [
      ["Mod+Z", "Undo"],
      ["Mod+Shift+Z", "Redo"],
      ["Mod+B", "Bold"],
      ["Mod+I", "Italic"],
      ["Mod+U", "Underline"],
      ["Mod+Shift+M", "Add or remove a private note"],
      ["Mod+Enter", "Start a new screenplay paragraph"],
      ["Ctrl+Space", "Suggest character names or scene headings"],
      ["Alt+PageUp / Alt+PageDown", "Go to the previous or next scene"],
    ]),
    dialogDisclosure(
      "Optional screenplay keys",
      node(
        "p",
        "Turn on “Use screenplay Enter and Tab shortcuts” in View → Preferences to use these.",
      ),
      group("When screenplay keys are on", [
        [
          "Enter",
          "End an action, scene, transition or dialogue paragraph; continue after a cue or parenthetical",
        ],
        ["Shift+Enter", "Continue the same block on a new source line"],
        [
          "Tab / Shift+Tab",
          "Cycle empty templates; after a character, Tab offers a parenthetical first",
        ],
      ]),
      node(
        "p",
        "Existing words are left intact. Completion suggestions keep their own Enter and Tab actions. Escape, then Tab still moves focus out of the editor.",
      ),
    ),
    node(
      "p",
      "For Fountain notation and examples, choose Help → Fountain guide. For an action without a shortcut, use Commands.",
    ),
  );
  return { openAbout: about.open, openShortcuts: shortcuts.open };
}
