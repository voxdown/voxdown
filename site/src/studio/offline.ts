export type StudioOfflineStatus = {
  state:
    | "checking"
    | "unavailable"
    | "unprepared"
    | "preparing"
    | "ready"
    | "update-available"
    | "error";
  message: string;
};
type WorkerStatus = { version: string; ready: boolean; count: number; error?: string };

function queryWorker(worker: ServiceWorker, type = "STUDIO_OFFLINE_STATUS"): Promise<WorkerStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(
      () => finish(new Error("Offline preparation did not respond. Reconnect and try again.")),
      type === "STUDIO_OFFLINE_PREPARE" ? 95000 : 8000,
    );
    const finish = (result: WorkerStatus | Error) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      if (result instanceof Error) reject(result);
      else if (result.error) reject(new Error(result.error));
      else resolve(result);
    };
    channel.port1.onmessage = (event: MessageEvent<WorkerStatus>) => finish(event.data);
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch {
      finish(
        new Error(
          "Studio could not contact its offline worker. Reload when connected and try again.",
        ),
      );
    }
  });
}
function activated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        finish(new Error("Offline preparation took too long. Check your connection and retry.")),
      95000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      worker.removeEventListener("statechange", changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant")
        finish(
          new Error(
            "Offline resources could not be saved. Check your connection and available device storage, then retry.",
          ),
        );
    };
    worker.addEventListener("statechange", changed);
    changed();
  });
}

/** Registration is opt-in. Checking status never installs a worker or downloads offline assets. */
export function createStudioOffline(onStatus: (status: StudioOfflineStatus) => void = () => {}) {
  const build = document.querySelector<HTMLMetaElement>(
    'meta[name="studio-offline-build"]',
  )?.content;
  const scope = new URL("./", location.href).href;
  const workerUrl = new URL("offline-worker.js", scope).href;
  let value: StudioOfflineStatus = { state: "checking", message: "Checking offline availability…" };
  let disposed = false;
  let preparing: Promise<StudioOfflineStatus> | undefined;
  const emit = (next: StudioOfflineStatus) => {
    value = next;
    if (!disposed) onStatus({ ...value });
    return { ...value };
  };
  const supported = () => {
    if (!build)
      return "Offline preparation is available in the built Studio site, not the development server.";
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("caches" in window))
      return "This browser cannot prepare Studio offline here. Use a supported browser over HTTPS.";
    return "";
  };
  const describe = (status: WorkerStatus): StudioOfflineStatus => {
    if (!status.ready)
      return {
        state: "unprepared",
        message: "Offline files are missing. Prepare offline again while connected.",
      };
    if (status.version !== build)
      return {
        state: "update-available",
        message:
          "An earlier Studio version is available offline. Prepare this version while connected; your editor will stay open.",
      };
    return {
      state: "ready",
      message:
        "This Studio version is prepared for offline reopening and PDF export. Browser storage can still be cleared or evicted. Keep a separate backup of your writing.",
    };
  };
  const refresh = async (): Promise<StudioOfflineStatus> => {
    if (preparing) return preparing;
    const reason = supported();
    if (reason) return emit({ state: "unavailable", message: reason });
    try {
      const registration = await navigator.serviceWorker.getRegistration(scope);
      if (
        registration?.scope !== scope ||
        !registration.active ||
        registration.active.scriptURL !== workerUrl
      )
        return emit({
          state: "unprepared",
          message:
            "Prepare Studio's app files for offline reopening and PDF export. Your screenplay is not included in the app cache.",
        });
      const status = await queryWorker(registration.active);
      // A user may start preparation while this initial read is awaiting its worker reply.
      if (preparing) return preparing;
      return emit(describe(status));
    } catch {
      if (preparing) return preparing;
      return emit({
        state: "error",
        message: "Offline availability could not be checked. Try preparing again while connected.",
      });
    }
  };
  const prepare = (): Promise<StudioOfflineStatus> => {
    if (preparing) return preparing;
    const reason = supported();
    if (reason) return Promise.resolve(emit({ state: "unavailable", message: reason }));
    emit({
      state: "preparing",
      message: "Preparing Studio for offline use… Keep this tab open while the app files download.",
    });
    preparing = (async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration(scope);
        if (
          existing?.scope === scope &&
          [existing.active, existing.waiting, existing.installing].some(
            (worker) => worker && worker.scriptURL !== workerUrl,
          )
        )
          throw new Error(
            "A different offline application already controls this Studio path. Its registration was left unchanged.",
          );
        if (existing?.scope === scope && existing.active?.scriptURL === workerUrl) {
          let status = await queryWorker(existing.active);
          if (status.version === build) {
            if (!status.ready)
              status = await queryWorker(existing.active, "STUDIO_OFFLINE_PREPARE");
            if (!status.ready)
              throw new Error(
                "Some offline resources are missing. Reconnect and retry preparation.",
              );
            return emit(describe(status));
          }
        }
        const registration = await navigator.serviceWorker.register(workerUrl, {
          scope,
          updateViaCache: "none",
        });
        // Re-registering an unchanged worker URL can return the existing registration without
        // fetching a failed update again. An explicit retry must request a fresh script check.
        if (existing?.scope === scope && !registration.installing && !registration.waiting)
          await registration.update();
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker)
          throw new Error("Studio's offline worker did not start. Reconnect and try again.");
        await activated(worker);
        let status = await queryWorker(worker);
        if (status.version !== build)
          throw new Error(
            "Studio changed while preparing offline. Save your work, then reload while connected and prepare again.",
          );
        if (!status.ready) status = await queryWorker(worker, "STUDIO_OFFLINE_PREPARE");
        if (!status.ready)
          throw new Error("Some offline resources are missing. Reconnect and retry preparation.");
        return emit(describe(status));
      } catch (error) {
        return emit({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Offline preparation failed. Reconnect and retry.",
        });
      } finally {
        preparing = undefined;
      }
    })();
    return preparing;
  };
  const answerVersion = (event: MessageEvent) => {
    if (disposed || event.data?.type !== "STUDIO_OFFLINE_CLIENT_VERSION" || !event.ports[0]) return;
    // Only this scoped worker can ask which app assets an open editor still needs.
    const source = event.source as ServiceWorker | null;
    if (source?.scriptURL !== workerUrl) return;
    event.ports[0].postMessage({ version: build });
  };
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.addEventListener("message", answerVersion);
  void refresh();
  return {
    status: () => ({ ...value }),
    refresh,
    prepare,
    dispose: () => {
      disposed = true;
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener("message", answerVersion);
    },
  };
}
