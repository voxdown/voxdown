/**
 * The page's own scrollbar, for the story and for its script or book beside it. The browser's
 * can't be held to the pointer in a long story: the editor draws only what is near the screen and
 * guesses the height of the rest (the side lays out only the parts in view, and guesses the rest
 * too), each part drawn changes that height a little, and the browser drops a thumb's moves
 * whenever it does, so a drag to the foot of the track reached half the book. No page can take
 * that drag over (the browser gives it no pointer moves). This one is the page's: dragged, it puts
 * what it scrolls where the pointer is on the track (the foot of the track is the end, whatever
 * was guessed); pressed on the track, it goes there. The wheel, the keys and a touch scroll as
 * before, and the thumb follows.
 */

/** The thumb's least height, to be found and held. */
const LEAST = 28;

export class StoryScrollbar {
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  /** While the thumb is held: where on it the pointer took it. */
  private grip: number | undefined;
  /** The share of the way down the drag last put the story at. */
  private share = 0;
  /**
   * While the thumb is held, its size as it was taken: the parts drawn on the way change the
   * height guessed for the rest, and a thumb that grew or shrank under the pointer would leave it.
   */
  private held: { length: number; thumb: number; room: number } | undefined;
  private frame = 0;

  constructor(
    /** What the track is drawn in, over the right edge of what it scrolls. */
    private readonly host: HTMLElement,
    /** What it scrolls. */
    private readonly scrolling: () => HTMLElement,
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

  private get scroller(): HTMLElement {
    return this.scrolling();
  }

  /**
   * Follows what it scrolls: each scroll, and each change of its height, the parts drawn as they
   * come into view changing it with no scroll at all (a thumb left as it was would be the wrong
   * size when taken).
   */
  attach(): void {
    const scroller = this.scroller;
    scroller.addEventListener("scroll", () => this.show(), { passive: true });
    const grown = new ResizeObserver(() => this.show());
    const watch = () => {
      grown.disconnect();
      for (const child of scroller.children) grown.observe(child);
      this.show();
    };
    new MutationObserver(watch).observe(scroller, { childList: true });
    watch();
  }

  /** The track's length and the thumb's, in pixels. */
  private sizes() {
    if (this.held) return this.held;
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
      this.draw();
    });
  }

  private draw(): void {
    const scroller = this.scroller;
    const range = scroller.scrollHeight - scroller.clientHeight;
    this.track.hidden = range <= 1 || scroller.clientHeight === 0;
    if (this.track.hidden) return;
    // Over the right edge of what it scrolls, however the host lays it out.
    const top = scroller.getBoundingClientRect().top - this.host.getBoundingClientRect().top;
    this.track.style.top = `${Math.round(top)}px`;
    this.track.style.height = `${scroller.clientHeight}px`;
    const { thumb, room } = this.sizes();
    // Held: where the pointer put it, not where the guessed heights say the story is.
    const share = this.grip === undefined ? scroller.scrollTop / range : this.share;
    this.thumb.style.height = `${thumb}px`;
    this.thumb.style.transform = `translateY(${Math.round(Math.min(1, Math.max(0, share)) * room)}px)`;
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
    // The thumb as the height is now, before it is taken (the pointer is on it or it isn't).
    this.draw();
    const box = this.thumb.getBoundingClientRect();
    const onThumb = event.clientY >= box.top && event.clientY <= box.bottom;
    this.held = this.sizes();
    // On the thumb, held where it was taken; on the track, its middle goes there.
    this.grip = onThumb ? event.clientY - box.top : this.held.thumb / 2;
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
    this.held = undefined;
    delete this.track.dataset.held;
    // Let go at the foot, the end: held there while the parts drawn there change the height.
    if (this.share >= 0.999) this.toEnd(8);
    else this.show();
  }

  /** The end of what it scrolls, for a few frames more: until a new hold. */
  private toEnd(frames: number): void {
    requestAnimationFrame(() => {
      if (this.grip !== undefined) return;
      this.go(1);
      if (frames > 1) this.toEnd(frames - 1);
    });
  }
}
