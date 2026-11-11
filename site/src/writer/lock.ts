/**
 * One tab writes the story at a time. The draft in this browser is one story, so two tabs writing
 * it would each overwrite the other's work. The first tab holds a lock (the Web Locks API); another
 * opens to read, and takes over only when asked, after the first has kept its last words.
 */

const LOCK = "voxdown-writer-draft";

type Message = { type: "flush" } | { type: "flushed" };

export class DraftLock {
  /** Whether this tab writes the story. */
  owner = false;
  private readonly channel =
    "BroadcastChannel" in window ? new BroadcastChannel("voxdown-writer") : null;

  constructor(
    /** This tab lost the story to another. */
    private readonly onLost: () => void,
    /** Keeps the draft now, before another tab takes it. */
    private readonly flush: () => Promise<void>,
  ) {
    this.channel?.addEventListener("message", (event: MessageEvent<Message>) => {
      if (event.data?.type !== "flush" || !this.owner) return;
      void this.flush().then(() =>
        this.channel?.postMessage({ type: "flushed" } satisfies Message),
      );
    });
  }

  /**
   * Takes the story if no other tab writes it, or, with `take`, from the one that does. True if
   * this tab writes it now.
   */
  async claim(take = false): Promise<boolean> {
    if (!navigator.locks) {
      this.owner = true;
      return true;
    }
    if (take) await this.askToFlush();
    return new Promise((resolve) => {
      navigator.locks
        .request(LOCK, take ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            this.owner = false;
            resolve(false);
            return undefined;
          }
          this.owner = true;
          resolve(true);
          // Held as long as the page is open, or until another tab takes it.
          return new Promise<void>(() => {});
        })
        .catch(() => {
          if (!this.owner) return;
          this.owner = false;
          this.onLost();
        });
    });
  }

  /** Asks the tab that writes the story to keep it now; waits a moment for it to answer. */
  private askToFlush(): Promise<void> {
    const channel = this.channel;
    if (!channel) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        channel.removeEventListener("message", answered);
        resolve();
      };
      const answered = (event: MessageEvent<Message>) => {
        if (event.data?.type === "flushed") done();
      };
      const timer = setTimeout(done, 800);
      channel.addEventListener("message", answered);
      channel.postMessage({ type: "flush" } satisfies Message);
    });
  }
}
