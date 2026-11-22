import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdaptationCancelledError,
  AdaptationClient,
  type AdaptationReply,
  type AdaptationRequest,
  type AdaptationWorker,
} from "../src/studio/adaptation-client";
const result = {
  source: "Valid output",
  bytes: 12,
  cast: [],
  report: ["Validated"],
  spokenRows: 1,
  dualCues: 0,
};
class FakeWorker implements AdaptationWorker {
  onmessage: AdaptationWorker["onmessage"] = null;
  onerror: AdaptationWorker["onerror"] = null;
  onmessageerror: AdaptationWorker["onmessageerror"] = null;
  messages: AdaptationRequest[] = [];
  terminated = false;
  postMessage(request: AdaptationRequest) {
    this.messages.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  reply(reply: Partial<AdaptationReply> = { result }) {
    this.onmessage?.({
      data: { id: this.messages.at(-1)?.id, ...reply },
    } as unknown as MessageEvent<AdaptationReply>);
  }
}
afterEach(() => vi.useRealTimers());
describe("cancellable adaptation worker client", () => {
  it("starts lazily, reuses idle workers, and releases their heap on close", async () => {
    const workers: FakeWorker[] = [];
    const client = new AdaptationClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    expect(workers).toHaveLength(0);
    const first = client.request("Source", false);
    expect(workers).toHaveLength(1);
    workers[0]?.reply();
    await expect(first).resolves.toEqual(result);
    const second = client.request("Source", true);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages.at(-1)).toMatchObject({
      source: "Source",
      readSceneHeadings: true,
    });
    workers[0]?.reply();
    await second;
    client.close();
    expect(workers[0]?.terminated).toBe(true);
    const third = client.request("New source", false);
    expect(workers).toHaveLength(2);
    workers[1]?.reply();
    await third;
    client.close();
  });
  it("terminates superseded active work and ignores captured stale callbacks", async () => {
    const workers: FakeWorker[] = [];
    const client = new AdaptationClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = client.request("Old", false);
    const cancelled = expect(first).rejects.toBeInstanceOf(AdaptationCancelledError);
    const callback = workers[0]?.onmessage;
    const second = client.request("New", true);
    await cancelled;
    expect(workers[0]?.terminated).toBe(true);
    callback?.({
      data: { id: 1, result: { ...result, source: "STALE" } },
    } as unknown as MessageEvent<AdaptationReply>);
    workers[1]?.reply();
    await expect(second).resolves.toEqual(result);
    client.close();
  });
  it("settles cancellation and closes safely before creation or repeatedly", async () => {
    const worker = new FakeWorker();
    const client = new AdaptationClient(() => worker);
    client.close();
    const pending = client.request("Source", false);
    const rejected = expect(pending).rejects.toBeInstanceOf(AdaptationCancelledError);
    client.close();
    client.close();
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBe(null);
  });
  it("handles constructor failure without fallback and allows an explicit retry", async () => {
    const worker = new FakeWorker();
    let fail = true;
    const client = new AdaptationClient(() => {
      if (fail) throw Error("blocked");
      return worker;
    });
    await expect(client.request("Source", false)).rejects.toThrow("could not start");
    fail = false;
    const pending = client.request("Source", false);
    worker.reply();
    await expect(pending).resolves.toEqual(result);
    client.close();
  });
  it("handles postMessage failure and clears its deadline", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw Error("clone");
    };
    const client = new AdaptationClient(() => worker);
    await expect(client.request("Source", false)).rejects.toThrow("could not start");
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["error", "messageerror"])(
    "terminates on %s without exposing worker error contents",
    async (kind) => {
      const worker = new FakeWorker();
      const client = new AdaptationClient(() => worker);
      const pending = client.request("PRIVATE", false);
      const rejected = expect(pending).rejects.not.toThrow("PRIVATE");
      if (kind === "error")
        worker.onerror?.({ message: "PRIVATE", preventDefault: () => {} } as ErrorEvent);
      else worker.onmessageerror?.({} as MessageEvent);
      await rejected;
      expect(worker.terminated).toBe(true);
    },
  );
  it("times out, settles the pending promise and ignores late results", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new AdaptationClient(() => worker, { timeoutMs: 50 });
    const pending = client.request("Source", false);
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    worker.reply();
  });
  it.each([
    {},
    { result: { ...result, cast: [null] } },
    { result: { ...result, report: [null] } },
    { result: { ...result, bytes: Number.NaN } },
  ])("rejects unreadable matching results %#", async (reply) => {
    const worker = new FakeWorker();
    const client = new AdaptationClient(() => worker);
    const pending = client.request("Source", false);
    const rejected = expect(pending).rejects.toThrow("unreadable");
    worker.reply(reply as Partial<AdaptationReply>);
    await rejected;
    expect(worker.terminated).toBe(true);
  });
  it("returns actionable validation errors and terminates that worker", async () => {
    const worker = new FakeWorker();
    const client = new AdaptationClient(() => worker);
    const pending = client.request("Source", false);
    const rejected = expect(pending).rejects.toThrow("Close unfinished private notes");
    worker.reply({ error: "Close unfinished private notes" });
    await rejected;
    expect(worker.terminated).toBe(true);
  });
  it("ignores wrong IDs without making a result current", async () => {
    const worker = new FakeWorker();
    const client = new AdaptationClient(() => worker);
    const pending = client.request("Source", false);
    worker.reply({ id: 999, result: { ...result, source: "wrong" } });
    worker.reply();
    await expect(pending).resolves.toEqual(result);
    client.close();
  });
});
