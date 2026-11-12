/**
 * Who says a passage, and how: a small bar over the passage under the pointer, with its speaker
 * and its direction, each opening a picker. The changes are the core's own edits (`setSpeaker`,
 * `setDirection`), which change exactly what they say or nothing: where a change would reach
 * other lines, the writer is told and nothing changes.
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  type Speech,
  type Story,
  type TextChange,
  applyChanges,
  castMemberNamed,
  isName,
  lines,
  parse,
  quotesOf,
  setDirection,
  setDirectionWithin,
  setFullName,
  setSpeaker,
  setSpeakerWithin,
  taggedName,
} from "voxdown";
import { composed, mapped } from "./changes";
import { type Scope, wholeScope } from "./local";
import { withoutSpareMarks } from "./spare-marks";
import { type Passage, type Wanting, nextWanting, wantingQuotes } from "./story-data";

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
   * The passage at a place, as the story was last read (on the page or in a worker), or undefined
   * while it waits to be read again: the pointer passing by never makes the page read a long story.
   */
  passageAt?: (at: number) => Passage | undefined;
  /**
   * A long book's passage worked on in its paragraph alone (local.ts): the scope for an edit at
   * `at`, or undefined to read the whole story.
   */
  scope?: (at: number) => Scope | undefined;
  /** A word to the writer: a quote that went along with the one given, say. */
  notice?: (message: string, action?: { label: string; run: () => void }) => void;
  /** Said to a screen reader: what an edit did, which a sighted writer sees in the text. */
  announce?: (message: string) => void;
  /** The directions the story uses, for the picker's list. */
  directions?: () => string[];
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

/** Every quote with words between `from` and `to`, in the source, in order. */
export function quotesIn(source: string, from: number, to: number): Quote[] {
  const quotes: Quote[] = [];
  for (const found of source.slice(from, to).matchAll(/[“"«„「『‘]([^”"»“」』’\n]+)[”"»“」』’]/gu))
    if (/[\p{L}\p{N}]/u.test(found[1] ?? ""))
      quotes.push({
        from: from + found.index,
        to: from + found.index + found[0].length,
        text: found[1] as string,
      });
  return quotes;
}

/** The first quote between `from` and `to`, in the source. */
export function firstQuote(source: string, from: number, to: number): Quote | undefined {
  return quotesIn(source, from, to)[0];
}

/** The next quote after `after` that wants a speaker (story-data.ts), round to the first. */
export function nextNarratedQuote(story: Story, after: number): Wanting | undefined {
  return nextWanting(wantingQuotes(story), after);
}

/**
 * Gives one quote in the narrator's words (not the first) to `name`: a mark straight before it,
 * and someone new joins the cast. Read back: the quote is theirs, and every word heard is heard as
 * before; else no changes.
 */
export function giveQuote(story: Story, quote: Quote, name: string): TextChange[] {
  let changes: TextChange[] = [{ from: quote.from, to: quote.from, insert: `@${name} ` }];
  const known = story.cast.some((member) => member.handle.toLowerCase() === name.toLowerCase());
  const hasCast = story.cast.length > 0 || "cast" in (story.frontMatter?.data ?? {});
  if (!known && hasCast) {
    const cast = setFullName(parse(applyChanges(story.source, changes)), name, name);
    if (cast.length) changes = composed(story.source, changes, cast);
  }
  const after = parse(applyChanges(story.source, changes));
  const at = mapped(changes, quote.from) + 1;
  const given = after.blocks
    .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
    .flatMap((line) => line.items)
    .find(
      (item): item is Speech =>
        item.kind === "speech" && item.quoted && item.range.from <= at && at <= item.range.to,
    );
  // The words heard, quote marks aside, the same before and after.
  const heard = (of: Story) =>
    lines(of)
      .map((line) => line.text)
      .join(" ")
      .replace(/[“”"«»„‚‘’「」『』]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  return given &&
    given.speaker.toLowerCase() === name.toLowerCase() &&
    heard(after) === heard(story)
    ? changes
    : [];
}

/** A speech as the bar needs it. */
export function asPassage(speech: Speech): Passage {
  return {
    from: speech.range.from,
    to: speech.range.to,
    speaker: speech.speaker,
    ownDirection: speech.ownDirection,
    ...(speech.mark ? { markFrom: speech.mark.range.from } : {}),
  };
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
      const speech = at === null ? undefined : this.passageAt(at);
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
  openSpeaker(at: number, anchor?: Element, cursor?: number): void {
    if (this.revealThen(at, anchor, () => this.openSpeaker(at, anchor, cursor))) return;
    const scope = this.scopeAt(at);
    const story = scope.story;
    const speech = speechAt(story, scope.at(at));
    const inScope = cursor === undefined ? undefined : scope.at(cursor);
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
    // The quote the cursor is in, or else the first.
    const quotes =
      speech.speaker.toLowerCase() === story.meta.narrator.toLowerCase() && !speech.quoted
        ? quotesIn(source, speech.range.from, speech.range.to)
        : [];
    const quote =
      quotes.find(
        (found) => inScope !== undefined && found.from <= inScope && inScope <= found.to,
      ) ?? quotes[0];
    // A quote after the first in the narrator's words is given on its own; the first goes as the
    // core gives a passage. Given in the editor's places.
    const later =
      quote && quote !== quotes[0]
        ? { ...quote, from: scope.toDoc(quote.from), to: scope.toDoc(quote.to) }
        : undefined;
    const passageFrom = scope.toDoc(speech.range.from);
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
      button.addEventListener("click", () => this.giveTo(passageFrom, speaker.handle, later));
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
        this.giveTo(passageFrom, pick.dataset.handle, later);
        return;
      }
      if (!isName(name)) {
        input.setCustomValidity("A name is one word: letters, digits, - and _.");
        input.reportValidity();
        return;
      }
      this.giveTo(passageFrom, name, later);
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
    const scope = this.scopeAt(at);
    const story = scope.story;
    const speech = speechAt(story, scope.at(at));
    if (!speech) {
      this.nothingHere();
      return;
    }
    const passageFrom = scope.toDoc(speech.range.from);
    const used = new Set<string>(this.context.directions?.() ?? []);
    if (!this.context.directions)
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
    // A few words selected: their own direction, from nothing.
    const selected = this.selectedPart(scope, speech);
    if (selected) input.value = "";
    remove.hidden = !speech.ownDirection || selected !== undefined;
    const set = (direction: string | null) => {
      const now = this.scopeAt(passageFrom);
      const fresh = now.story;
      const target = speechAt(fresh, now.at(passageFrom));
      if (!target) {
        this.closePopover(true);
        return;
      }
      const part = this.selectedPart(now, target);
      let changes: TextChange[];
      try {
        changes = now.back(
          withoutSpareMarks(
            fresh,
            part
              ? setDirectionWithin(fresh, part.from, part.to, direction)
              : setDirection(fresh, target, direction),
          ),
        );
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
      if (done)
        this.context.announce?.(
          direction ? `Said ${direction} now.` : "The direction is taken out.",
        );
      // A speech broken by its tag: the quote after the tag carries the direction on (§5.6), so
      // the core kept it as it was with `@()`. Said, with the other way one click away.
      const kept = changes.filter((change) => /@\(\)\s?/.test(change.insert));
      if (done && direction && kept.length && !part && this.context.notice) {
        const { view } = this.context;
        this.context.notice(
          `“${direction}” is this quote’s alone: the one after its tag is said as it was (@()).`,
          {
            label: "Both quotes",
            run: () => {
              const line = view.state.doc.lineAt(view.state.selection.main.head);
              const at = line.text.indexOf("@() ");
              if (at < 0) return;
              this.context.apply(
                [{ from: line.from + at, to: line.from + at + 4, insert: "" }],
                "The quote after the tag can’t be said so too here.",
              );
            },
          },
        );
      }
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

  /** The story an edit at `at` is worked out on: its paragraph alone in a long book, else all of it. */
  private scopeAt(at: number): Scope {
    return this.context.scope?.(at) ?? wholeScope(this.context.story());
  }

  /**
   * The words selected inside `target`, on one line, when they are not all of its words: an edit
   * of those words alone, as italics would be. Undefined with no selection, or one elsewhere.
   */
  private selectedPart(scope: Scope, target: Speech): { from: number; to: number } | undefined {
    const { from, to } = this.context.view.state.selection.main;
    if (from === to) return undefined;
    if (
      this.context.view.state.doc.lineAt(from).number !==
      this.context.view.state.doc.lineAt(to).number
    )
      return undefined;
    const start = scope.at(from);
    const end = scope.at(to);
    if (start < target.range.from || end > target.range.to) return undefined;
    // All of its words: the whole stretch, as with no selection.
    const words = scope.story.source.slice(target.textRange.from, target.textRange.to);
    const chosen = scope.story.source.slice(
      Math.max(start, target.textRange.from),
      Math.min(end, target.textRange.to),
    );
    if (chosen.trim() === words.trim()) return undefined;
    return { from: start, to: end };
  }

  /**
   * Quotes the changes give to someone along with the one given, by the format's rule that a
   * quote later on a line carries on the speech before it (§5.6): said, so it isn't a surprise.
   */
  private sayCarried(
    story: Story,
    changes: readonly TextChange[],
    given: number,
    name: string,
  ): void {
    if (!this.context.notice || changes.length === 0) return;
    const before = quotesOf(story);
    const after = quotesOf(parse(applyChanges(story.source, changes)));
    if (after.length !== before.length) return;
    const went = before.filter((quote, index) => {
      const now = after[index];
      return (
        now !== undefined &&
        !(quote.from <= given && given < quote.to) &&
        (now.speaker.toLowerCase() !== quote.speaker.toLowerCase() ||
          now.narrated !== quote.narrated)
      );
    });
    const [first] = went;
    if (!first) return;
    // Another paragraph of the same speech: its quote runs on until a closing mark (§5.7).
    const at = before.find((quote) => quote.from <= given && given < quote.to);
    if (at && went.some((quote) => quote.line !== at.line)) {
      this.context.notice(
        `This speech runs over more than one paragraph (no closing quote mark ends it before the next), so all of it goes to ${name}. To give only part of it, close the quote where that part ends.`,
      );
      return;
    }
    const words = first.text.length > 30 ? `${first.text.slice(0, 29)}…` : first.text;
    this.context.notice(
      went.length === 1
        ? `“${words}” goes to ${name} too: a quote later on a line carries on the speech before it. Ctrl+K there gives it to someone else.`
        : `${went.length} more quotes on that line go to ${name} too: a quote later on a line carries on the speech before it. Ctrl+K on one gives it to someone else.`,
    );
  }

  private giveTo(from: number, name: string, quote?: Quote): void {
    const scope = this.scopeAt(from);
    const fresh = scope.story;
    const target = speechAt(fresh, scope.at(from));
    if (!target) {
      this.closePopover(true);
      return;
    }
    if (quote) {
      const scoped = { ...quote, from: scope.at(quote.from), to: scope.at(quote.to) };
      const changes = giveQuote(fresh, scoped, name);
      const done = this.context.apply(
        scope.back(changes),
        `This quote can’t be given to ${name} without changing who says other lines, so nothing changed.`,
      );
      if (done) {
        this.context.announce?.(`${name} says this quote now.`);
        this.sayCarried(fresh, changes, scoped.from + 1, name);
      }
      this.closePopover(true);
      return;
    }
    const part = this.selectedPart(scope, target);
    if (part && target.quoted) {
      this.context.notice?.(
        `A quote is said by one voice: to give ${name} part of it, close the quote where that part begins and open another.`,
      );
      this.closePopover(true);
      return;
    }
    if (!part && target.speaker.toLowerCase() === name.toLowerCase()) {
      this.closePopover(true);
      return;
    }
    let changes: TextChange[];
    try {
      changes = withoutSpareMarks(
        fresh,
        part ? setSpeakerWithin(fresh, part.from, part.to, name) : setSpeaker(fresh, target, name),
      );
      // Someone new, in a story with a cast: added to it in the same step, so the name raises
      // no warning.
      const known = fresh.cast.some((member) => member.handle.toLowerCase() === name.toLowerCase());
      // A cast, even one with no one in it yet (a new story's `cast:`).
      const hasCast = fresh.cast.length > 0 || "cast" in (fresh.frontMatter?.data ?? {});
      if (changes.length && !known && hasCast) {
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
    const docChanges = scope.back(changes);
    const done = this.context.apply(
      docChanges,
      `Giving this to ${name} would change who says other lines too, so nothing changed. You can write the mark by hand.`,
    );
    if (done) {
      this.context.announce?.(`${name} says this now.`);
      // The quote given: the first in the passage, when it is narration that holds quotes.
      const first = quotesOf(fresh).find((found) => found.from >= target.range.from);
      this.sayCarried(fresh, changes, (first?.from ?? target.range.from) + 1, name);
    }
    this.closePopover(true);
    // A cursor left before the new mark goes into the passage, so the next key (Ctrl+J, a word)
    // is about it.
    const { view } = this.context;
    const words = mapped(docChanges, scope.toDoc(target.textRange.from));
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
      const speech = at === null ? undefined : this.passageAt(at);
      if (!speech) {
        this.hideSoon();
        return;
      }
      clearTimeout(this.hideTimer);
      if (this.shown === speech.from && !this.bar.hidden) return;
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
  /** The passage at `at`, as the page or its worker last read the story. */
  private passageAt(at: number): Passage | undefined {
    if (this.context.passageAt) return this.context.passageAt(at);
    const speech = speechAt(this.context.story(), at);
    return speech ? asPassage(speech) : undefined;
  }

  private show(speech: Passage): void {
    const { view, host } = this.context;
    const markFrom = speech.markFrom;
    const sameLine =
      markFrom !== undefined &&
      view.state.doc.lineAt(markFrom).number === view.state.doc.lineAt(speech.from).number;
    const anchor = sameLine ? (markFrom as number) : speech.from;
    // Where the passage's words start, a character on the page (a mark may be drawn as a chip),
    // and its mark's left edge when the mark is on the same line.
    const words = view.coordsAtPos(Math.min(speech.from + 1, view.state.doc.length), -1);
    const start = view.coordsAtPos(anchor, 1);
    const coords =
      words && start && Math.abs(start.top - words.top) < 4
        ? { top: words.top, bottom: words.bottom, left: Math.min(start.left, words.left) }
        : (words ?? start);
    if (!coords) return;
    this.shown = speech.from;
    const who = this.part(".who");
    const color = this.context
      .speakers()
      .find((speaker) => speaker.handle.toLowerCase() === speech.speaker.toLowerCase())?.color;
    (who.querySelector(".dot") as HTMLElement).style.setProperty("--c", color ?? "var(--quiet)");
    (who.querySelector(".who-name") as HTMLElement).textContent = speech.speaker;
    const how = this.part(".how");
    how.textContent = speech.ownDirection ? `(${speech.ownDirection})` : "+ how";
    how.title = speech.ownDirection ? `How it’s said: ${speech.ownDirection}` : "How it’s said";
    how.classList.toggle("set", Boolean(speech.ownDirection));
    this.bar.hidden = false;
    const box = host.getBoundingClientRect();
    const height = this.bar.offsetHeight;
    const width = this.bar.offsetWidth;
    // In the margin beside the passage's line where the page has room for it, so it covers no
    // words; else over the line above, or under its own at the top of the view.
    const content = view.contentDOM.getBoundingClientRect();
    const margin = content.left - box.left;
    if (margin >= width + 12) {
      this.bar.style.left = `${margin - width - 8}px`;
      this.bar.style.top = `${Math.max(4, coords.top - box.top + (coords.bottom - coords.top - height) / 2)}px`;
      return;
    }
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

export { composed, mapped } from "./changes";
