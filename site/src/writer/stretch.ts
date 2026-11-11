/**
 * Who says a passage, and how: a small bar over the passage under the pointer, with its speaker
 * and its direction, each opening a picker. The changes are the core's own edits (`setSpeaker`,
 * `setDirection`), which change exactly what they say or nothing: where a change would reach
 * other lines, the writer is told and nothing changes.
 */
import type { EditorView } from "@codemirror/view";
import {
  type Speech,
  type Story,
  type TextChange,
  isName,
  setDirection,
  setSpeaker,
} from "voxdown";

export type Speaker = { handle: string; name: string; color?: string };

export type StretchContext = {
  view: EditorView;
  /** The positioned element the bar and the pickers are placed in. */
  host: HTMLElement;
  /** The story as the editor has it now. */
  story: () => Story;
  /** Everyone who can be given a passage, the narrator first. */
  speakers: () => Speaker[];
  /** Applies an edit; with no changes, says why in `declined`. True if anything changed. */
  apply: (changes: TextChange[], declined: string) => boolean;
};

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** The passage at `at` in a paragraph: a speech with words, the narrator's included. */
export function speechAt(story: Story, at: number): Speech | undefined {
  for (const block of story.blocks) {
    if (block.kind !== "paragraph" || at < block.range.from || at > block.range.to) continue;
    for (const line of block.lines) {
      if (at < line.range.from || at > line.range.to) continue;
      let found: Speech | undefined;
      for (const item of line.items) {
        if (item.kind !== "speech" || !hasWords(item.text)) continue;
        if (item.range.from <= at && at <= item.range.to) found ??= item;
        // A passage that starts here wins over one that ends here.
        if (item.range.from === at) found = item;
      }
      if (found) return found;
    }
  }
  return undefined;
}

/** The passage a character mark gives its speaker to. */
export function speechOfMark(story: Story, markFrom: number): Speech | undefined {
  for (const block of story.blocks) {
    if (block.kind !== "paragraph" || markFrom < block.range.from || markFrom > block.range.to)
      continue;
    for (const line of block.lines) {
      for (const item of line.items) {
        if (item.kind === "speech" && item.mark?.range.from === markFrom && hasWords(item.text))
          return item;
      }
    }
  }
  return undefined;
}

export class StretchTools {
  private readonly bar: HTMLElement;
  private readonly popover: HTMLElement;
  /** Where the passage the bar is for starts, to find it again in a fresh story. */
  private shown: number | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private restTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: StretchContext) {
    const { view, host } = context;
    this.bar = document.createElement("div");
    this.bar.className = "stretch-tools";
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", "This passage");
    this.bar.hidden = true;
    this.bar.innerHTML =
      '<button type="button" class="who" title="Who says this"><span class="dot"></span><span class="who-name"></span><span class="caret" aria-hidden="true">▾</span></button><button type="button" class="how" title="How it is said"></button>';
    this.popover = document.createElement("div");
    this.popover.className = "popover";
    this.popover.setAttribute("role", "dialog");
    this.popover.hidden = true;
    host.append(this.bar, this.popover);

    this.part(".who").addEventListener("click", () => {
      if (this.shown !== null) this.openSpeaker(this.shown, this.bar);
    });
    this.part(".how").addEventListener("click", () => {
      if (this.shown !== null) this.openDirection(this.shown, this.bar);
    });
    view.contentDOM.addEventListener("mousemove", (event) => this.hover(event));
    // A touch has no hover: a tap on a passage brings its bar at once.
    view.contentDOM.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch" || !this.popover.hidden) return;
      const at = this.context.view.posAtCoords({ x: event.clientX, y: event.clientY });
      const speech = at === null ? undefined : speechAt(this.context.story(), at);
      if (speech) this.show(speech);
    });
    view.contentDOM.addEventListener("mouseleave", () => {
      clearTimeout(this.restTimer);
      this.hideSoon();
    });
    this.bar.addEventListener("mouseenter", () => clearTimeout(this.hideTimer));
    this.bar.addEventListener("mouseleave", () => this.hideSoon());
    view.scrollDOM.addEventListener("scroll", () => this.hide(), { passive: true });
    document.addEventListener("pointerdown", (event) => {
      if (this.popover.hidden) return;
      const target = event.target as Node;
      if (!this.popover.contains(target) && !this.bar.contains(target)) this.closePopover(false);
    });
    // Escape closes a picker wherever the focus is; leaving it for elsewhere on the page too.
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || this.popover.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        this.closePopover(true);
      },
      true,
    );
    this.popover.addEventListener("focusout", (event) => {
      const next = event.relatedTarget as Node | null;
      if (next && !this.popover.contains(next) && !this.bar.contains(next))
        this.closePopover(false);
    });
    // Up and down move between the names, as in any list of choices.
    this.popover.addEventListener("keydown", (event) => {
      const choices = [...this.popover.querySelectorAll<HTMLElement>(".speaker-choice")];
      const at = choices.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      const to =
        event.key === "ArrowDown"
          ? at + 1
          : event.key === "ArrowUp"
            ? at - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? choices.length - 1
                : null;
      if (to === null) return;
      event.preventDefault();
      if (to >= choices.length)
        this.popover.querySelector<HTMLElement>(".new-speaker input")?.focus();
      else choices[Math.max(0, to)]?.focus();
    });
  }

  /** Takes the bar and any picker away: the text changed, or the page moved. */
  hide(): void {
    clearTimeout(this.hideTimer);
    this.bar.hidden = true;
    this.shown = null;
    if (!this.popover.hidden) this.closePopover(false);
  }

  /** The speaker picker for the passage at `at`, below `anchor` or the cursor. */
  openSpeaker(at: number, anchor?: Element): void {
    const story = this.context.story();
    const speech = speechAt(story, at);
    if (!speech) {
      this.nothingHere();
      return;
    }
    const current = speech.speaker;
    const list = document.createElement("ul");
    list.className = "speaker-list";
    for (const speaker of this.context.speakers()) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "speaker-choice";
      if (speaker.handle.toLowerCase() === current.toLowerCase())
        button.setAttribute("aria-current", "true");
      button.innerHTML = '<span class="dot"></span><span class="handle"></span><small></small>';
      (button.firstElementChild as HTMLElement).style.setProperty(
        "--c",
        speaker.color ?? "var(--quiet)",
      );
      (button.children[1] as HTMLElement).textContent = speaker.handle;
      (button.lastElementChild as HTMLElement).textContent =
        speaker.name !== speaker.handle ? speaker.name : "";
      button.addEventListener("click", () => this.giveTo(speech.range.from, speaker.handle));
      item.append(button);
      list.append(item);
    }
    const form = document.createElement("form");
    form.className = "new-speaker";
    form.innerHTML =
      '<input type="text" name="name" placeholder="Someone new" aria-label="A new character’s name" autocomplete="off" spellcheck="false"><button type="submit" class="button">Give</button>';
    const input = form.querySelector("input") as HTMLInputElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!isName(name)) {
        input.setCustomValidity("A name is one word: letters, digits, - and _.");
        input.reportValidity();
        return;
      }
      this.giveTo(speech.range.from, name);
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    this.showPopover("Who says this?", [list, form], anchor, at);
    (
      list.querySelector<HTMLElement>("[aria-current]") ?? list.querySelector<HTMLElement>("button")
    )?.focus();
  }

  /** The direction picker for the passage at `at`. */
  openDirection(at: number, anchor?: Element): void {
    const story = this.context.story();
    const speech = speechAt(story, at);
    if (!speech) {
      this.nothingHere();
      return;
    }
    const used = new Set<string>();
    for (const block of story.blocks)
      if (block.kind === "paragraph")
        for (const line of block.lines)
          for (const item of line.items)
            if (item.kind === "speech" && item.ownDirection) used.add(item.ownDirection);
    const form = document.createElement("form");
    form.className = "direction-form";
    const listId = "vxd-directions";
    form.innerHTML = `<input type="text" name="how" list="${listId}" placeholder="whispering, gently, with a sigh…" aria-label="How it is said" autocomplete="off"><datalist id="${listId}"></datalist><div class="popover-actions"><button type="button" class="button quiet remove">Take it out</button><button type="submit" class="button primary">Set</button></div>`;
    const input = form.querySelector("input") as HTMLInputElement;
    input.value = speech.ownDirection ?? "";
    (form.querySelector("datalist") as HTMLElement).replaceChildren(
      ...[...used].sort().map((direction) => {
        const option = document.createElement("option");
        option.value = direction;
        return option;
      }),
    );
    const remove = form.querySelector(".remove") as HTMLButtonElement;
    remove.hidden = !speech.ownDirection;
    const set = (direction: string | null) => {
      const fresh = this.context.story();
      const target = speechAt(fresh, speech.range.from);
      if (!target) {
        this.closePopover(true);
        return;
      }
      let changes: TextChange[];
      try {
        changes = setDirection(fresh, target, direction);
      } catch (error) {
        this.context.apply([], error instanceof Error ? error.message : "That can’t be set here.");
        return;
      }
      const done = this.context.apply(
        changes,
        direction
          ? `“${direction}” can’t be set here without changing how other lines are said, so nothing changed.`
          : "This direction can’t be taken out without changing other lines, so nothing changed.",
      );
      if (done || changes.length === 0) this.closePopover(true);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const direction = input.value.trim();
      if (direction === (speech.ownDirection ?? "")) return this.closePopover(true);
      set(direction || null);
    });
    remove.addEventListener("click", () => set(null));
    this.showPopover("How is it said?", [form], anchor, at);
    input.focus();
    input.select();
  }

  private giveTo(from: number, name: string): void {
    const fresh = this.context.story();
    const target = speechAt(fresh, from);
    if (!target) {
      this.closePopover(true);
      return;
    }
    if (target.speaker.toLowerCase() === name.toLowerCase()) {
      this.closePopover(true);
      return;
    }
    let changes: TextChange[];
    try {
      changes = setSpeaker(fresh, target, name);
    } catch (error) {
      this.context.apply(
        [],
        error instanceof Error ? error.message : `${name} can’t be given this.`,
      );
      this.closePopover(true);
      return;
    }
    this.context.apply(
      changes,
      `Giving this to ${name} would change who says other lines too, so nothing changed. You can write the mark by hand.`,
    );
    this.closePopover(true);
  }

  private nothingHere(): void {
    this.context.apply([], "Put the cursor in a passage first: a line of speech or narration.");
  }

  /**
   * The pointer resting on a passage brings its bar, a moment later: passing over lines on the
   * way somewhere else doesn't.
   */
  private hover(event: MouseEvent): void {
    if (event.buttons || !this.popover.hidden) return;
    const { clientX: x, clientY: y } = event;
    clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => {
      const at = this.context.view.posAtCoords({ x, y });
      const speech = at === null ? undefined : speechAt(this.context.story(), at);
      if (!speech) {
        this.hideSoon();
        return;
      }
      clearTimeout(this.hideTimer);
      if (this.shown === speech.range.from && !this.bar.hidden) return;
      this.show(speech);
    }, 250);
  }

  private hideSoon(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.popover.hidden) {
        this.bar.hidden = true;
        this.shown = null;
      }
    }, 350);
  }

  /** The bar over a passage's start, or its mark's when the mark is on its line. */
  private show(speech: Speech): void {
    const { view, host } = this.context;
    const markFrom = speech.mark?.range.from;
    const sameLine =
      markFrom !== undefined &&
      view.state.doc.lineAt(markFrom).number === view.state.doc.lineAt(speech.range.from).number;
    const anchor = sameLine ? (markFrom as number) : speech.range.from;
    const coords = view.coordsAtPos(anchor, 1);
    if (!coords) return;
    this.shown = speech.range.from;
    const who = this.part(".who");
    const color = this.context
      .speakers()
      .find((speaker) => speaker.handle.toLowerCase() === speech.speaker.toLowerCase())?.color;
    (who.querySelector(".dot") as HTMLElement).style.setProperty("--c", color ?? "var(--quiet)");
    (who.querySelector(".who-name") as HTMLElement).textContent = speech.speaker;
    const how = this.part(".how");
    how.textContent = speech.ownDirection ? `(${speech.ownDirection})` : "+ how";
    how.classList.toggle("set", Boolean(speech.ownDirection));
    this.bar.hidden = false;
    const box = host.getBoundingClientRect();
    const height = this.bar.offsetHeight;
    const top = coords.top - box.top - height - 3;
    this.bar.style.left = `${Math.max(4, coords.left - box.left - 4)}px`;
    this.bar.style.top = `${top < 4 ? coords.bottom - box.top + 3 : top}px`;
  }

  private showPopover(title: string, content: HTMLElement[], anchor?: Element, at?: number): void {
    const { view, host } = this.context;
    const heading = document.createElement("p");
    heading.className = "popover-title";
    heading.textContent = title;
    this.popover.replaceChildren(heading, ...content);
    this.popover.setAttribute("aria-label", title);
    this.popover.hidden = false;
    const box = host.getBoundingClientRect();
    const place = anchor?.getBoundingClientRect() ??
      (at !== undefined ? view.coordsAtPos(at) : null) ?? {
        left: box.left + 40,
        bottom: box.top + 40,
      };
    const width = this.popover.offsetWidth;
    const left = Math.min(Math.max(4, place.left - box.left), box.width - width - 8);
    this.popover.style.left = `${left}px`;
    const below = place.bottom - box.top + 4;
    const height = this.popover.offsetHeight;
    this.popover.style.top = `${below + height > box.height - 8 ? Math.max(4, below - height - 40) : below}px`;
  }

  private closePopover(focusEditor: boolean): void {
    this.popover.hidden = true;
    this.popover.replaceChildren();
    if (focusEditor) this.context.view.focus();
  }

  private part(selector: string): HTMLElement {
    return this.bar.querySelector(selector) as HTMLElement;
  }
}
