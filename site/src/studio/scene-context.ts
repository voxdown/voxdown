/** A source-linked inspector. Source updates belong to the deferred parse cycle;
 * select() is cheap and safe to call for every caret movement. */
import { type FountainDocument, parseFountain } from "./fountain";
import { screenplayInsights } from "./insights";
import { assertUnambiguousOmissions } from "./public-source";
import {
  MAX_SCENE_SYNOPSIS,
  type SceneCard,
  type SceneEditPlan,
  planSceneSynopsis,
} from "./scene-edits";
import { readSource } from "./source";

export interface SceneContextSnapshot {
  source: string;
  id: string;
}
export interface SceneRoleSelection {
  role: string;
  /** One-based source line, stable within the supplied exact snapshot. */
  sceneLine: number;
}
export interface SceneContextActions {
  current(): SceneContextSnapshot;
  apply(snapshot: SceneContextSnapshot, plan: SceneEditPlan): boolean;
  jump(snapshot: SceneContextSnapshot, line: number): boolean;
  rehearse?(snapshot: SceneContextSnapshot, selection: SceneRoleSelection): void;
  sides?(snapshot: SceneContextSnapshot, selection: SceneRoleSelection): void;
}
type ContextScene = Pick<SceneCard, "index" | "line" | "heading" | "synopsis">;
function scenesOf(document: FountainDocument): ContextScene[] {
  const scenes: ContextScene[] = [];
  let active: ContextScene | undefined;
  for (const element of document.elements) {
    if (element.kind === "section") active = undefined;
    else if (element.kind === "scene") {
      active = { index: scenes.length, line: element.line, heading: element.text, synopsis: "" };
      scenes.push(active);
    } else if (active && element.kind === "synopsis") {
      active.synopsis += `${active.synopsis ? "\n" : ""}${element.text}`;
    }
  }
  return scenes;
}
const same = (a: SceneContextSnapshot | undefined, b: SceneContextSnapshot) =>
  a?.id === b.id && a.source === b.source;

export function mountSceneContext(host: HTMLElement, actions: SceneContextActions) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const value = document.createElement(tag);
    if (text) value.textContent = text;
    return value;
  }
  function button(text: string, action: () => void) {
    const value = node("button", text);
    value.type = "button";
    value.onclick = action;
    return value;
  }
  const root = node("details");
  root.className = "studio-scene-context";
  root.open = true;
  const summary = node("summary", "Current scene");
  const body = node("div");
  body.className = "scene-context-body";
  const heading = node("p");
  heading.className = "scene-context-heading";
  const position = node("span");
  const previous = button("Previous", () => navigate(-1));
  previous.setAttribute("aria-label", "Previous scene in inspector");
  const next = button("Next", () => navigate(1));
  next.setAttribute("aria-label", "Next scene in inspector");
  const navigation = node("div");
  navigation.className = "scene-context-navigation";
  navigation.append(previous, position, next);
  const synopsis = node("p");
  synopsis.className = "scene-context-synopsis";
  const edit = button("Add synopsis…", beginEdit);
  const form = node("div");
  form.hidden = true;
  const label = node("label", "Scene synopsis");
  const input = node("textarea");
  input.rows = 4;
  input.maxLength = MAX_SCENE_SYNOPSIS;
  label.append(input);
  const help = node("p", "Saved in Fountain; left out of screenplay exports.");
  help.className = "scene-context-help";
  const save = button("Save synopsis", saveEdit);
  const cancel = button("Cancel", cancelEdit);
  const editActions = node("div");
  editActions.className = "scene-context-actions";
  editActions.append(save, cancel);
  form.append(label, help, editActions);
  const cast = node("div");
  cast.className = "scene-context-cast";
  const roleLabel = node("label", "In this scene");
  const role = node("select");
  roleLabel.append(role);
  const roleFilter = node("input");
  roleFilter.type = "search";
  roleFilter.placeholder = "Find a character…";
  roleFilter.setAttribute("aria-label", "Find a character in this scene");
  const roleActions = node("div");
  roleActions.className = "scene-context-actions";
  const rehearse = button("Rehearse", () => perform(actions.rehearse));
  const sides = button("Actor sides…", () => perform(actions.sides));
  rehearse.hidden = !actions.rehearse;
  sides.hidden = !actions.sides;
  roleActions.append(rehearse, sides);
  cast.append(roleFilter, roleLabel, roleActions);
  const status = node("p");
  status.className = "scene-context-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  body.append(heading, navigation, synopsis, edit, form, cast, status);
  root.append(summary, body);
  host.append(root);

  let snapshot: SceneContextSnapshot | undefined;
  let scenes: ContextScene[] = [];
  let roles = new Map<number, string[]>();
  let line = 1;
  let selected = -1;
  let renderingKey = "";
  let editing: { snapshot: SceneContextSnapshot; scene: ContextScene } | undefined;
  let safeRoles = true;
  function message(text: string) {
    status.textContent = text;
    status.hidden = !text;
  }
  function fresh(captured = snapshot): captured is SceneContextSnapshot {
    if (captured && same(captured, actions.current())) return true;
    message(
      "The screenplay changed. Wait for the current scene to update, or cancel this synopsis edit.",
    );
    return false;
  }
  function sceneAt(currentLine: number) {
    let low = 0;
    let high = scenes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((scenes[middle]?.line ?? Number.POSITIVE_INFINITY) <= currentLine) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }
  function renderRoles() {
    const currentRole = role.value;
    const names = roles.get(selected) ?? [];
    const query = roleFilter.value.trim().toLocaleLowerCase();
    const matches = names.filter((name) => name.toLocaleLowerCase().includes(query)).slice(0, 100);
    role.replaceChildren(...matches.map((name) => node("option", name)));
    if (matches.includes(currentRole)) role.value = currentRole;
    role.disabled = !matches.length;
    rehearse.disabled = sides.disabled = !matches.length;
    roleFilter.hidden = names.length <= 100;
    cast.hidden = !safeRoles || !names.length || Boolean(editing);
  }
  roleFilter.oninput = renderRoles;
  function render(force = false) {
    if (editing) {
      save.disabled = !same(editing.snapshot, actions.current());
      if (save.disabled) {
        message(
          "The screenplay changed. Your synopsis text is kept here. Copy it if needed, then Cancel to follow the current scene.",
        );
      }
      return;
    }
    selected = sceneAt(line);
    const scene = scenes[selected];
    const key = `${selected}:${snapshot?.id ?? ""}`;
    if (!force && key === renderingKey) return;
    renderingKey = key;
    heading.textContent = scene?.heading ?? "Place the cursor in a scene to see its details.";
    position.textContent = scene ? `${selected + 1} of ${scenes.length}` : "";
    navigation.hidden = !scene;
    previous.disabled = selected <= 0;
    next.disabled = selected < 0 || selected >= scenes.length - 1;
    synopsis.textContent = scene?.synopsis || "No synopsis yet.";
    synopsis.hidden = !scene;
    edit.hidden = !scene;
    edit.textContent = scene?.synopsis ? "Edit synopsis…" : "Add synopsis…";
    form.hidden = true;
    roleFilter.value = "";
    renderRoles();
    message("");
  }
  function navigate(delta: number) {
    const scene = scenes[selected + delta];
    if (!scene || !snapshot || !fresh(snapshot)) return;
    if (!actions.jump(snapshot, scene.line)) return fresh();
    line = scene.line;
    render();
  }
  function beginEdit() {
    const scene = scenes[selected];
    if (!scene || !snapshot || !fresh(snapshot)) return;
    try {
      // Refuse private fragments and dispersed blocks before displaying an
      // editable reconstruction. The helper rechecks again on Save.
      planSceneSynopsis(snapshot.source, selected, scene.synopsis);
      editing = { snapshot: { ...snapshot }, scene };
      input.value = scene.synopsis;
      save.disabled = false;
      form.hidden = false;
      edit.hidden = synopsis.hidden = navigation.hidden = cast.hidden = true;
      message("");
      input.focus();
    } catch (error) {
      message(error instanceof Error ? error.message : "Edit this synopsis in the screenplay.");
    }
  }
  function cancelEdit() {
    editing = undefined;
    render(true);
    edit.focus();
  }
  function saveEdit() {
    const captured = editing;
    if (!captured || !fresh(captured.snapshot)) return;
    try {
      const plan = planSceneSynopsis(captured.snapshot.source, captured.scene.index, input.value);
      if (plan.changes.length && !actions.apply(captured.snapshot, plan)) {
        message(
          "This synopsis could not be saved. Your text is kept here; copy it before cancelling.",
        );
        return;
      }
      editing = undefined;
      update(actions.current(), captured.scene.line);
      render(true);
      message(
        plan.changes.length
          ? "Synopsis saved. Undo restores the previous text."
          : "Synopsis unchanged.",
      );
      edit.focus();
    } catch (error) {
      message(error instanceof Error ? error.message : "The synopsis could not be saved.");
    }
  }
  function perform(action: SceneContextActions["rehearse"]) {
    const scene = scenes[selected];
    if (!action || !scene || !role.value || !snapshot || !fresh(snapshot)) return;
    action(snapshot, { role: role.value, sceneLine: scene.line });
  }
  /** When supplied, parsed must describe readSource(current.source).normalized,
   * as the Studio worker does. Never pass a previous source revision. */
  function update(current: SceneContextSnapshot, currentLine: number, parsed?: FountainDocument) {
    line = currentLine;
    if (!same(snapshot, current)) {
      snapshot = { ...current };
      try {
        const parsedSource = parsed ? readSource(current.source).normalized : current.source;
        const document = parsed ?? parseFountain(parsedSource);
        scenes = scenesOf(document);
        safeRoles = document.warnings.length === 0;
        roles = new Map();
        try {
          assertUnambiguousOmissions(parsedSource, document);
        } catch {
          safeRoles = false;
        }
        if (safeRoles) {
          for (const character of screenplayInsights(document, parsedSource).characters) {
            const used = new Set<number>();
            for (const cueLine of character.dialogueLines) {
              const index = sceneAt(cueLine);
              if (index < 0 || used.has(index)) continue;
              used.add(index);
              const names = roles.get(index) ?? [];
              names.push(character.name);
              roles.set(index, names);
            }
          }
        }
      } catch {
        scenes = [];
        roles = new Map();
        safeRoles = false;
      }
      render(true);
    } else render();
  }
  render(true);
  return {
    element: root,
    update,
    select(currentLine: number) {
      line = currentLine;
      render();
    },
    destroy() {
      root.remove();
    },
  };
}
