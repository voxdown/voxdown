import type { FountainDocument } from "./fountain";
import type { ScreenplayLayout } from "./layout";

export type WorkerResult = {
  id: number;
  document?: FountainDocument;
  layout?: ScreenplayLayout;
  error?: string;
};
export type WorkerRequest = { id: number; source: string; paper: "letter" | "a4" };
export interface ScreenplayWorker {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

/** Expected cancellation: callers should ignore it instead of displaying an error. */
export class SupersededRequestError extends Error {
  constructor(message = "A newer screenplay request replaced this preview.") {
    super(message);
    this.name = "SupersededRequestError";
  }
}
export function isSupersededRequest(error: unknown): error is SupersededRequestError {
  return error instanceof SupersededRequestError;
}
export class ScreenplayWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenplayWorkerError";
  }
}

type Job = {
  request: WorkerRequest;
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
  settled: boolean;
};

/**
 * One running calculation and one replaceable waiting calculation. A superseded
 * running job still occupies the worker until it replies (or times out), but its
 * promise is cancelled immediately. This bounds worker messages during typing.
 * Failure terminates the worker; only an explicit restart creates another one.
 */
export class ScreenplayScheduler {
  private worker: ScreenplayWorker | undefined;
  private active: Job | undefined;
  private queued: Job | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private nextId = 0;
  private disposed = false;
  private failure: ScreenplayWorkerError | undefined;
  private readonly timeoutMs: number;

  constructor(
    private readonly factory: () => ScreenplayWorker,
    options: { timeoutMs?: number } = {},
  ) {
    const timeout = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new RangeError("The worker timeout must be a positive finite duration.");
    this.timeoutMs = timeout;
    this.restart();
  }

  get status(): "ready" | "busy" | "failed" | "disposed" {
    if (this.disposed) return "disposed";
    if (this.failure) return "failed";
    return this.active ? "busy" : "ready";
  }

  request(source: string, paper: "letter" | "a4"): Promise<WorkerResult> {
    if (this.disposed)
      return Promise.reject(new ScreenplayWorkerError("This screenplay scheduler is closed."));
    if (this.failure || !this.worker)
      return Promise.reject(
        this.failure ?? new ScreenplayWorkerError("The screenplay worker is unavailable."),
      );
    return new Promise((resolve, reject) => {
      const job: Job = {
        request: { id: ++this.nextId, source, paper },
        resolve,
        reject,
        settled: false,
      };
      if (!this.active) {
        this.start(job);
        return;
      }
      this.cancel(this.active);
      if (this.queued) this.cancel(this.queued);
      this.queued = job;
    });
  }

  /** Cancels previous requests. Returns false if worker creation fails or disposed. */
  restart(): boolean {
    if (this.disposed) return false;
    this.stop(new SupersededRequestError("The screenplay worker was restarted."));
    this.failure = undefined;
    const generation = this.generation;
    try {
      const worker = this.factory();
      this.worker = worker;
      worker.onmessage = (event) => {
        if (this.worker !== worker || this.generation !== generation) return;
        const job = this.active;
        if (!job || event.data?.id !== job.request.id) return;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.active = undefined;
        if (!job.settled) {
          job.settled = true;
          job.resolve(event.data);
        }
        const queued = this.queued;
        this.queued = undefined;
        if (queued) this.start(queued);
      };
      worker.onerror = (event) => {
        if (this.worker !== worker || this.generation !== generation) return;
        event.preventDefault();
        this.fail("The screenplay worker stopped. Retry preview to start it again.");
      };
      worker.onmessageerror = () => {
        if (this.worker !== worker || this.generation !== generation) return;
        this.fail("The screenplay worker returned unreadable data. Retry preview.");
      };
      return true;
    } catch {
      this.fail("The screenplay worker could not start. Retry preview when workers are available.");
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop(new SupersededRequestError("The screenplay scheduler was closed."));
  }

  private cancel(job: Job, error: Error = new SupersededRequestError()): void {
    if (job.settled) return;
    job.settled = true;
    job.reject(error);
  }

  private start(job: Job): void {
    const worker = this.worker;
    if (!worker) {
      this.cancel(job, this.failure ?? new ScreenplayWorkerError("The worker is unavailable."));
      return;
    }
    this.active = job;
    this.timer = setTimeout(() => {
      if (this.worker !== worker || this.active !== job) return;
      this.fail("Screenplay layout timed out. Retry preview; your source is unchanged.");
    }, this.timeoutMs);
    try {
      worker.postMessage(job.request);
    } catch {
      this.fail("The screenplay could not be sent to the worker. Retry preview.");
    }
  }

  private fail(message: string): void {
    this.failure = new ScreenplayWorkerError(message);
    this.stop(this.failure);
  }

  private stop(error: Error): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) this.cancel(this.active, error);
    if (this.queued) this.cancel(this.queued, error);
    this.active = undefined;
    this.queued = undefined;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }
}
