/**
 * View › Scene board: a column for each chapter, a card for each scene. A card's name goes to the
 * scene; its state and line are written as a comment under its heading; dragging a card moves the
 * scene before another, or to a chapter's end, and dragging a chapter's head moves the chapter;
 * Alt+↑ and Alt+↓ on a name do the same from the keyboard. Each change is one step to undo. A
 * move draws the board again from the story; a note leaves it as it is, where the writer is.
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
import { countsOf } from "./counts";

export type BoardHost = {
  story(): Story;
  /** Changes made to the story, as one step to undo. */
  change(changes: Array<{ from: number; to: number; insert: string }>, said: string): void;
  goTo(at: number): void;
  readOnly(): boolean;
  /** Said to a screen reader, as a change's words are. */
  announce(said: string): void;
  /** The story's last change taken back, or made again; whether there was one. */
  undo(again: boolean): boolean;
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
    // The story's words, as the status line counts them: a title alone, in no column, too.
    const total = countsOf(story).words;
    const summary = document.querySelector("#board-summary");
    if (summary) {
      // Chapters and scenes named as the status line names them: a story whose chapters hold no
      // scenes has its chapters as the cards.
      const cardsAre = board.some((chapter) => chapter.chapters) ? "chapter" : "scene";
      const chapters = board.filter((chapter) => !chapter.opening).length;
      const cards = board.reduce((sum, chapter) => sum + chapter.scenes.length, 0);
      const counted = [
        ...(chapters ? [`${chapters} ${chapters === 1 ? "chapter" : "chapters"}`] : []),
        `${cards} ${cards === 1 ? cardsAre : `${cardsAre}s`}`,
        words(total),
      ].join(", ");
      summary.textContent = `${counted}. Drag a ${cardsAre}${chapters ? " or a chapter" : ""}, or press Alt+↑ or Alt+↓ on its name, to move it; the text moves with it, and ${navigator.platform.includes("Mac") ? "⌘Z" : "Ctrl+Z"} moves it back.`;
    }
    columns.replaceChildren(...board.map(column));
  };

  /** The board read again after a note, its cards kept where they are, and the writer in them. */
  const reread = () => {
    const before = board.flatMap((chapter) => chapter.scenes).length;
    board = boardOf(host.story());
    const scenes = board.flatMap((chapter) => chapter.scenes);
    const cards = [...columns.querySelectorAll<HTMLElement>(".board-card")];
    if (scenes.length !== before || cards.length !== scenes.length) {
      draw();
      return;
    }
    for (const [index, item] of cards.entries()) {
      const scene = scenes[index] as BoardScene;
      item.dataset.from = String(scene.from);
      if (scene.state) item.dataset.state = scene.state;
      else delete item.dataset.state;
    }
  };

  /** A scene now, as the board last read it: the card's place, not what it was drawn with. */
  const sceneAt = (chapter: number, index: number) => board[chapter]?.scenes[index];

  /** The changes that move a scene one place up or down, into the chapter beside it at its ends. */
  const sceneMove = (chapter: number, index: number, by: -1 | 1) => {
    const scene = sceneAt(chapter, index);
    const own = board[chapter];
    if (!scene || !own) return undefined;
    const story = host.story();
    let at: number | undefined;
    const beside = own.scenes[index + by];
    if (beside) at = by < 0 ? beside.from : beside.to;
    else {
      const next = board[chapter + by];
      if (!next) return undefined;
      at = by < 0 ? next.to : (next.scenes[0]?.from ?? next.to);
    }
    return moveSpan(story.source, scene.from, scene.to, at);
  };

  /** After a move from the keyboard, the moved card's (or chapter's) name has the focus again. */
  const focusName = (name: string, near: number, selector: string) => {
    const found = [...columns.querySelectorAll<HTMLElement>(selector)];
    const order = [near, near - 1, near + 1, ...found.keys()];
    const at = order.find((index) => found[index]?.textContent === name);
    found[at ?? near]?.focus();
  };

  /** Alt+↑ or Alt+↓ on a scene's or a chapter's name. */
  const moveKey = (event: KeyboardEvent): -1 | 1 | undefined => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
    if (event.key === "ArrowUp") return -1;
    if (event.key === "ArrowDown") return 1;
    return undefined;
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
    if (chapter.opening) name.dataset.opening = "";
    name.addEventListener("click", () => {
      dialog.close();
      host.goTo(chapter.from);
    });
    const count = document.createElement("span");
    count.className = "board-words";
    count.textContent = words(chapter.words);
    head.append(name, count);
    if (!chapter.opening && !host.readOnly()) {
      name.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      name.title = "Go to this chapter (Alt+↑ or Alt+↓ moves it)";
      name.addEventListener("keydown", (event) => {
        const by = moveKey(event);
        if (!by) return;
        event.preventDefault();
        const moving = board[index];
        const beside = board[index + by];
        if (!moving || !beside || beside.opening) {
          host.announce(`${chapter.name} is already ${by < 0 ? "the first" : "the last"} chapter.`);
          return;
        }
        const story = host.story();
        const changes = moveSpan(
          story.source,
          moving.from,
          moving.to,
          by < 0 ? beside.from : beside.to,
        );
        if (!changes.length) return;
        host.change(
          changes,
          `Moved ${moving.name} ${by < 0 ? "up, before" : "down, after"} ${beside.name}.`,
        );
        draw();
        const chapters = board.filter((each) => !each.opening).length;
        const first = board.length - chapters;
        focusName(
          moving.name,
          index + by - first,
          ".board-chapter .board-name:not([data-opening])",
        );
      });
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
    list.append(...chapter.scenes.map((scene, place) => card(scene, index, place)));
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
        const at = before ? Number(before) : (board[index]?.to ?? chapter.to);
        const changes = moveSpan(story.source, scene.from, scene.to, at);
        if (changes.length) host.change(changes, `Moved ${scene.name}.`);
        draw();
        return;
      }
      const moving = board[Number(data.getData(COLUMN))];
      const here = board[index];
      if (!moving || !here || moving === here) return;
      const changes = moveSpan(story.source, moving.from, moving.to, here.from);
      if (changes.length) host.change(changes, `Moved ${moving.name}.`);
      draw();
    });
    return section;
  };

  const card = (scene: BoardScene, chapter: number, place: number): HTMLElement => {
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
      host.goTo(sceneAt(chapter, place)?.from ?? scene.from);
    });
    if (!host.readOnly()) {
      name.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      name.title = "Go to this scene (Alt+↑ or Alt+↓ moves it)";
      name.addEventListener("keydown", (event) => {
        const by = moveKey(event);
        if (!by) return;
        event.preventDefault();
        const flat = board.flatMap((each) => each.scenes);
        const now = sceneAt(chapter, place) ?? scene;
        const from = flat.indexOf(now);
        const changes = sceneMove(chapter, place, by);
        if (!changes?.length) {
          host.announce(`${scene.name} is already ${by < 0 ? "the first" : "the last"} scene.`);
          return;
        }
        host.change(changes, `Moved ${scene.name} ${by < 0 ? "up" : "down"}.`);
        draw();
        focusName(scene.name, from + by, ".board-card .board-name");
      });
    }
    const line = document.createElement("textarea");
    line.className = "board-line";
    line.rows = 2;
    line.placeholder = "What happens, in a line";
    line.value = scene.summary;
    line.defaultValue = scene.summary;
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
      // The scene as the story has it now: a note just written is there to be written over.
      const now = sceneAt(chapter, place) ?? scene;
      const comment = aboutComment(
        (state.value || undefined) as SceneState | undefined,
        line.value,
      );
      const written = now.about ? host.story().source.slice(now.about.from, now.about.to) : "";
      if (comment === written) return;
      const change = now.about
        ? comment
          ? { from: now.about.from, to: now.about.to, insert: comment }
          : // The comment's line goes with it.
            { from: now.about.from - 1, to: now.about.to, insert: "" }
        : comment
          ? { from: now.aboutAt, to: now.aboutAt, insert: `\n${comment}` }
          : undefined;
      if (!change) return;
      host.change([change], `${scene.name}: ${comment ? "noted" : "note taken out"}.`);
      // Written: Ctrl+Z in the box now takes back the note in the story, not the box's words.
      line.defaultValue = line.value;
      const shown = (state.value || undefined) as SceneState | undefined;
      if (shown) item.dataset.state = shown;
      else delete item.dataset.state;
      reread();
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
        event.dataTransfer?.setData(CARD, item.dataset.from ?? String(scene.from));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
    }
    return item;
  };

  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) here as in the story, as the board's line says: a move
  // or a note taken back, the board drawn again, the keys on the name they were on.
  dialog.onkeydown = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    // A line being typed undoes its own words.
    const field = event.target;
    if (field instanceof HTMLTextAreaElement && field.value !== field.defaultValue) return;
    event.preventDefault();
    if (host.readOnly()) return;
    const on =
      document.activeElement instanceof HTMLElement && columns.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    const name = on?.classList.contains("board-name") ? on.textContent : undefined;
    const selector = on?.closest(".board-card")
      ? ".board-card .board-name"
      : ".board-chapter .board-name";
    const place = on ? [...columns.querySelectorAll(selector)].indexOf(on) : -1;
    const again = key === "y" || event.shiftKey;
    if (!host.undo(again)) {
      host.announce(
        again
          ? "Nothing taken back here to do again."
          : "Nothing moved or noted here to take back.",
      );
      return;
    }
    draw();
    if (name) focusName(name, place, selector);
  };

  draw();
  if (!dialog.open) dialog.showModal();
}
