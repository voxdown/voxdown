export type StudioCommand = {
  label: string;
  category?: string;
  keywords?: string;
  shortcut?: string;
  run(): void;
  enabled?(): boolean;
};
// Stable task order; adding a tool must not reshuffle the whole menu.
const categoryOrder = [
  "Files and recovery",
  "Writing space",
  "Navigate",
  "Plan and revise",
  "Export and perform",
  "Learn and inspect",
];
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function mountPalette(host: HTMLElement, commands: StudioCommand[]) {
  const present = [...new Set(commands.map((command) => command.category ?? "Other"))];
  const groups = [
    ...categoryOrder.filter((group) => present.includes(group)),
    ...present.filter((group) => !categoryOrder.includes(group)),
  ];
  const dialog = document.createElement("dialog");
  dialog.className = "studio-command-palette";
  dialog.setAttribute("aria-labelledby", "commands-title");
  const header = document.createElement("header");
  header.className = "palette-header";
  const title = document.createElement("h2");
  title.id = "commands-title";
  title.textContent = "Commands";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  header.append(title, close);
  const controls = document.createElement("div");
  controls.className = "palette-controls";
  const search = document.createElement("input");
  search.type = "search";
  search.setAttribute("aria-label", "Find a command");
  search.placeholder = "Find a command…";
  const categoryLabel = document.createElement("label");
  categoryLabel.textContent = "Show commands";
  const category = document.createElement("select");
  for (const value of ["", ...groups]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "All tools";
    category.append(option);
  }
  categoryLabel.append(category);
  const count = document.createElement("p");
  count.setAttribute("role", "status");
  count.className = "palette-count";
  const filterRow = document.createElement("div");
  filterRow.className = "palette-filter-row";
  filterRow.append(categoryLabel, count);
  controls.append(search, filterRow);
  const list = document.createElement("div");
  list.className = "command-list";
  const help = document.createElement("p");
  help.className = "palette-help";
  help.textContent = "↑ ↓ Navigate · Enter Run · Esc Close";
  help.id = "palette-keyboard-help";
  search.setAttribute("aria-describedby", help.id);
  const ordered = groups.flatMap((group) =>
    commands.filter((command) => (command.category ?? "Other") === group),
  );
  function render() {
    list.replaceChildren();
    const query = normalize(search.value);
    const words = query.split(" ").filter(Boolean);
    const filtered = ordered.filter((command) => {
      const group = command.category ?? "Other";
      const text = `${command.label} ${group} ${command.keywords ?? ""}`.toLowerCase();
      return (
        (!category.value || category.value === group) && words.every((word) => text.includes(word))
      );
    });
    // Names outrank incidental category/keyword matches. Keep each category together,
    // ordered by its strongest result, so Enter runs the best match without repeated headings.
    const rank = (command: StudioCommand) => {
      if (!query) return 0;
      const label = normalize(command.label);
      if (label === query) return 0;
      if (label.startsWith(query)) return 1;
      if (words.every((word) => label.includes(word))) return 2;
      return 3;
    };
    const resultGroups = groups
      .map((group) => ({
        group,
        commands: filtered
          .filter((command) => (command.category ?? "Other") === group)
          .sort((a, b) => rank(a) - rank(b)),
      }))
      .filter((group) => group.commands.length > 0)
      .sort((a, b) => {
        const firstA = a.commands[0];
        const firstB = b.commands[0];
        return firstA && firstB ? rank(firstA) - rank(firstB) : 0;
      });
    const results = resultGroups.flatMap((group) => group.commands);
    const unavailable = filtered.filter((command) => command.enabled?.() === false).length;
    count.textContent = `${filtered.length} ${filtered.length === 1 ? "command" : "commands"}${unavailable ? ` · ${unavailable} unavailable` : ""}.`;
    let previousGroup = "";
    for (const command of results) {
      const group = command.category ?? "Other";
      if (group !== previousGroup) {
        const heading = document.createElement("h3");
        heading.textContent = group;
        list.append(heading);
        previousGroup = group;
      }
      const button = document.createElement("button");
      button.type = "button";
      const label = document.createElement("span");
      label.textContent = command.label;
      button.append(label);
      if (command.shortcut) {
        const shortcut = document.createElement("kbd");
        shortcut.textContent = command.shortcut.replaceAll(
          "Mod",
          /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl",
        );
        shortcut.setAttribute("aria-hidden", "true");
        button.append(shortcut);
        button.setAttribute("aria-description", shortcut.textContent);
      }
      button.disabled = command.enabled?.() === false;
      button.onclick = () => {
        if (command.enabled?.() === false) {
          render();
          search.focus();
          return;
        }
        dialog.close();
        command.run();
      };
      list.append(button);
    }
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.textContent = "No matching commands.";
      list.append(empty);
    }
  }
  search.oninput = () => {
    render();
    list.scrollTop = 0;
  };
  category.onchange = () => {
    render();
    list.scrollTop = 0;
  };
  search.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.click();
    }
  };
  list.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = at + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) search.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  };
  dialog.append(header, controls, list, help);
  host.append(dialog);
  return {
    open(initialCategory?: string) {
      if (dialog.open) return;
      search.value = "";
      category.value = initialCategory && groups.includes(initialCategory) ? initialCategory : "";
      render();
      dialog.showModal();
      search.focus();
      list.scrollTop = 0;
    },
  };
}
