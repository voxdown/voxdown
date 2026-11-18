import type { VoxDownAdaptation } from "./adaptation";

export interface AdaptationRequest {
  id: number;
  source: string;
  readSceneHeadings: boolean;
}
export type AdaptationReply = { id: number; result?: VoxDownAdaptation; error?: string };
export interface AdaptationWorker {
  postMessage(request: AdaptationRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<AdaptationReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export class AdaptationCancelledError extends Error {
  constructor() {
    super("Adaptation preparation was cancelled.");
    this.name = "AdaptationCancelledError";
  }
}
type Job = {
  id: number;
  resolve(result: VoxDownAdaptation): void;
  reject(error: Error): void;
};

/** One active job, no queue. Superseding active work terminates its worker so
 * expensive parsing stops immediately. Idle reuse lasts only until close(). */
export class AdaptationClient {
  private worker: AdaptationWorker | undefined;
  private active: Job | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 0;
  private readonly timeoutMs: number;

  constructor(
    private readonly factory: () => AdaptationWorker = () =>
      new Worker(new URL("./adaptation-worker.ts", import.meta.url), { type: "module" }),
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new RangeError("Adaptation timeout must be a positive finite duration.");
  }

  request(source: string, readSceneHeadings: boolean): Promise<VoxDownAdaptation> {
    if (this.active) this.close();
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.nextId, resolve, reject };
      this.active = job;
      try {
        if (!this.worker) {
          const worker = this.factory();
          this.worker = worker;
          worker.onmessage = (event) => {
            if (this.worker !== worker) return;
            const active = this.active;
            if (!active || event.data?.id !== active.id) return;
            clearTimeout(this.timer);
            this.timer = undefined;
            const { result, error } = event.data;
            if (typeof error === "string") {
              this.fail(error);
            } else if (
              result &&
              typeof result.source === "string" &&
              Number.isSafeInteger(result.bytes) &&
              result.bytes >= 0 &&
              result.source.length <= 4_000_000 &&
              Array.isArray(result.cast) &&
              result.cast.every(
                (member) =>
                  member && typeof member.name === "string" && typeof member.handle === "string",
              ) &&
              Array.isArray(result.report) &&
              result.report.every((message) => typeof message === "string") &&
              Number.isSafeInteger(result.spokenRows) &&
              result.spokenRows >= 0 &&
              Number.isSafeInteger(result.dualCues) &&
              result.dualCues >= 0
            ) {
              this.active = undefined;
              active.resolve(result);
            } else this.fail("The adaptation worker returned unreadable data. Retry preparation.");
          };
          worker.onerror = (event) => {
            if (this.worker !== worker) return;
            event.preventDefault();
            this.fail(
              "The adaptation worker stopped. Retry preparation; your screenplay is unchanged.",
            );
          };
          worker.onmessageerror = () => {
            if (this.worker === worker)
              this.fail("The adaptation worker returned unreadable data. Retry preparation.");
          };
        }
        const worker = this.worker;
        this.timer = setTimeout(() => {
          if (this.active === job && this.worker === worker)
            this.fail(
              "Adaptation preparation timed out. Retry preparation; your screenplay is unchanged.",
            );
        }, this.timeoutMs);
        worker.postMessage({ id: job.id, source, readSceneHeadings });
      } catch {
        this.fail(
          "The adaptation worker could not start or receive the screenplay. Retry preparation when workers are available. Your screenplay is unchanged.",
        );
      }
    });
  }

  /** Terminates running/idle workers and releases their heap. A later request is
   * an explicit fresh start, allowing close/reopen or Retry without fallback. */
  close(): void {
    this.stop(new AdaptationCancelledError());
  }
  private fail(message: string): void {
    this.stop(new Error(message));
  }
  private stop(error: Error): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const job = this.active;
    this.active = undefined;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    job?.reject(error);
  }
}
