import type { StudioCommand } from "./palette";

/** Disclosure menus keep native buttons and Tab navigation, with optional arrow navigation. */
export function mountWorkspaceMenus(commands: StudioCommand[]) {
  type Entry = { id: string; label?: string } | { command: string; label?: string };
  const definitions: { name: string; groups: Entry[][] }[] = [
    {
      name: "file",
      groups: [
        [
          { id: "new", label: "New screenplay" },
          { id: "open", label: "Open Fountain…" },
          { command: "Import Final Draft XML (FDX)", label: "Import Final Draft…" },
        ],
        [{ id: "save-file" }, { command: "Save Fountain as…" }, { command: "Download Fountain" }],
        [
          { id: "recent", label: "Recovery and snapshots…" },
          { command: "Portable backup and restore", label: "Backup and restore…" },
        ],
        [
          { command: "Export PDF", label: "Export PDF…" },
          { command: "Export Final Draft XML (FDX)", label: "Export Final Draft…" },
          { command: "Actor sides PDF", label: "Export actor sides…" },
          { command: "Adapt screenplay to VoxDown", label: "Adapt to VoxDown…" },
        ],
      ],
    },
    {
      name: "view",
      groups: [
        [
          { command: "Focus writing", label: "Focus writing" },
          { command: "Toggle scene outline", label: "Scenes panel" },
          { command: "Toggle page preview", label: "Preview panel" },
          { command: "Toggle live margins", label: "Toggle live margins" },
          { command: "Open text reference beside screenplay", label: "Text reference…" },
        ],
        [
          { id: "preferences", label: "Preferences…" },
          { command: "Prepare Studio for offline use", label: "Offline availability…" },
          { command: "Storage and backups", label: "Storage and backups…" },
        ],
      ],
    },
    {
      name: "tools",
      groups: [
        [
          { id: "workbench", label: "Writing statistics…" },
          { command: "Scene cards and rearrangement", label: "Scene cards…" },
          { command: "Private notes", label: "Private notes…" },
        ],
        [
          { command: "Character dialogue", label: "Character dialogue…" },
          { command: "Rename a character", label: "Rename character…" },
          { command: "Locations and location rename", label: "Locations…" },
        ],
        [
          { command: "Scoped find and replace", label: "Find and replace…" },
          { command: "Compare with local Fountain file", label: "Compare drafts…" },
          { command: "Number scenes", label: "Scene numbering…" },
        ],
        [
          { command: "Scene and cast breakdown", label: "Scene and cast breakdown…" },
          { command: "Rehearsal cue cards", label: "Rehearsal…" },
          { command: "Source diagnostics", label: "Source diagnostics…" },
        ],
      ],
    },
    {
      name: "help",
      groups: [
        [
          { id: "help", label: "Fountain guide…" },
          { command: "Practice Fountain step by step", label: "Guided practice…" },
          { id: "example", label: "Try a short screenplay…" },
        ],
      ],
    },
  ];
  definitions.push({
    name: "preview",
    groups: [
      [
        { id: "caret-page", label: "Show caret on page" },
        { id: "page-source", label: "Go to page source" },
      ],
    ],
  });
  let active: { button: HTMLButtonElement; panel: HTMLElement } | undefined;
  const sync: (() => void)[] = [];
  function close(restore = false) {
    if (!active) return;
    const { button, panel } = active;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    active = undefined;
    if (restore) button.focus();
  }
  for (const definition of definitions) {
    const trigger = document.getElementById(`${definition.name}-menu`) as HTMLButtonElement;
    const panel = document.createElement("div");
    panel.id = `${definition.name}-dropdown`;
    panel.className = "workspace-dropdown";
    panel.hidden = true;
    panel.setAttribute(
      "aria-label",
      `${definition.name[0]?.toUpperCase()}${definition.name.slice(1)} actions`,
    );
    definition.groups.forEach((entries, index) => {
      if (index) panel.append(document.createElement("hr"));
      for (const entry of entries) {
        let button: HTMLButtonElement;
        if ("id" in entry) {
          button = document.getElementById(entry.id) as HTMLButtonElement;
        } else {
          const command = commands.find((candidate) => candidate.label === entry.command);
          if (!command) throw new Error(`Unknown Studio command: ${entry.command}`);
          button = document.createElement("button");
          button.type = "button";
          button.textContent = entry.label ?? command.label;
          const update = () => {
            button.disabled = command.enabled?.() === false;
            const state = (
              {
                "Focus writing": ["focus-mode", "aria-pressed"],
                "Toggle scene outline": ["outline-toggle", "aria-expanded"],
                "Toggle page preview": ["preview-toggle", "aria-pressed"],
              } as Record<string, [string, string]>
            )[command.label];
            if (state)
              button.setAttribute(
                "aria-pressed",
                document.getElementById(state[0])?.getAttribute(state[1]) ?? "false",
              );
            if (command.label === "Toggle live margins")
              button.setAttribute(
                "aria-pressed",
                String((document.getElementById("margins") as HTMLInputElement).checked),
              );
            if (button.hasAttribute("aria-pressed") && !button.querySelector(".menu-check")) {
              const mark = document.createElement("span");
              mark.className = "menu-check";
              mark.setAttribute("aria-hidden", "true");
              mark.textContent = "✓";
              button.append(mark);
            }
          };
          sync.push(update);
          button.addEventListener("click", () => {
            if (command.enabled?.() !== false) command.run();
          });
        }
        if (entry.label) button.textContent = entry.label;
        panel.append(button);
      }
    });
    document.body.append(panel);
    // Restore the trigger before a command opens a dialog so its return-focus target remains visible.
    panel.addEventListener(
      "click",
      (event) => {
        if ((event.target as HTMLElement).closest("button:not(:disabled)")) close(true);
      },
      true,
    );
    function open() {
      close();
      for (const update of sync) update();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      const rect = trigger.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.maxHeight = `${Math.max(100, innerHeight - rect.bottom - 22)}px`;
      active = { button: trigger, panel };
      panel.querySelector<HTMLButtonElement>("button:not(:disabled):not([hidden])")?.focus();
    }
    trigger.addEventListener("click", () => (active?.button === trigger ? close() : open()));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open();
        panel.querySelector<HTMLButtonElement>("button:not(:disabled):not([hidden])")?.focus();
      }
    });
    panel.addEventListener("keydown", (event) => {
      const available = [
        ...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not([hidden])"),
      ];
      if (
        event.key === "Tab" &&
        (event.shiftKey
          ? document.activeElement === available[0]
          : document.activeElement === available.at(-1))
      ) {
        event.preventDefault();
        close();
        if (event.shiftKey) trigger.focus();
        else {
          const nav = [...document.querySelectorAll<HTMLButtonElement>(".workspace-menus button")];
          (definition.name === "preview"
            ? document.getElementById("page-scroll")
            : (nav[nav.indexOf(trigger) + 1] ?? document.getElementById("commands"))
          )?.focus();
        }
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [
        ...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not([hidden])"),
      ];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (
      active &&
      !active.panel.contains(event.target as Node) &&
      !active.button.contains(event.target as Node)
    )
      close();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && active) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    if (
      active &&
      !active.panel.contains(event.target as Node) &&
      !active.button.contains(event.target as Node)
    )
      close();
  });
  window.addEventListener("resize", () => close());
  return { close };
}
