export const STORAGE_HEALTH_TIMEOUT_MS = 5000;
let dialogNumber = 0;

type Actions = { download?(): void; backup?(): void; recover?(): void };
function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), STORAGE_HEALTH_TIMEOUT_MS);
    operation.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function bytes(value: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let unit = 0;
  let size = value;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit++;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unit ? 1 : 0 }).format(size)} ${units[unit]}`;
}
function validBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Read-only health information. Persistence is requested only by its explicit button click. */
export function mountStorageHealth(host: HTMLElement, actions: Actions = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "storage-health-dialog";
  const heading = document.createElement("div");
  heading.className = "dialog-heading";
  const title = document.createElement("h2");
  title.id = `studio-storage-health-${++dialogNumber}`;
  title.textContent = "Storage and backups";
  dialog.setAttribute("aria-labelledby", title.id);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close storage and backups");
  heading.append(title, close);
  const explanation = document.createElement("p");
  explanation.textContent =
    "These estimates cover this website’s storage in this browser, including other workspaces and offline app files. They are not a size or backup check of this screenplay.";
  const estimate = document.createElement("p");
  estimate.dataset.storageHealth = "estimate";
  estimate.setAttribute("role", "status");
  const persistence = document.createElement("p");
  persistence.dataset.storageHealth = "persistence";
  persistence.setAttribute("role", "status");
  const persist = document.createElement("button");
  persist.type = "button";
  persist.textContent = "Request persistent storage";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh storage information";
  const guidance = document.createElement("p");
  guidance.textContent =
    "Keep an independent Fountain download or portable backup somewhere you trust. Browser recovery and persistent storage do not protect against clearing site data, device loss or browser resets. Preparing the app offline does not back up your writing.";
  const tools = document.createElement("p");
  for (const [label, action] of [
    ["Download Fountain", actions.download],
    ["Portable backup…", actions.backup],
    ["Open recovery…", actions.recover],
  ] as const) {
    if (!action) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = () => {
      dismiss();
      action();
    };
    tools.append(button, " ");
  }
  dialog.append(
    heading,
    explanation,
    estimate,
    persistence,
    persist,
    " ",
    refresh,
    guidance,
    tools,
  );
  host.append(dialog);
  let generation = 0;
  let disposed = false;
  let checkingPersistence = false;
  let requestPending = false;
  let knownPersistent: boolean | undefined;
  const manager = () => (window.isSecureContext ? navigator.storage : undefined);
  const current = (id: number) => !disposed && dialog.open && generation === id;
  const syncButton = () => {
    persist.disabled =
      checkingPersistence ||
      requestPending ||
      knownPersistent === true ||
      typeof manager()?.persist !== "function";
    persist.textContent =
      knownPersistent === true ? "Persistent storage granted" : "Request persistent storage";
  };
  function dismiss() {
    generation++;
    dialog.close();
  }
  close.onclick = dismiss;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) generation++;
  });
  const read = async () => {
    const id = ++generation;
    const storage = manager();
    refresh.disabled = true;
    knownPersistent = undefined;
    checkingPersistence = true;
    syncButton();
    estimate.textContent = "Checking this website’s storage estimate…";
    persistence.textContent = "Checking persistence status…";
    await Promise.all([
      (async () => {
        let text: string;
        try {
          if (typeof storage?.estimate !== "function")
            text = "This browser does not provide a storage estimate here.";
          else {
            const result = await bounded(storage.estimate());
            const usage = validBytes(result?.usage) ? result.usage : undefined;
            const quota = validBytes(result?.quota) ? result.quota : undefined;
            text =
              usage === undefined && quota === undefined
                ? "The browser did not provide a usable storage estimate. Your screenplay has not been checked or changed."
                : `Approximate website storage: ${usage === undefined ? "usage unavailable" : `${bytes(usage)} used`}; ${quota === undefined ? "quota unavailable" : `${bytes(quota)} quota`}.`;
            if (quota === 0)
              text +=
                " The browser reports no storage quota here. Keep an independent download or backup.";
            if (usage !== undefined && quota !== undefined && quota > 0 && usage / quota >= 0.85)
              text +=
                " Reported usage is close to the quota. Keep an independent download or backup before adding more data.";
          }
        } catch {
          text =
            "The storage estimate is unavailable or took too long. You can refresh to try again.";
        }
        if (current(id)) estimate.textContent = text;
      })(),
      (async () => {
        let text: string;
        let persistent: boolean | undefined;
        try {
          if (typeof storage?.persisted !== "function")
            text = "This browser does not provide persistence status here.";
          else {
            const result = await bounded(storage.persisted());
            persistent = typeof result === "boolean" ? result : undefined;
            text =
              persistent === true
                ? "Persistent storage is granted for this website. This reduces automatic eviction; it is not a backup."
                : persistent === false
                  ? "Storage is browser-managed and may be evicted. You can ask the browser to retain this website’s data; it may grant or deny the request."
                  : "The browser did not provide a known persistence status.";
          }
        } catch {
          text = "Persistence status is unavailable or took too long. Refresh to check again.";
        }
        if (current(id)) {
          knownPersistent = persistent;
          checkingPersistence = false;
          persistence.textContent =
            requestPending && persistent !== true
              ? "A browser persistence request is still pending. Finish or dismiss any browser prompt, then refresh."
              : text;
          syncButton();
        }
      })(),
    ]);
    if (current(id)) refresh.disabled = false;
  };
  refresh.onclick = () => {
    void read();
  };
  persist.onclick = async () => {
    const storage = manager();
    if (requestPending || typeof storage?.persist !== "function") return;
    const id = generation;
    requestPending = true;
    checkingPersistence = false;
    refresh.disabled = false;
    syncButton();
    persistence.textContent = "Asking the browser for persistent storage…";
    let finishedWaiting = false;
    try {
      // Invoke synchronously during the user gesture, before any await or permission read.
      let operation: Promise<boolean>;
      try {
        operation = storage.persist();
      } catch (error) {
        requestPending = false;
        throw error;
      }
      const settled = () => {
        requestPending = false;
        if (disposed || !dialog.open) return;
        // A reopened dialog or a timed-out request needs fresh browser truth,
        // rather than an enabled button beside a stale "pending" message.
        if (generation !== id || finishedWaiting) void read();
        else syncButton();
      };
      operation.then(settled, settled);
      const result = await bounded(operation);
      if (!current(id)) return;
      knownPersistent = typeof result === "boolean" ? result : undefined;
      persistence.textContent =
        result === true
          ? "Persistent storage was granted for this website. Keep independent downloads: persistence is not a backup."
          : result === false
            ? "The browser did not grant persistent storage. You can continue writing; keep independent downloads or backups."
            : "The browser did not return a known result. Refresh to check persistence status.";
    } catch (error) {
      if (!current(id)) return;
      persistence.textContent =
        error instanceof Error && error.message === "timeout"
          ? "The browser has not answered yet. Finish or dismiss any browser prompt, then refresh. Your writing is unchanged."
          : "The persistence request could not be completed. Your writing is unchanged; refresh to check the status.";
    } finally {
      finishedWaiting = true;
      // A native permission prompt cannot be canceled by closing this dialog or timing out.
      // Keep a pending request disabled until its actual promise settles.
      if (current(id)) syncButton();
    }
  };
  return {
    open() {
      if (disposed) return;
      if (!dialog.open) dialog.showModal();
      void read();
    },
    close: dismiss,
    dispose() {
      disposed = true;
      generation++;
      dialog.close();
      dialog.remove();
    },
  };
}
