/**
 * View › Scene board: a column for each chapter, a card for each scene. A card's name goes to the
 * scene; its state and line are written as a comment under its heading; dragging a card moves the
 * scene before another, or to a chapter's end, and dragging a chapter's head moves the chapter.
 * Each change is one step to undo, and the board is drawn again from the story.
 */
import type { Story } from "voxdown";
import {
  type BoardChapter,
  type BoardScene,
  STATES,
  type SceneState,
  aboutComment,
  boardOf,
  moveSpan,
} from "./board";

export type BoardHost = {
  story(): Story;
  /** Changes made to the story, as one step to undo. */
  change(changes: Array<{ from: number; to: number; insert: string }>, said: string): void;
  goTo(at: number): void;
  readOnly(): boolean;
};

const CARD = "application/x-vxd-scene";
const COLUMN = "application/x-vxd-chapter";
const LABEL: Record<SceneState, string> = {
  idea: "Idea",
  draft: "Draft",
  revised: "Revised",
  done: "Done",
};

const words = (count: number) => `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;

export function openBoard(host: BoardHost): void {
  const dialog = document.querySelector<HTMLDialogElement>("#board");
  const columns = document.querySelector<HTMLElement>("#board-columns");
  if (!dialog || !columns) return;
  let board: BoardChapter[] = [];

  const draw = () => {
    const story = host.story();
    board = boardOf(story);
    const total = board.reduce((sum, chapter) => sum + chapter.words, 0);
    const summary = document.querySelector("#board-summary");
    if (summary) {
      const chapters = board.filter((chapter) => !chapter.opening).length;
      const scenes = board.reduce((sum, chapter) => sum + chapter.scenes.length, 0);
      const counted = [
        ...(chapters ? [`${chapters} ${chapters === 1 ? "chapter" : "chapters"}`] : []),
        `${scenes} ${scenes === 1 ? "scene" : "scenes"}`,
        words(total),
      ].join(", ");
      summary.textContent = `${counted}. Drag a scene${chapters ? " or a chapter" : ""} to move it; the text moves with it, and ${navigator.platform.includes("Mac") ? "⌘Z" : "Ctrl+Z"} moves it back.`;
    }
    columns.replaceChildren(...board.map(column));
  };

  const column = (chapter: BoardChapter, index: number): HTMLElement => {
    const section = document.createElement("section");
    section.className = "board-column";
    section.dataset.index = String(index);
    const head = document.createElement("header");
    head.className = "board-chapter";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "board-name";
    name.textContent = chapter.name;
    name.title = "Go to this chapter";
    name.addEventListener("click", () => {
      dialog.close();
      host.goTo(chapter.from);
    });
    const count = document.createElement("span");
    count.className = "board-words";
    count.textContent = words(chapter.words);
    head.append(name, count);
    if (!chapter.opening && !host.readOnly()) {
      head.draggable = true;
      head.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(COLUMN, String(index));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        section.classList.add("dragging");
      });
      head.addEventListener("dragend", () => section.classList.remove("dragging"));
    }
    const list = document.createElement("ol");
    list.className = "board-cards";
    list.append(...chapter.scenes.map((scene) => card(scene)));
    if (!chapter.scenes.length) {
      const none = document.createElement("li");
      none.className = "board-empty";
      none.textContent = chapter.opening
        ? "What comes before the first chapter: it stays where it is."
        : "No scenes: a scene heading or a break (* * *) starts one.";
      list.append(none);
    }
    section.append(head, list);

    // Dropped on a column: a scene before the card it is over, or at the chapter's end; a
    // chapter before this one.
    const cardBefore = (event: DragEvent) =>
      [...list.querySelectorAll<HTMLElement>(".board-card")].find((each) => {
        const box = each.getBoundingClientRect();
        return event.clientY < box.top + box.height / 2;
      });
    section.addEventListener("dragover", (event) => {
      const types = event.dataTransfer?.types ?? [];
      const isCard = types.includes(CARD);
      if (!isCard && !(types.includes(COLUMN) && !chapter.opening)) return;
      event.preventDefault();
      for (const each of columns.querySelectorAll(".before")) each.classList.remove("before");
      if (isCard) (cardBefore(event) ?? list).classList.add("before");
      else section.classList.add("before");
    });
    section.addEventListener("drop", (event) => {
      const data = event.dataTransfer;
      for (const each of columns.querySelectorAll(".before")) each.classList.remove("before");
      if (!data) return;
      event.preventDefault();
      const story = host.story();
      const card = data.getData(CARD);
      if (card) {
        const scene = board
          .flatMap((each) => each.scenes)
          .find((each) => String(each.from) === card);
        if (!scene) return;
        const before = cardBefore(event)?.dataset.from;
        const at = before ? Number(before) : chapter.to;
        const changes = moveSpan(story.source, scene.from, scene.to, at);
        if (changes.length) host.change(changes, `Moved ${scene.name}.`);
        draw();
        return;
      }
      const moving = board[Number(data.getData(COLUMN))];
      if (!moving || moving === chapter) return;
      const changes = moveSpan(story.source, moving.from, moving.to, chapter.from);
      if (changes.length) host.change(changes, `Moved ${moving.name}.`);
      draw();
    });
    return section;
  };

  const card = (scene: BoardScene): HTMLElement => {
    const item = document.createElement("li");
    item.className = "board-card";
    item.dataset.from = String(scene.from);
    if (scene.state) item.dataset.state = scene.state;
    const name = document.createElement("button");
    name.type = "button";
    name.className = "board-name";
    name.textContent = scene.name;
    name.title = "Go to this scene";
    name.addEventListener("click", () => {
      dialog.close();
      host.goTo(scene.from);
    });
    const line = document.createElement("textarea");
    line.className = "board-line";
    line.rows = 2;
    line.placeholder = "What happens, in a line";
    line.value = scene.summary;
    line.setAttribute("aria-label", `What happens in ${scene.name}`);
    const state = document.createElement("select");
    state.className = "board-state";
    state.setAttribute("aria-label", `How far along ${scene.name} is`);
    for (const value of ["", ...STATES]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value ? LABEL[value as SceneState] : "No state";
      option.selected = value === (scene.state ?? "");
      state.append(option);
    }
    const foot = document.createElement("div");
    foot.className = "board-foot";
    const count = document.createElement("span");
    count.className = "board-words";
    count.textContent = words(scene.words);
    foot.append(state, count);
    // The line and the state, written as the comment under the heading.
    const write = () => {
      const comment = aboutComment(
        (state.value || undefined) as SceneState | undefined,
        line.value,
      );
      const change = scene.about
        ? comment
          ? { from: scene.about.from, to: scene.about.to, insert: comment }
          : // The comment's line goes with it.
            { from: scene.about.from - 1, to: scene.about.to, insert: "" }
        : comment
          ? { from: scene.aboutAt, to: scene.aboutAt, insert: `\n${comment}` }
          : undefined;
      if (!change) return;
      host.change([change], `${scene.name}: ${comment ? "noted" : "note taken out"}.`);
      draw();
    };
    line.addEventListener("change", write);
    line.addEventListener("keydown", (event) => {
      // Enter keeps the line one line, and writes it.
      if (event.key === "Enter") {
        event.preventDefault();
        line.blur();
      }
    });
    state.addEventListener("change", write);
    const readOnly = host.readOnly();
    line.readOnly = readOnly;
    state.disabled = readOnly;
    item.append(name, line, foot);
    if (!readOnly) {
      item.draggable = true;
      // Typing in the line never drags the card.
      for (const field of [line, state]) {
        field.addEventListener("mousedown", () => {
          item.draggable = false;
        });
        field.addEventListener("blur", () => {
          item.draggable = true;
        });
      }
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(CARD, String(scene.from));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
    }
    return item;
  };

  draw();
  if (!dialog.open) dialog.showModal();
}
