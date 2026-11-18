export type StudioCommand = {
  label: string;
  category?: string;
  keywords?: string;
  shortcut?: string;
  run(): void;
  enabled?(): boolean;
};
export function mountPalette(host: HTMLElement, commands: StudioCommand[]) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "commands-title");
  const title = document.createElement("h2");
  title.id = "commands-title";
  title.textContent = "Commands";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  const search = document.createElement("input");
  search.type = "search";
  search.setAttribute("aria-label", "Find a command");
  search.placeholder = "Find a command…";
  const categoryLabel = document.createElement("label");
  categoryLabel.textContent = "Show commands ";
  const category = document.createElement("select");
  for (const value of ["", ...new Set(commands.map((command) => command.category ?? "Other"))]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "All tools";
    category.append(option);
  }
  categoryLabel.append(category);
  const count = document.createElement("p");
  count.setAttribute("role", "status");
  const list = document.createElement("div");
  list.className = "command-list";
  const help = document.createElement("p");
  help.textContent =
    "Type to filter, use ↓ to reach results, Enter to run, Escape to close. Ctrl/⌘ K opens Commands.";
  const groups = [...new Set(commands.map((command) => command.category ?? "Other"))];
  const ordered = groups.flatMap((group) =>
    commands.filter((command) => (command.category ?? "Other") === group),
  );
  function render() {
    list.replaceChildren();
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = ordered.filter((command) => {
      const group = command.category ?? "Other";
      const text = `${command.label} ${group} ${command.keywords ?? ""}`.toLowerCase();
      return (
        (!category.value || category.value === group) && words.every((word) => text.includes(word))
      );
    });
    count.textContent = `${filtered.length} commands${filtered.some((command) => command.enabled?.() === false) ? "; unavailable tools are disabled" : ""}.`;
    let previousGroup = "";
    for (const command of filtered) {
      const group = command.category ?? "Other";
      if (group !== previousGroup) {
        const heading = document.createElement("h3");
        heading.textContent = group;
        list.append(heading);
        previousGroup = group;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = command.label + (command.shortcut ? ` · ${command.shortcut}` : "");
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
  search.oninput = render;
  category.onchange = render;
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
  dialog.append(title, close, search, categoryLabel, count, help, list);
  host.append(dialog);
  return {
    open() {
      if (dialog.open) return;
      search.value = "";
      category.value = "";
      render();
      dialog.showModal();
      search.focus();
    },
  };
}
