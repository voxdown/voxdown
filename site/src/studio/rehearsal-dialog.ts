import { arrangeDialogHeader, countLabel, dialogDisclosure } from "./dialog-layout";
import { type RehearsalCard, type RehearsalProject, prepareRehearsal } from "./rehearsal";

let instance = 0;
export function mountRehearsal(
  host: HTMLElement,
  actions: { current(): { source: string; name: string } },
) {
  const id = ++instance;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const dialog = node("dialog");
  dialog.className = "rehearsal-dialog";
  const title = node("h2", "Rehearsal cue cards");
  title.id = `rehearsal-title-${id}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const close = node("button", "Close");
  close.type = "button";
  const description = node(
    "p",
    "Practice one role from a read-only snapshot. Your speech stays hidden until Reveal. Private notes, title fields and outlines are excluded. Nothing is recorded or saved.",
  );
  const snapshot = node("p");
  const controls = node("div");
  controls.className = "rehearsal-filters";
  const labeled = <T extends HTMLInputElement | HTMLSelectElement>(label: string, input: T) => {
    const wrapper = node("label", `${label} `);
    input.setAttribute("aria-label", label);
    wrapper.append(input);
    controls.append(wrapper);
    return input;
  };
  const roleSearch = labeled("Find a rehearsal role", node("input"));
  roleSearch.type = "search";
  roleSearch.maxLength = 200;
  const roleSelect = labeled("Rehearsal role", node("select"));
  const sceneSearch = labeled("Find a rehearsal scene", node("input"));
  sceneSearch.type = "search";
  sceneSearch.maxLength = 200;
  const sceneSelect = labeled("Rehearsal scene", node("select"));
  const matches = node("p");
  matches.setAttribute("role", "status");
  const progress = node("p");
  progress.setAttribute("role", "status");
  const card = node("section");
  card.className = "rehearsal-card";
  card.tabIndex = 0;
  card.setAttribute("aria-label", "Current rehearsal cue");
  const heading = node("h3");
  const contextHeading = node("h4");
  const context = node("pre");
  context.className = "rehearsal-context";
  context.tabIndex = 0;
  context.setAttribute("aria-label", "Public cue context");
  const dual = node("p");
  const answer = node("pre");
  answer.className = "rehearsal-answer";
  answer.tabIndex = 0;
  answer.setAttribute("aria-label", "Selected role speech");
  card.append(heading, dual, contextHeading, context, answer);
  const nav = node("div");
  nav.className = "rehearsal-navigation";
  const previous = node("button", "Previous cue");
  const reveal = node("button", "Reveal speech");
  const next = node("button", "Next cue");
  const restart = node("button", "Restart these cues");
  for (const button of [previous, reveal, next, restart]) button.type = "button";
  nav.append(previous, reveal, next, restart);
  const help = node(
    "p",
    "Use Previous/Next or the left/right arrow keys while reading a card. Arrow keys keep their normal behavior in filters. Changing a role, scene or cue hides the speech again. Filters show up to 100 choices; narrow the search for later entries. All scenes includes every cue for the selected role.",
  );
  const status = node("p");
  status.setAttribute("role", "status");
  const setup = node("details");
  setup.className = "rehearsal-setup";
  const setupSummary = node("summary", "Choose a role and scene");
  const begin = node("button", "Start rehearsing");
  begin.type = "button";
  begin.onclick = () => {
    if (!cards.length) return;
    setup.open = false;
    card.focus();
    card.scrollIntoView({ block: "nearest" });
  };
  setup.append(
    setupSummary,
    description,
    snapshot,
    controls,
    matches,
    begin,
    dialogDisclosure("Rehearsal controls", help),
  );
  dialog.append(title, close, setup, progress, card, nav, status);
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let project: RehearsalProject | undefined;
  let cards: readonly RehearsalCard[] = [];
  let position = 0;
  let shown = false;
  let opener: HTMLElement | undefined;
  const shorten = (value: string) => (value.length > 120 ? `${value.slice(0, 120)}…` : value);
  const query = (value: string) => value.trim().normalize("NFC").toLocaleLowerCase();
  function renderCard() {
    shown = false;
    answer.textContent = "";
    answer.hidden = true;
    reveal.textContent = "Reveal speech";
    const current = cards[position];
    card.hidden = !current;
    previous.disabled = !current || position === 0;
    next.disabled = !current || position >= cards.length - 1;
    reveal.disabled = restart.disabled = !current;
    begin.disabled = !current;
    if (!current) {
      progress.textContent = "No spoken cues match this selection.";
      heading.textContent =
        contextHeading.textContent =
        context.textContent =
        dual.textContent =
          "";
      return;
    }
    const scene = project?.scenes.find((entry) => entry.id === current.scene);
    progress.textContent = `Cue ${position + 1} of ${cards.length} · source line ${current.line} · ${shorten(scene?.heading ?? "Scene")}. Speech hidden.`;
    heading.textContent = current.cue;
    dual.textContent =
      current.dual === "paired"
        ? "Dual dialogue: these speeches overlap. The other role is shown as simultaneous context, not as an earlier cue."
        : current.dual === "unpaired"
          ? "Unpaired dual-dialogue marker: this speech is shown in source order."
          : "";
    dual.hidden = !dual.textContent;
    contextHeading.textContent =
      current.context?.kind === "simultaneous"
        ? "Simultaneous speech"
        : current.context?.kind === "speech"
          ? "Previous public speech"
          : "Previous public action";
    context.textContent = current.context
      ? `${current.context.cue ? `${current.context.cue}\n` : ""}${current.context.text}`
      : "No preceding public cue in this scene or section. Begin from the scene context above.";
    context.scrollTop = answer.scrollTop = 0;
  }
  function selectCards() {
    const role = project?.roles[Number(roleSelect.value)];
    cards =
      role && roleSelect.value !== ""
        ? (project?.cards(
            role.name,
            sceneSelect.value === "" ? undefined : Number(sceneSelect.value),
          ) ?? [])
        : [];
    position = 0;
    renderCard();
  }
  function scenes() {
    sceneSelect.replaceChildren();
    const all = node("option", "All scenes for this role");
    all.value = "";
    sceneSelect.append(all);
    const role = project?.roles[Number(roleSelect.value)];
    const roleCards = role && roleSelect.value !== "" ? (project?.cards(role.name) ?? []) : [];
    const ids = new Set(roleCards.map((entry) => entry.scene));
    const found = (project?.scenes ?? []).filter(
      (entry) => ids.has(entry.id) && query(entry.heading).includes(query(sceneSearch.value)),
    );
    for (const entry of found.slice(0, 100)) {
      const option = node("option", `${shorten(entry.heading)} · line ${entry.line}`);
      option.value = String(entry.id);
      sceneSelect.append(option);
    }
    // Scene search filters choices, never silently changes the scope of All scenes.
    const roleCount =
      project?.roles.filter((entry) => query(entry.name).includes(query(roleSearch.value)))
        .length ?? 0;
    matches.textContent = `${countLabel(roleCount, "matching role")} · ${countLabel(found.length, "matching scene")}${roleCount > 100 || found.length > 100 ? ". Lists show up to 100; narrow the search for more." : ""}`;
    sceneSelect.disabled = !roleCards.length;
    selectCards();
  }
  function roles() {
    roleSelect.replaceChildren();
    for (const [index, role] of (project?.roles ?? []).entries()) {
      if (!query(role.name).includes(query(roleSearch.value))) continue;
      if (roleSelect.options.length >= 100) break;
      const option = node("option", `${shorten(role.name)} · ${countLabel(role.cues, "cue")}`);
      option.value = String(index);
      roleSelect.append(option);
    }
    roleSelect.disabled = !roleSelect.options.length;
    sceneSearch.value = "";
    scenes();
  }
  roleSearch.oninput = roles;
  roleSelect.onchange = () => {
    sceneSearch.value = "";
    scenes();
  };
  sceneSearch.oninput = scenes;
  sceneSelect.onchange = selectCards;
  reveal.onclick = () => {
    const current = cards[position];
    if (!current) return;
    shown = !shown;
    answer.textContent = shown ? current.text : "";
    answer.hidden = !shown;
    reveal.textContent = shown ? "Hide speech" : "Reveal speech";
    progress.textContent =
      progress.textContent?.replace(
        /Speech (hidden|revealed)\.$/,
        `Speech ${shown ? "revealed" : "hidden"}.`,
      ) ?? "";
  };
  const move = (amount: number) => {
    const target = position + amount;
    if (target < 0 || target >= cards.length) return;
    position = target;
    renderCard();
  };
  previous.onclick = () => move(-1);
  next.onclick = () => move(1);
  restart.onclick = () => {
    position = 0;
    renderCard();
  };
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (
      event.target instanceof Element &&
      event.target.closest("input, select, textarea, [contenteditable]")
    )
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
  function clear() {
    project = undefined;
    cards = [];
    position = 0;
    roleSearch.value = sceneSearch.value = "";
    roleSelect.replaceChildren();
    sceneSelect.replaceChildren();
    roleSelect.disabled = sceneSelect.disabled = true;
    snapshot.textContent = status.textContent = matches.textContent = "";
    renderCard();
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  for (const input of [roleSearch, sceneSearch])
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        dismiss();
      }
    });
  close.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) clear();
  });
  return {
    open() {
      if (dialog.open) return;
      clear();
      setup.open = true;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      try {
        const current = { ...actions.current() };
        project = prepareRehearsal(current.source);
        snapshot.textContent = `Snapshot of ${current.name}. Close and reopen to include later edits.`;
        roles();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "Could not prepare rehearsal. Close and retry.";
      }
      dialog.showModal();
      roleSearch.focus();
    },
    close: dismiss,
  };
}
