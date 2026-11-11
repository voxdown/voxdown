/**
 * The story's own scrollbar. The browser's can't be held to the pointer in a long story: the
 * editor draws only what is near the screen and guesses the height of the rest, each part drawn
 * changes that height a little, and the browser drops a thumb's moves whenever it does, so a drag
 * to the foot of the track reached half the book. No page can take that drag over (the browser
 * gives it no pointer moves). This one is the page's: dragged, it puts the story where the pointer
 * is on the track (the foot of the track is the end of the story, whatever was guessed); pressed on
 * the track, it goes there. The wheel, the keys and a touch scroll the story as before, and the
 * thumb follows.
 */
import type { EditorView } from "@codemirror/view";

/** The thumb's least height, to be found and held. */
const LEAST = 28;

export class StoryScrollbar {
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  /** While the thumb is held: where on it the pointer took it. */
  private grip: number | undefined;
  /** The share of the way down the drag last put the story at. */
  private share = 0;
  private frame = 0;

  constructor(
    private readonly host: HTMLElement,
    private view: () => EditorView,
  ) {
    this.track = document.createElement("div");
    this.track.className = "story-scrollbar";
    // For the pointer: the keys and a screen reader scroll the story itself.
    this.track.setAttribute("aria-hidden", "true");
    this.thumb = document.createElement("div");
    this.thumb.className = "story-scrollbar-thumb";
    this.track.append(this.thumb);
    host.append(this.track);
    this.track.addEventListener("pointerdown", (event) => this.press(event));
    this.track.addEventListener("pointermove", (event) => this.drag(event));
    this.track.addEventListener("pointerup", (event) => this.release(event));
    this.track.addEventListener("pointercancel", (event) => this.release(event));
    new ResizeObserver(() => this.show()).observe(host);
  }

  /** The story's scroller: a new one with each story opened. */
  private get scroller(): HTMLElement {
    return this.view().scrollDOM;
  }

  /** Follows the story: called on each scroll and each change of its height. */
  attach(): void {
    this.scroller.addEventListener("scroll", () => this.show(), { passive: true });
    this.show();
  }

  /** The track's length and the thumb's, in pixels. */
  private sizes() {
    const scroller = this.scroller;
    const length = this.track.clientHeight;
    const thumb = Math.max(LEAST, (scroller.clientHeight / scroller.scrollHeight) * length);
    return { length, thumb, room: Math.max(1, length - thumb) };
  }

  /** The thumb where the story is: drawn on the next frame, once. */
  show(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const scroller = this.scroller;
      const range = scroller.scrollHeight - scroller.clientHeight;
      this.track.hidden = range <= 1;
      if (range <= 1) return;
      const { thumb, room } = this.sizes();
      // Held: where the pointer put it, not where the guessed heights say the story is.
      const share = this.grip === undefined ? scroller.scrollTop / range : this.share;
      this.thumb.style.height = `${thumb}px`;
      this.thumb.style.transform = `translateY(${Math.round(Math.min(1, Math.max(0, share)) * room)}px)`;
    });
  }

  /** The story put at a share of the way down: the foot of the track is its end. */
  private go(share: number): void {
    const scroller = this.scroller;
    this.share = Math.min(1, Math.max(0, share));
    scroller.scrollTop = this.share * (scroller.scrollHeight - scroller.clientHeight);
    this.show();
  }

  private press(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.track.setPointerCapture(event.pointerId);
    const box = this.thumb.getBoundingClientRect();
    const onThumb = event.clientY >= box.top && event.clientY <= box.bottom;
    const { thumb } = this.sizes();
    // On the thumb, held where it was taken; on the track, its middle goes there.
    this.grip = onThumb ? event.clientY - box.top : thumb / 2;
    this.track.dataset.held = "";
    if (!onThumb) this.drag(event);
  }

  private drag(event: PointerEvent): void {
    if (this.grip === undefined) return;
    const top = this.track.getBoundingClientRect().top;
    const { room } = this.sizes();
    this.go((event.clientY - top - this.grip) / room);
  }

  private release(event: PointerEvent): void {
    if (this.grip === undefined) return;
    this.track.releasePointerCapture?.(event.pointerId);
    this.grip = undefined;
    delete this.track.dataset.held;
    // Once the parts come to be drawn, the story where it was let go: its end, if there.
    const share = this.share;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (share >= 0.999) this.go(1);
        this.show();
      }),
    );
  }
}
