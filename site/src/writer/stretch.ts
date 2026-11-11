/**
 * Who says a passage, and how: a small bar over the passage under the pointer, with its speaker
 * and its direction, each opening a picker. The changes are the core's own edits (`setSpeaker`,
 * `setDirection`), which change exactly what they say or nothing: where a change would reach
 * other lines, the writer is told and nothing changes.
 */
import { ChangeSet, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  type Speech,
  type Story,
  type TextChange,
  applyChanges,
  isName,
  parse,
  setDirection,
  setFullName,
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
  /** Whether resting the pointer on a passage brings its bar (View › The bar over a passage). */
  onHover?: () => boolean;
  /**
   * The story as read already, or undefined while it waits to be read again after typing: the
   * pointer passing by never makes the page read a long story at once.
   */
  fresh?: () => Story | undefined;
};

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/**
 * Two sets of changes made one after the other, as one set on the text before both: the second's
 * places are in the text the first makes.
 */
export function composed(
  source: string,
  first: readonly TextChange[],
  second: readonly TextChange[],
): TextChange[] {
  const a = ChangeSet.of(
    first.map(({ from, to, insert }) => ({ from, to, insert })),
    source.length,
  );
  const b = ChangeSet.of(
    second.map(({ from, to, insert }) => ({ from, to, insert })),
    a.newLength,
  );
  const out: TextChange[] = [];
  a.compose(b).iterChanges((from, to, _fromB, _toB, inserted) => {
    out.push({ from, to, insert: inserted.toString() });
  });
  return out;
}

/** Where `at` is once the changes are made: moved by those before it. */
export function mapped(changes: readonly TextChange[], at: number): number {
  let shift = 0;
  for (const change of [...changes].sort((a, b) => a.from - b.from)) {
    if (change.to <= at) shift += change.insert.length - (change.to - change.from);
    else if (change.from < at) return change.from + shift + change.insert.length;
  }
  return at + shift;
}

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

/**
 * The passage the cursor means: the one it is in; else the one whose mark or direction it is on
 * (`@King (less grandly) “…”`, the cursor anywhere from the `@` to the quote); else, at the start
 * of a line, its first; else the next in the line, or the last before it.
 */
export function passageNear(story: Story, at: number): Speech | undefined {
  const inside = speechAt(story, at);
  if (inside) return inside;
  for (const block of story.blocks) {
    if (block.kind !== "paragraph" || at < block.range.from || at > block.range.to) continue;
    for (const line of block.lines) {
      if (at < line.range.from || at > line.range.to) continue;
      const said = line.items.filter(
        (item): item is Speech => item.kind === "speech" && hasWords(item.text),
      );
      const marked = said.find((speech) => {
        const from = Math.min(
          speech.mark?.range.from ?? speech.range.from,
          speech.directionMark?.range.from ?? speech.range.from,
        );
        return from <= at && at <= speech.range.from;
      });
      return marked ?? said.find((speech) => speech.range.from >= at) ?? said.at(-1);
    }
  }
  return undefined;
}

/** Words that tag a quote with who says it. */
const SAYING =
  "said|says|asked|asks|replied|replies|whispered|whispers|shouted|shouts|cried|cries|called|calls|answered|answers|muttered|mutters|murmured|murmurs|added|adds|sighed|sighs|laughed|laughs|snapped|snaps|exclaimed|exclaims|yelled|yells|demanded|demands|began|begins|continued|continues|went on|goes on|told|tells";

/**
 * The name a dialogue tag gives a quote, if it gives one: `“…” asked Mara`, `“…” Mara said`,
 * `Mara said, “…”`. A pronoun says nothing of who.
 */
export function dialogueTag(before: string, after: string): string | undefined {
  const name = "(\\p{Lu}[\\p{L}’'-]*)";
  const behind = new RegExp(
    `^[\\s,.!?—–-]*(?:(?:${SAYING})\\s+(?:the\\s+)?${name}|${name}\\s+(?:${SAYING})\\b)`,
    "u",
  ).exec(after);
  const ahead = new RegExp(`${name}\\s+(?:${SAYING})[\\s,:]*$`, "u").exec(before);
  const found = behind?.[1] ?? behind?.[2] ?? ahead?.[1];
  if (!found || /^(?:He|She|They|It|I|We|You|The|His|Her|Their)$/u.test(found)) return undefined;
  return found;
}

/** A quote in a stretch of the source: where it opens and closes, and its words. */
export type Quote = { from: number; to: number; text: string };

/** The first quote between `from` and `to`, in the source. */
export function firstQuote(source: string, from: number, to: number): Quote | undefined {
  const found = /[“"«„「『‘]([^”"»“」』’\n]+)[”"»“」』’]/u.exec(source.slice(from, to));
  if (!found || !/[\p{L}\p{N}]/u.test(found[1] ?? "")) return undefined;
  return {
    from: from + found.index,
    to: from + found.index + found[0].length,
    text: found[1] as string,
  };
}

/**
 * The next quote after `after` that no one is marked to say, so that the narrator reads it with
 * the words around it; round to the first.
 */
export function nextNarratedQuote(story: Story, after: number): Quote | undefined {
  const narrator = story.meta.narrator.toLowerCase();
  const quotes: Quote[] = [];
  for (const block of story.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines)
      for (const item of line.items) {
        if (item.kind !== "speech" || item.quoted || item.speaker.toLowerCase() !== narrator)
          continue;
        const quote = firstQuote(story.source, item.range.from, item.range.to);
        if (quote) quotes.push(quote);
      }
  }
  return quotes.find((quote) => quote.from > after) ?? quotes[0];
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
    // The page scrolled: the bar goes, but a picker open stays, moving with its words while they
    // are in view, so nothing typed in it is lost.
    let scrolled = view.scrollDOM.scrollTop;
    view.scrollDOM.addEventListener(
      "scroll",
      () => {
        const by = view.scrollDOM.scrollTop - scrolled;
        scrolled = view.scrollDOM.scrollTop;
        if (this.popover.hidden) return this.hide();
        clearTimeout(this.hideTimer);
        this.bar.hidden = true;
        this.shown = null;
        const room = this.context.host.clientHeight - this.popover.offsetHeight - 4;
        const top = Number.parseFloat(this.popover.style.top) || 0;
        this.popover.style.top = `${Math.min(Math.max(4, top - by), Math.max(4, room))}px`;
      },
      { passive: true },
    );
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
    // Up and down move between the names showing, as in any list of choices; a letter typed on
    // one goes to the box that finds them.
    this.popover.addEventListener("keydown", (event) => {
      const choices = [...this.popover.querySelectorAll<HTMLElement>(".speaker-choice")].filter(
        (choice) => !choice.parentElement?.hidden,
      );
      const at = choices.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      const box = this.popover.querySelector<HTMLInputElement>(".new-speaker input");
      if (box && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        box.focus();
        box.value += event.key;
        box.dispatchEvent(new Event("input"));
        return;
      }
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
      if (to < 0) box?.focus();
      else choices[Math.min(to, choices.length - 1)]?.focus();
    });
  }

  /** The page's layout moved (the front matter opened, say): the bar, no longer over its words, goes. */
  moved(): void {
    if (!this.popover.hidden || this.bar.hidden) return;
    this.bar.hidden = true;
    this.shown = null;
  }

  /** Takes the bar and any picker away: the text changed. The keyboard goes back to the text. */
  hide(): void {
    clearTimeout(this.hideTimer);
    this.bar.hidden = true;
    this.shown = null;
    if (!this.popover.hidden) this.closePopover(this.popover.contains(document.activeElement));
  }

  /**
   * Brings the passage at `at` into view first when it isn't, and then runs `open`: a picker is
   * placed by its words, and must never open off the page.
   */
  private revealThen(at: number, anchor: Element | undefined, open: () => void): boolean {
    if (anchor) return false;
    const { view } = this.context;
    const box = view.scrollDOM.getBoundingClientRect();
    const place = view.coordsAtPos(at);
    if (place && place.top >= box.top && place.bottom <= box.bottom) return false;
    view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
    requestAnimationFrame(() => requestAnimationFrame(open));
    return true;
  }

  /** The speaker picker for the passage at `at`, below `anchor` or the cursor. */
  openSpeaker(at: number, anchor?: Element): void {
    if (this.revealThen(at, anchor, () => this.openSpeaker(at, anchor))) return;
    const story = this.context.story();
    const speech = speechAt(story, at);
    if (!speech) {
      this.nothingHere();
      return;
    }
    const current = speech.speaker;
    const list = document.createElement("ul");
    list.className = "speaker-list";
    // The name the dialogue tag gives, first: one of the cast, or someone new. A quote in the
    // narrator's words is the one its tag is about.
    const source = story.source;
    const quote =
      speech.speaker.toLowerCase() === story.meta.narrator.toLowerCase() && !speech.quoted
        ? firstQuote(source, speech.range.from, speech.range.to)
        : undefined;
    const quoteFrom = quote?.from ?? speech.mark?.range.from ?? speech.range.from;
    const quoteTo = quote?.to ?? speech.range.to;
    const lineStart = source.lastIndexOf("\n", quoteFrom - 1) + 1;
    const lineEnd = source.indexOf("\n", quoteTo);
    const tag = dialogueTag(
      source.slice(lineStart, quoteFrom),
      source.slice(quoteTo, lineEnd < 0 ? source.length : lineEnd),
    );
    const speakers = this.context.speakers();
    const tagged = tag
      ? speakers.find(
          (speaker) =>
            speaker.handle.toLowerCase() === tag.toLowerCase() ||
            speaker.name.toLowerCase().split(/\s+/).includes(tag.toLowerCase()),
        )
      : undefined;
    const ordered = tagged
      ? [tagged, ...speakers.filter((speaker) => speaker !== tagged)]
      : speakers;
    if (tag && !tagged && isName(tag) && tag.toLowerCase() !== current.toLowerCase())
      ordered.unshift({ handle: tag, name: "named in the tag: someone new" });
    for (const speaker of ordered) {
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
        speaker === tagged
          ? `${speaker.name !== speaker.handle ? `${speaker.name} · ` : ""}named in the tag`
          : speaker.name !== speaker.handle
            ? speaker.name
            : "";
      if (speaker === tagged || (tag && speaker.handle === tag && !tagged))
        button.dataset.tagged = "";
      button.dataset.handle = speaker.handle;
      button.addEventListener("click", () => this.giveTo(speech.range.from, speaker.handle));
      item.append(button);
      list.append(item);
    }
    const form = document.createElement("form");
    form.className = "new-speaker";
    form.innerHTML =
      '<input type="text" name="name" placeholder="Find, or a new name" aria-label="Find a character, or name someone new" autocomplete="off" spellcheck="false"><button type="submit" class="button">Give</button>';
    const input = form.querySelector("input") as HTMLInputElement;
    const choices = [...list.querySelectorAll<HTMLElement>(".speaker-choice")];
    const shown = () => choices.filter((choice) => !choice.parentElement?.hidden);
    // Typing narrows the list to the names that hold what is typed.
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      const typed = input.value.trim().toLowerCase();
      for (const choice of choices)
        (choice.parentElement as HTMLElement).hidden =
          typed !== "" && !(choice.textContent ?? "").toLowerCase().includes(typed);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        (event.key === "ArrowDown" ? shown()[0] : shown().at(-1))?.focus();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      // A name in the list, typed in full or the only one left showing; else someone new.
      const exact = choices.find(
        (choice) => choice.dataset.handle?.toLowerCase() === name.toLowerCase(),
      );
      const left = shown();
      const pick = exact ?? (name && left.length === 1 ? left[0] : undefined);
      if (pick?.dataset.handle) {
        this.giveTo(speech.range.from, pick.dataset.handle);
        return;
      }
      if (!isName(name)) {
        input.setCustomValidity("A name is one word: letters, digits, - and _.");
        input.reportValidity();
        return;
      }
      this.giveTo(speech.range.from, name);
    });
    // The box above the list: up from the list's top goes to it.
    this.showPopover("Who says this?", [form, list], anchor, at);
    (
      (current.toLowerCase() === story.meta.narrator.toLowerCase()
        ? list.querySelector<HTMLElement>("[data-tagged]")
        : null) ??
      list.querySelector<HTMLElement>("[aria-current]") ??
      list.querySelector<HTMLElement>("button")
    )?.focus({ preventScroll: true });
  }

  /** The direction picker for the passage at `at`. */
  openDirection(at: number, anchor?: Element): void {
    if (this.revealThen(at, anchor, () => this.openDirection(at, anchor))) return;
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
    input.focus({ preventScroll: true });
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
      // Someone new, in a story with a cast: added to it in the same step, so the name raises
      // no warning.
      const known = fresh.cast.some((member) => member.handle.toLowerCase() === name.toLowerCase());
      if (changes.length && !known && fresh.cast.length > 0) {
        const given = applyChanges(fresh.source, changes);
        const cast = setFullName(parse(given), name, name);
        if (cast.length) changes = composed(fresh.source, changes, cast);
      }
    } catch (error) {
      this.context.apply(
        [],
        error instanceof Error ? error.message : `${name} can’t be given this.`,
      );
      this.closePopover(true);
      return;
    }
    const done = this.context.apply(
      changes,
      `Giving this to ${name} would change who says other lines too, so nothing changed. You can write the mark by hand.`,
    );
    this.closePopover(true);
    // A cursor left before the new mark goes into the passage, so the next key (Ctrl+J, a word)
    // is about it.
    const { view } = this.context;
    const words = mapped(changes, target.textRange.from);
    if (done && view.state.selection.main.empty && view.state.selection.main.head < words)
      view.dispatch({ selection: EditorSelection.cursor(Math.min(words, view.state.doc.length)) });
  }

  private nothingHere(): void {
    this.context.apply([], "Put the cursor in a passage first: a line of speech or narration.");
  }

  /**
   * The pointer resting on a passage brings its bar, a moment later: passing over lines on the
   * way somewhere else doesn't.
   */
  private hover(event: MouseEvent): void {
    if (event.buttons || !this.popover.hidden || this.context.onHover?.() === false) return;
    const { clientX: x, clientY: y } = event;
    clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => {
      // A warning shows its own tip there: the bar would cover it.
      if (document.elementFromPoint(x, y)?.closest(".vxd-warning")) {
        this.hideSoon();
        return;
      }
      const at = this.context.view.posAtCoords({ x, y });
      const story = this.context.fresh ? this.context.fresh() : this.context.story();
      const speech = at === null || !story ? undefined : speechAt(story, at);
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
    const top = below + height > box.height - 8 ? below - height - 40 : below;
    // Always within the manuscript, whatever the words' place.
    this.popover.style.top = `${Math.min(Math.max(4, top), Math.max(4, box.height - height - 4))}px`;
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
