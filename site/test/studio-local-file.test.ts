import { describe, expect, it, vi } from "vitest";
import {
  LocalFileController,
  type LocalFileHandle,
  type LocalFilePicker,
} from "../src/studio/local-file";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function file(initial = "", name = "Draft.fountain") {
  let data = new TextEncoder().encode(initial);
  let staged = data;
  const stream = {
    write: vi.fn(async (value: Uint8Array) => {
      staged = value.slice();
    }),
    close: vi.fn(async () => {
      data = staged;
    }),
    abort: vi.fn(async () => {}),
  };
  const handle: LocalFileHandle = {
    name,
    getFile: vi.fn(async () => {
      const snapshot = data.slice();
      return { size: snapshot.length, arrayBuffer: async () => snapshot.buffer };
    }),
    createWritable: vi.fn(async () => stream),
  };
  const picker = vi.fn<LocalFilePicker>(async () => handle);
  return {
    handle,
    picker,
    stream,
    external: (value: string) => {
      data = new TextEncoder().encode(value);
    },
    bytes: () => data,
    text: () => new TextDecoder("utf-8", { ignoreBOM: true }).decode(data),
  };
}

describe("Studio direct local file saving", () => {
  it("saves back to an opened file without another picker and detects external changes", async () => {
    const original = "\uFEFFINT. ROOM - DAY\r\n\r\nCafé.\r\n";
    const disk = file(original);
    const controller = new LocalFileController(disk.picker);
    controller.connectOpened(disk.handle, original);
    expect(await controller.save(`${original}More.`)).toEqual({
      status: "saved",
      filename: "Draft.fountain",
    });
    expect(disk.picker).not.toHaveBeenCalled();
    expect(disk.text()).toBe(`${original}More.`);
    disk.external("External revision");
    expect(await controller.save("My revision")).toEqual({
      status: "conflict",
      filename: "Draft.fountain",
    });
    expect(disk.text()).toBe("External revision");
  });
  it("keeps the opened snapshot as its baseline even if the file changes before linking", async () => {
    const disk = file("External revision");
    const controller = new LocalFileController(disk.picker);
    controller.connectOpened(disk.handle, "Opened snapshot");
    expect(await controller.save("My revision")).toEqual({
      status: "conflict",
      filename: "Draft.fountain",
    });
    expect(disk.handle.createWritable).not.toHaveBeenCalled();
  });

  it("progressively detects unsupported and unlinked sessions", async () => {
    const unsupported = new LocalFileController(null);
    expect(unsupported.available).toBe(false);
    expect(await unsupported.saveAs("A", "Draft")).toEqual({ status: "unsupported" });
    const controller = new LocalFileController(file().picker);
    expect(controller.available).toBe(true);
    expect(controller.filename).toBeNull();
    expect(await controller.save("A")).toEqual({ status: "unlinked" });
  });

  it("saves exact UTF-8 bytes, BOM, Unicode and mixed newlines and reuses the connection", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    const source = "\uFEFFTitle: Café 龍 🎭\r\n\nADA\rLine.\n";
    expect(await controller.saveAs(source, "../CON.txt")).toEqual({
      status: "saved",
      filename: "Draft.fountain",
    });
    expect(disk.bytes()).toEqual(new TextEncoder().encode(source));
    expect(controller.filename).toBe("Draft.fountain");
    expect(disk.handle.createWritable).toHaveBeenCalledWith({
      keepExistingData: false,
      mode: "exclusive",
    });
    expect(disk.picker.mock.calls[0]?.[0].suggestedName).toBe("-CON.fountain");
    expect(await controller.save(`${source}More`)).toEqual({
      status: "saved",
      filename: "Draft.fountain",
    });
    expect(disk.text()).toBe(`${source}More`);
    expect(disk.picker).toHaveBeenCalledTimes(1);
  });

  it("does not truncate a file changed outside Studio, even at the same size", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    await controller.saveAs("AAAA", "Draft");
    disk.external("BBBB");
    expect(await controller.save("CCCC")).toEqual({
      status: "conflict",
      filename: "Draft.fountain",
    });
    expect(disk.text()).toBe("BBBB");
    expect(disk.handle.createWritable).toHaveBeenCalledTimes(1);
    expect(controller.filename).toBeNull();
    expect(await controller.save("CCCC")).toEqual({ status: "unlinked" });
  });

  it("treats explicitly choosing the same Save As target as a new overwrite baseline", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    await controller.saveAs("first", "Draft");
    disk.external("external edit");
    expect(await controller.saveAs("explicit replacement", "Draft")).toEqual({
      status: "saved",
      filename: "Draft.fountain",
    });
    expect(disk.text()).toBe("explicit replacement");
    expect(disk.picker).toHaveBeenCalledTimes(2);
  });

  it("aborts staged output when the file changes while writing", async () => {
    const disk = file("original");
    const controller = new LocalFileController(disk.picker);
    disk.stream.write.mockImplementationOnce(async () => {
      disk.external("external");
    });
    expect(await controller.saveAs("mine", "Draft")).toEqual({
      status: "conflict",
      filename: "Draft.fountain",
    });
    expect(disk.stream.close).not.toHaveBeenCalled();
    expect(disk.stream.abort).toHaveBeenCalledOnce();
    expect(disk.text()).toBe("external");
  });

  it("treats picker cancellation as normal and retains an existing connection", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    await controller.saveAs("first", "Draft");
    disk.picker.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
    expect(await controller.saveAs("second", "Other")).toEqual({ status: "cancelled" });
    expect(controller.filename).toBe("Draft.fountain");
    expect(disk.text()).toBe("first");
    expect(controller.busy).toBe(false);
  });

  it.each([
    ["NotAllowedError", "permission"],
    ["SecurityError", "permission"],
    ["NoModificationAllowedError", "permission"],
    ["NotFoundError", "missing"],
    ["InvalidStateError", "locked"],
    ["QuotaExceededError", "quota"],
  ])("reports %s without changing source or destination", async (name, reason) => {
    const disk = file("untouched");
    vi.mocked(disk.handle.createWritable).mockRejectedValueOnce(new DOMException("failed", name));
    const result = await new LocalFileController(disk.picker).saveAs("mine", "Draft");
    expect(result).toMatchObject({ status: "error", reason, mayHaveWritten: false });
    expect(disk.text()).toBe("untouched");
    expect(disk.stream.write).not.toHaveBeenCalled();
  });

  it("aborts a failed write and does not misreport an I/O AbortError as user cancellation", async () => {
    const disk = file("untouched");
    disk.stream.write.mockRejectedValueOnce(new DOMException("write interrupted", "AbortError"));
    expect(await new LocalFileController(disk.picker).saveAs("mine", "Draft")).toMatchObject({
      status: "error",
      reason: "io",
      mayHaveWritten: false,
    });
    expect(disk.stream.abort).toHaveBeenCalledOnce();
    expect(disk.stream.close).not.toHaveBeenCalled();
    expect(disk.text()).toBe("untouched");
  });

  it("disconnects uncertain failed closes and preserves their error if abort also fails", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    await controller.saveAs("first", "Draft");
    disk.stream.close.mockRejectedValueOnce(new Error("close failed"));
    disk.stream.abort.mockRejectedValueOnce(new Error("abort failed"));
    expect(await controller.save("second")).toMatchObject({
      status: "error",
      mayHaveWritten: true,
    });
    expect(controller.filename).toBeNull();
    expect(controller.busy).toBe(false);
    expect(disk.text()).toBe("first");
  });

  it("rejects invalid/oversized source before opening a picker", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    for (const source of ["x".repeat(500_001), "x\n".repeat(20_001), "x\0y", "x\uD800"])
      expect(await controller.saveAs(source, "Draft")).toMatchObject({
        status: "error",
        reason: "invalid-source",
      });
    expect(disk.picker).not.toHaveBeenCalled();
  });

  it("does not read an unexpectedly huge destination into memory", async () => {
    const disk = file();
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    vi.mocked(disk.handle.getFile).mockResolvedValueOnce({ size: 100_000_000, arrayBuffer });
    expect(await new LocalFileController(disk.picker).saveAs("mine", "Draft")).toMatchObject({
      status: "error",
      mayHaveWritten: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(disk.stream.write).not.toHaveBeenCalled();
  });

  it("does not reconnect or write when a document is replaced during the picker", async () => {
    const disk = file("original");
    const gate = deferred();
    disk.picker.mockImplementationOnce(async () => {
      await gate.promise;
      return disk.handle;
    });
    const controller = new LocalFileController(disk.picker);
    const pending = controller.saveAs("old draft", "Draft");
    controller.disconnect();
    gate.resolve();
    expect(await pending).toEqual({ status: "stale", mayHaveWritten: false });
    expect(controller.filename).toBeNull();
    expect(disk.handle.getFile).not.toHaveBeenCalled();
    expect(disk.text()).toBe("original");
  });

  it("aborts if a document is replaced during staging", async () => {
    const disk = file("original");
    const controller = new LocalFileController(disk.picker);
    disk.stream.write.mockImplementationOnce(async () => {
      controller.disconnect();
    });
    expect(await controller.saveAs("old draft", "Draft")).toEqual({
      status: "stale",
      mayHaveWritten: false,
    });
    expect(disk.stream.abort).toHaveBeenCalledOnce();
    expect(disk.stream.close).not.toHaveBeenCalled();
    expect(controller.filename).toBeNull();
  });

  it("does not reconnect after document replacement during an already-issued commit", async () => {
    const disk = file();
    const controller = new LocalFileController(disk.picker);
    disk.stream.close.mockImplementationOnce(async () => {
      controller.disconnect();
    });
    expect(await controller.saveAs("old draft", "Draft")).toEqual({
      status: "stale",
      mayHaveWritten: true,
    });
    expect(controller.filename).toBeNull();
  });

  it("serializes save and saveAs, including after disconnect until pending work finishes", async () => {
    const disk = file();
    const gate = deferred();
    disk.picker.mockImplementationOnce(async () => {
      await gate.promise;
      return disk.handle;
    });
    const controller = new LocalFileController(disk.picker);
    const pending = controller.saveAs("first", "Draft");
    expect(controller.busy).toBe(true);
    expect(await controller.saveAs("second", "Other")).toEqual({ status: "busy" });
    expect(await controller.save("third")).toEqual({ status: "busy" });
    controller.disconnect();
    expect(await controller.saveAs("new draft", "New")).toEqual({ status: "busy" });
    gate.resolve();
    expect(await pending).toEqual({ status: "stale", mayHaveWritten: false });
    expect(controller.busy).toBe(false);
    expect(await controller.saveAs("new draft", "New")).toEqual({
      status: "saved",
      filename: "Draft.fountain",
    });
    expect(disk.text()).toBe("new draft");
  });
});
