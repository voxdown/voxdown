/** Offline use is the writer's choice: checking never installs anything or downloads files. */
export type OfflineState = { ready: boolean; message: string };

function build(): string | undefined {
  return document.querySelector<HTMLMetaElement>('meta[name="composer-offline-build"]')?.content;
}

function ask(worker: ServiceWorker): Promise<{ version: string; ready: boolean }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(
      () => reject(new Error("The offline worker did not answer.")),
      90000,
    );
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data);
    };
    worker.postMessage({ type: "COMPOSER_OFFLINE_STATUS" }, [channel.port2]);
  });
}

export async function offlineStatus(): Promise<OfflineState> {
  if (!build())
    return {
      ready: false,
      message: "Offline use is available in the built site, not the development server.",
    };
  if (!window.isSecureContext || !("serviceWorker" in navigator))
    return { ready: false, message: "This browser cannot keep Composer offline here." };
  const registration = await navigator.serviceWorker.getRegistration(
    new URL("./", location.href).href,
  );
  if (!registration?.active)
    return { ready: false, message: "Composer is not prepared for offline use yet." };
  const status = await ask(registration.active).catch(() => null);
  if (!status?.ready)
    return { ready: false, message: "Offline files are missing. Prepare again while connected." };
  return {
    ready: true,
    message:
      status.version === build()
        ? "This version of Composer opens without a connection."
        : "An earlier version is kept offline. Prepare again to keep this one.",
  };
}

export async function prepareOffline(): Promise<OfflineState> {
  if (!build() || !("serviceWorker" in navigator)) return offlineStatus();
  const registration = await navigator.serviceWorker.register("offline-worker.js", { scope: "./" });
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (worker && worker.state !== "activated")
    await new Promise<void>((resolve, reject) => {
      const changed = () => {
        if (worker.state === "activated") resolve();
        else if (worker.state === "redundant")
          reject(new Error("Offline files could not be saved."));
      };
      worker.addEventListener("statechange", changed);
      changed();
    });
  return offlineStatus();
}
