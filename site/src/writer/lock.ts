/**
 * One tab writes a story at a time: two tabs writing the same one would each overwrite the
 * other's draft. Each story has its own lock (the Web Locks API), so two tabs can write two
 * stories side by side; a tab that opens a story another tab writes reads it, follows it, and
 * takes it over only when asked, after the other has kept its last words.
 */

const LOCK = "voxdown-writer-story";

type Message =
  | { type: "flush"; id: string }
  | { type: "flushed"; id: string }
  | { type: "kept"; id: string }
  | { type: "leaving"; id: string };

/**
 * How long a tab that reads waits, after the one that writes leaves, before writing itself: long
 * enough for a reload of a long book on a slow computer (three seconds wasn't, and the tab that
 * read took the story from the one reloading), short for a tab truly closed.
 */
const RELOAD = 8000;

export class DraftLock {
  /** Whether this tab writes its story. */
  owner = false;
  /** The story this tab has open, if any. */
  story: string | undefined;
  /** Lets go of the lock held, if any. */
  private release: (() => void) | undefined;
  /** Stops waiting for a story another tab writes. */
  private waiting: AbortController | undefined;
  private readonly channel =
    "BroadcastChannel" in window ? new BroadcastChannel("voxdown-writer") : null;

  constructor(
    /** Another tab took this tab's story. */
    private readonly onLost: () => void,
    /** Keeps the draft now, before another tab takes it. */
    private readonly flush: () => Promise<void>,
    /** The tab that writes this tab's story kept it: this one can follow. */
    private readonly onKept: () => void = () => {},
    /** The tab that wrote this tab's story closed it: this one writes it now. */
    private readonly onGained: () => void = () => {},
  ) {
    this.channel?.addEventListener("message", (event: MessageEvent<Message>) => {
      const message = event.data;
      if (!message || message.id !== this.story) return;
      if (message.type === "kept" && !this.owner) this.onKept();
      // The tab that writes is going: maybe only reloading, to take its story back. A tab that
      // reads waits a moment before writing it, and writes it only if no one has.
      if (message.type === "leaving" && !this.owner) {
        this.waiting?.abort();
        this.waiting = undefined;
        setTimeout(() => {
          if (!this.owner && this.story === message.id && !this.waiting) this.waitFor(message.id);
        }, RELOAD);
      }
      if (message.type === "flush" && this.owner)
        void this.flush().then(() =>
          this.channel?.postMessage({ type: "flushed", id: message.id } satisfies Message),
        );
    });
  }

  /** Tells the tabs that read this story that this one, which writes it, is going. */
  leaving(): void {
    if (this.owner && this.story)
      this.channel?.postMessage({ type: "leaving", id: this.story } satisfies Message);
  }

  /** Tells the tabs that read this story that its draft was just kept. */
  kept(): void {
    if (this.owner && this.story)
      this.channel?.postMessage({ type: "kept", id: this.story } satisfies Message);
  }

  /**
   * Opens story `id` in this tab, letting go of the one it had: true if this tab writes it, false
   * if another does (unless `take`, which takes it from that tab).
   */
  async claim(id: string, take = false): Promise<boolean> {
    if (this.story === id && this.owner) return true;
    this.letGo();
    this.story = id;
    if (!navigator.locks) {
      this.owner = true;
      return true;
    }
    if (take) await this.askToFlush(id);
    return new Promise((resolve) => {
      navigator.locks
        .request(`${LOCK}:${id}`, take ? { steal: true } : { ifAvailable: true }, (lock) => {
          // Not to be had, or this tab opened another story meanwhile.
          if (!lock || this.story !== id) {
            if (this.story === id) {
              this.owner = false;
              this.waitFor(id);
            }
            resolve(false);
            return undefined;
          }
          this.owner = true;
          resolve(true);
          // Held while the story is open here, until another tab takes it.
          return new Promise<void>((done) => {
            this.release = done;
          });
        })
        .catch(() => {
          // Taken by another tab: this one reads it from now on, and writes it again when that
          // tab lets it go.
          if (this.story !== id || !this.owner) return;
          this.owner = false;
          this.release = undefined;
          this.onLost();
          this.waitFor(id);
        });
    });
  }

  /**
   * Waits in line for a story another tab writes: when that tab closes it (or the tab itself),
   * this one writes it, without being asked.
   */
  private waitFor(id: string): void {
    this.waiting?.abort();
    const waiting = new AbortController();
    this.waiting = waiting;
    navigator.locks
      .request(`${LOCK}:${id}`, { signal: waiting.signal }, (lock) => {
        if (!lock || this.story !== id || this.owner) return undefined;
        this.waiting = undefined;
        this.owner = true;
        this.onGained();
        return new Promise<void>((done) => {
          this.release = done;
        });
      })
      .catch(() => {
        // Stopped waiting (another story opened here), or taken again by another tab.
        if (this.story === id && this.owner && !this.waiting) {
          this.owner = false;
          this.release = undefined;
          this.onLost();
          this.waitFor(id);
        }
      });
  }

  /** No story open here any more: its lock goes, and so does waiting for one. */
  private letGo(): void {
    this.waiting?.abort();
    this.waiting = undefined;
    this.release?.();
    this.release = undefined;
    this.owner = false;
  }

  /** Asks the tab that writes the story to keep it now; waits a moment for it to answer. */
  private askToFlush(id: string): Promise<void> {
    const channel = this.channel;
    if (!channel) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        channel.removeEventListener("message", answered);
        resolve();
      };
      const answered = (event: MessageEvent<Message>) => {
        if (event.data?.type === "flushed" && event.data.id === id) done();
      };
      const timer = setTimeout(done, 800);
      channel.addEventListener("message", answered);
      channel.postMessage({ type: "flush", id } satisfies Message);
    });
  }
}
