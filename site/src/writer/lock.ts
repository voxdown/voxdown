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
  | { type: "kept"; id: string };

export class DraftLock {
  /** Whether this tab writes its story. */
  owner = false;
  /** The story this tab has open, if any. */
  story: string | undefined;
  /** Lets go of the lock held, if any. */
  private release: (() => void) | undefined;
  private readonly channel =
    "BroadcastChannel" in window ? new BroadcastChannel("voxdown-writer") : null;

  constructor(
    /** Another tab took this tab's story. */
    private readonly onLost: () => void,
    /** Keeps the draft now, before another tab takes it. */
    private readonly flush: () => Promise<void>,
    /** The tab that writes this tab's story kept it: this one can follow. */
    private readonly onKept: () => void = () => {},
  ) {
    this.channel?.addEventListener("message", (event: MessageEvent<Message>) => {
      const message = event.data;
      if (!message || message.id !== this.story) return;
      if (message.type === "kept" && !this.owner) this.onKept();
      if (message.type === "flush" && this.owner)
        void this.flush().then(() =>
          this.channel?.postMessage({ type: "flushed", id: message.id } satisfies Message),
        );
    });
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
            if (this.story === id) this.owner = false;
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
          // Taken by another tab: this one reads it from now on.
          if (this.story !== id || !this.owner) return;
          this.owner = false;
          this.release = undefined;
          this.onLost();
        });
    });
  }

  /** No story open here any more: its lock goes. */
  private letGo(): void {
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
