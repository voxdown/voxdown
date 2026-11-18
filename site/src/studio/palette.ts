export type StudioCommand = { label: string; shortcut?: string; run(): void; enabled?(): boolean };
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
  const list = document.createElement("div");
  list.className = "command-list";
  const help = document.createElement("p");
  help.textContent =
    "Type to filter, use ↓ to reach results, Enter to run, Escape to close. Ctrl/⌘ K opens Commands.";
  function render() {
    list.replaceChildren();
    const filtered = commands.filter((command) =>
      command.label.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
    );
    for (const command of filtered) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = command.label + (command.shortcut ? ` · ${command.shortcut}` : "");
      button.disabled = command.enabled?.() === false;
      button.onclick = () => {
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
  search.onkeydown = (event) => {
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
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = at + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) search.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  };
  dialog.append(title, close, search, help, list);
  host.append(dialog);
  return {
    open() {
      search.value = "";
      render();
      dialog.showModal();
      search.focus();
    },
  };
}
