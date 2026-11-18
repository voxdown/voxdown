import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScreenplayScheduler,
  type ScreenplayWorker,
  ScreenplayWorkerError,
  SupersededRequestError,
  type WorkerRequest,
  type WorkerResult,
  isSupersededRequest,
} from "../src/studio/scheduler";

class FakeWorker implements ScreenplayWorker {
  messages: WorkerRequest[] = [];
  terminated = false;
  onmessage: ScreenplayWorker["onmessage"] = null;
  onerror: ScreenplayWorker["onerror"] = null;
  onmessageerror: ScreenplayWorker["onmessageerror"] = null;
  postMessage(message: WorkerRequest) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(result: WorkerResult) {
    this.onmessage?.({ data: result } as MessageEvent<WorkerResult>);
  }
}

afterEach(() => vi.useRealTimers());

describe("Studio worker scheduler", () => {
  it("posts one calculation at a time and retains only the latest queued source", async () => {
    const worker = new FakeWorker();
    const scheduler = new ScreenplayScheduler(() => worker);
    const first = scheduler.request("first", "letter").catch((error) => error);
    const second = scheduler.request("second", "letter").catch((error) => error);
    const last = scheduler.request("last", "a4");
    expect(await first).toBeInstanceOf(SupersededRequestError);
    expect(isSupersededRequest(await second)).toBe(true);
    expect(worker.messages).toEqual([{ id: 1, source: "first", paper: "letter" }]);
    expect(scheduler.status).toBe("busy");
    worker.reply({ id: 1 });
    expect(worker.messages).toEqual([
      { id: 1, source: "first", paper: "letter" },
      { id: 3, source: "last", paper: "a4" },
    ]);
    worker.reply({ id: 3 });
    expect(await last).toEqual({ id: 3 });
    expect(scheduler.status).toBe("ready");
    scheduler.dispose();
  });

  it("bounds a burst of edits to one worker message plus the final source", async () => {
    const worker = new FakeWorker();
    const scheduler = new ScreenplayScheduler(() => worker);
    const results = Array.from({ length: 1_000 }, (_, i) =>
      scheduler.request(`source ${i}`, "letter").catch((error) => error),
    );
    expect(worker.messages).toHaveLength(1);
    worker.reply({ id: 1 });
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1]).toEqual({ id: 1_000, source: "source 999", paper: "letter" });
    worker.reply({ id: 1_000 });
    const resolved = await Promise.all(results);
    expect(resolved.filter(isSupersededRequest)).toHaveLength(999);
    expect(resolved[999]).toEqual({ id: 1_000 });
    scheduler.dispose();
  });

  it("starts each timeout when that calculation actually reaches the worker", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const scheduler = new ScreenplayScheduler(() => worker, { timeoutMs: 100 });
    const first = scheduler.request("first", "letter").catch((error) => error);
    await vi.advanceTimersByTimeAsync(80);
    const queued = scheduler.request("latest", "letter");
    worker.reply({ id: 1 });
    await vi.advanceTimersByTimeAsync(80);
    expect(scheduler.status).toBe("busy");
    expect(worker.terminated).toBe(false);
    worker.reply({ id: 2 });
    expect(await queued).toEqual({ id: 2 });
    expect(await first).toBeInstanceOf(SupersededRequestError);
    await vi.advanceTimersByTimeAsync(200);
    expect(scheduler.status).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
    scheduler.dispose();
  });

  it("terminates a timed-out worker, rejects queued work, and only recovers explicitly", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const scheduler = new ScreenplayScheduler(
      () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      { timeoutMs: 100 },
    );
    const first = scheduler.request("first", "letter").catch((error) => error);
    const queued = scheduler.request("latest source", "letter").catch((error) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBeInstanceOf(SupersededRequestError);
    expect(await queued).toBeInstanceOf(ScreenplayWorkerError);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[0]?.messages).toHaveLength(1);
    expect(scheduler.status).toBe("failed");
    await expect(scheduler.request("still here", "letter")).rejects.toThrow(/timed out/);
    expect(workers).toHaveLength(1);
    expect(scheduler.restart()).toBe(true);
    const recovered = scheduler.request("latest source", "letter");
    workers[1]?.reply({ id: 3 });
    expect(await recovered).toEqual({ id: 3 });
    expect(scheduler.status).toBe("ready");
    scheduler.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores wrong ids, duplicate replies, and callbacks from a terminated generation", async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let index = 0;
    const scheduler = new ScreenplayScheduler(() => workers[index++] as FakeWorker);
    const oldWorker = workers[0] as FakeWorker;
    const staleMessage = oldWorker.onmessage;
    const staleError = oldWorker.onerror;
    const old = scheduler.request("old", "letter").catch((error) => error);
    scheduler.restart();
    expect(await old).toBeInstanceOf(SupersededRequestError);
    const current = scheduler.request("current", "letter");
    const currentWorker = workers[1] as FakeWorker;
    staleMessage?.({ data: { id: 2 } } as MessageEvent<WorkerResult>);
    staleError?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    currentWorker.reply({ id: 999 });
    expect(scheduler.status).toBe("busy");
    currentWorker.reply({ id: 2 });
    expect(await current).toEqual({ id: 2 });
    currentWorker.reply({ id: 2 });
    expect(scheduler.status).toBe("ready");
    scheduler.dispose();
  });

  it("rejects running and queued work on a worker crash and removes listeners", async () => {
    const worker = new FakeWorker();
    const scheduler = new ScreenplayScheduler(() => worker);
    const active = scheduler.request("a", "letter").catch((error) => error);
    const queued = scheduler.request("b", "letter").catch((error) => error);
    const preventDefault = vi.fn();
    worker.onerror?.({ preventDefault } as unknown as ErrorEvent);
    expect(await active).toBeInstanceOf(SupersededRequestError);
    expect(await queued).toBeInstanceOf(ScreenplayWorkerError);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(scheduler.status).toBe("failed");
  });

  it("rejects an unsuperseded active request on timeout or message decoding failure", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const scheduler = new ScreenplayScheduler(() => worker, { timeoutMs: 50 });
    const active = scheduler.request("a", "letter").catch((error) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await active).toBeInstanceOf(ScreenplayWorkerError);
    scheduler.restart();
    const next = scheduler.request("b", "letter").catch((error) => error);
    worker.onmessageerror?.({} as MessageEvent);
    expect(await next).toBeInstanceOf(ScreenplayWorkerError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves partial layout results as resolved values so source diagnostics remain available", async () => {
    const worker = new FakeWorker();
    const scheduler = new ScreenplayScheduler(() => worker);
    const request = scheduler.request("source", "letter");
    worker.reply({ id: 1, error: "Too many pages." });
    expect(await request).toEqual({ id: 1, error: "Too many pages." });
    expect(scheduler.status).toBe("ready");
    scheduler.dispose();
  });

  it("contains startup and postMessage failures without an automatic retry loop", async () => {
    const factory = vi.fn(() => {
      throw new Error("Blocked");
    });
    const blocked = new ScreenplayScheduler(factory);
    expect(blocked.status).toBe("failed");
    await expect(blocked.request("a", "letter")).rejects.toThrow(/could not start/);
    expect(factory).toHaveBeenCalledOnce();
    expect(blocked.restart()).toBe(false);
    expect(factory).toHaveBeenCalledTimes(2);
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("Cannot clone");
    };
    const scheduler = new ScreenplayScheduler(() => worker);
    await expect(scheduler.request("source", "letter")).rejects.toThrow(/could not be sent/);
    expect(worker.terminated).toBe(true);
    expect(scheduler.status).toBe("failed");
    blocked.dispose();
    scheduler.dispose();
  });

  it("disposes idempotently, cancels outstanding promises and cannot restart", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const scheduler = new ScreenplayScheduler(factory);
    const active = scheduler.request("a", "letter").catch((error) => error);
    const queued = scheduler.request("b", "letter").catch((error) => error);
    scheduler.dispose();
    scheduler.dispose();
    expect(await active).toBeInstanceOf(SupersededRequestError);
    expect(await queued).toBeInstanceOf(SupersededRequestError);
    expect(vi.getTimerCount()).toBe(0);
    expect(scheduler.status).toBe("disposed");
    expect(scheduler.restart()).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
    await expect(scheduler.request("c", "letter")).rejects.toThrow(/closed/);
  });

  it("rejects invalid timeout configuration", () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => new ScreenplayScheduler(() => new FakeWorker(), { timeoutMs })).toThrow(
        RangeError,
      );
  });
});
