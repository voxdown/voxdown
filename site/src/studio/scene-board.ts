import { type SceneCard, type SceneMovePlan, listSceneCards, planSceneMove } from "./scene-edits";
type Snapshot = { source: string; id: string };
export function mountSceneBoard(
  host: HTMLElement,
  actions: {
    current(): Snapshot;
    apply(snapshot: Snapshot, plan: SceneMovePlan): boolean;
    jump(snapshot: Snapshot, line: number): boolean;
  },
) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    return value;
  }
  const short = (text: string) => (text.length > 240 ? `${text.slice(0, 240)}…` : text);
  function button(text: string, run: () => void) {
    const value = node("button", text);
    value.type = "button";
    value.onclick = run;
    return value;
  }
  const dialog = node("dialog");
  dialog.className = "studio-scene-board";
  const title = node("h2", "Scene cards");
  title.id = "scene-board-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const intro = node(
    "p",
    "See the structure, jump to a scene, or preview a move with one-step undo. Notes and synopses after a heading move with that scene, including notes before the next heading. Section headings and front matter stay in place.",
  );
  const filter = node("input");
  filter.type = "search";
  filter.placeholder = "Find a scene or synopsis…";
  filter.setAttribute("aria-label", "Find scene cards");
  const status = node("p");
  status.setAttribute("role", "status");
  const cards = node("div");
  cards.className = "scene-card-grid";
  let offset = 0;
  const previous = button("Previous 50 scenes", () => {
    offset = Math.max(0, offset - 50);
    render();
  });
  const next = button("Next 50 scenes", () => {
    offset += 50;
    render();
  });
  const move = node("fieldset");
  const legend = node("legend", "Move scene");
  const targetFilter = node("input");
  targetFilter.type = "search";
  targetFilter.setAttribute("aria-label", "Find destination scene");
  targetFilter.placeholder = "Find destination scene…";
  const placement = node("select");
  placement.setAttribute("aria-label", "Place scene");
  for (const value of ["before", "after"]) {
    const option = node("option", value);
    option.value = value;
    placement.append(option);
  }
  const target = node("select");
  target.setAttribute("aria-label", "Destination scene");
  const destinationStatus = node("p");
  const preview = button("Preview move", previewMove);
  const result = node("p");
  result.setAttribute("role", "status");
  const order = node("ol");
  const apply = button("Apply scene move", () => {
    if (!plan?.changes.length) return;
    if (actions.apply(snapshot, plan)) dialog.close();
    else stale();
  });
  move.append(
    legend,
    targetFilter,
    placement,
    target,
    destinationStatus,
    preview,
    result,
    order,
    apply,
  );
  const close = button("Close", () => dialog.close());
  dialog.append(title, intro, filter, status, cards, previous, next, move, close);
  host.append(dialog);
  let snapshot: Snapshot;
  let scenes: SceneCard[] = [];
  let moving: number | undefined;
  let plan: SceneMovePlan | undefined;
  function invalidate() {
    plan = undefined;
    apply.disabled = true;
    result.textContent = "";
    order.replaceChildren();
  }
  function stale() {
    invalidate();
    result.textContent =
      "The screenplay changed. Close and reopen Scene cards to work with its current order.";
  }
  function destinations() {
    invalidate();
    const needle = targetFilter.value.toLocaleLowerCase();
    const found = scenes.filter(
      (scene) =>
        scene.index !== moving &&
        `${scene.heading} ${scene.number ?? ""}`.toLocaleLowerCase().includes(needle),
    );
    target.replaceChildren(
      ...found.slice(0, 100).map((scene) => {
        const option = node("option", `${scene.index + 1}. ${short(scene.heading)}`);
        option.value = String(scene.index);
        return option;
      }),
    );
    destinationStatus.textContent =
      found.length > 100
        ? `${found.length} destinations. Showing the first 100; refine your search.`
        : `${found.length} matching destinations.`;
    preview.disabled = !found.length;
  }
  function choose(scene: SceneCard) {
    moving = scene.index;
    legend.textContent = `Move scene ${scene.index + 1}: ${short(scene.heading)}`;
    targetFilter.value = "";
    destinations();
    move.hidden = false;
    targetFilter.focus();
    move.scrollIntoView({ block: "nearest" });
  }
  function render() {
    const needle = filter.value.toLocaleLowerCase();
    const found = scenes.filter((scene) =>
      `${scene.heading} ${scene.synopsis} ${scene.section?.title ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
    );
    cards.replaceChildren();
    status.textContent = found.length
      ? `${found.length} matching scenes. Showing ${offset + 1}–${Math.min(offset + 50, found.length)}.`
      : "No matching scenes. Start a scene with INT., EXT. or a forced .heading.";
    for (const scene of found.slice(offset, offset + 50)) {
      const card = node("article");
      card.append(node("h3", `${scene.index + 1}. ${short(scene.heading)}`));
      if (scene.section) card.append(node("p", short(scene.section.title)));
      if (scene.synopsis)
        card.append(
          node("p", scene.synopsis.slice(0, 1000) + (scene.synopsis.length > 1000 ? "…" : "")),
        );
      card.append(
        node(
          "p",
          `Source line ${scene.line}${scene.number ? ` · explicit scene number ${scene.number}` : ""}`,
        ),
      );
      card.append(
        button("Go to scene", () => {
          if (actions.jump(snapshot, scene.line)) dialog.close();
          else {
            move.hidden = false;
            stale();
          }
        }),
        button("Move this scene…", () => choose(scene)),
      );
      cards.append(card);
    }
    previous.disabled = offset === 0;
    next.disabled = offset + 50 >= found.length;
  }
  function previewMove() {
    invalidate();
    if (moving === undefined || !target.value) return;
    const now = actions.current();
    if (now.id !== snapshot.id || now.source !== snapshot.source) return stale();
    try {
      plan = planSceneMove(
        snapshot.source,
        moving,
        Number(target.value),
        placement.value as "before" | "after",
      );
      result.textContent = plan.changes.length
        ? `Move scene ${moving + 1} to position ${plan.moved.toIndex + 1}. ${plan.warnings.join(" ")} Nearby resulting order:`
        : "This scene is already in that position.";
      const start = Math.max(0, plan.moved.toIndex - 2);
      order.start = start + 1;
      for (const index of plan.order.slice(start, start + 5))
        order.append(node("li", short(scenes[index]?.heading ?? "")));
      apply.disabled = !plan.changes.length;
    } catch (error) {
      result.textContent =
        error instanceof Error ? error.message : "This move could not be prepared.";
    }
  }
  filter.oninput = () => {
    offset = 0;
    render();
  };
  targetFilter.oninput = destinations;
  target.onchange = placement.onchange = invalidate;
  dialog.addEventListener("close", () => {
    scenes = [];
    plan = undefined;
    cards.replaceChildren();
  });
  return {
    open() {
      snapshot = actions.current();
      scenes = listSceneCards(snapshot.source);
      filter.value = "";
      offset = 0;
      moving = undefined;
      move.hidden = true;
      invalidate();
      render();
      dialog.showModal();
      filter.focus();
    },
  };
}
