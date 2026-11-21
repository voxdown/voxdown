/** Work offline: prepare the app and its instruments for use without a connection. Loaded the first
 * time the dialog opens. */
import { INSTRUMENTS, INSTRUMENT_ORDER } from "./instruments";
import { offlineStatus, prepareOffline } from "./offline";
import type { Player } from "./player";

export function offlinePanel(player: Player): Node {
  const panel = document.createElement("div");
  const intro = document.createElement("p");
  intro.textContent =
    "Composer can open without a connection once it is prepared. Your music is kept in this browser either way; save files to keep copies elsewhere.";
  const status = document.createElement("p");
  status.id = "offline-status";
  status.setAttribute("role", "status");
  const prepare = document.createElement("button");
  prepare.type = "button";
  prepare.className = "primary";
  prepare.textContent = "Prepare for offline use";
  const sounds = document.createElement("button");
  sounds.type = "button";
  sounds.textContent = "Keep every instrument offline (2.6\u00a0MB)";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(sounds, prepare);
  panel.append(intro, status, actions);
  const refresh = async () => {
    status.textContent = "Checking…";
    const state = await offlineStatus().catch(() => ({
      ready: false,
      message: "Offline status is unavailable.",
    }));
    status.textContent = state.message;
  };
  prepare.addEventListener("click", async () => {
    status.textContent = "Preparing…";
    const state = await prepareOffline().catch(() => ({
      ready: false,
      message: "Offline files could not be saved. Check your connection and storage, then retry.",
    }));
    if (!state.ready) {
      status.textContent = state.message;
      return;
    }
    // Playing offline needs the instrument too: keep the one in use.
    const instrument = INSTRUMENTS[player.instrument].label.toLowerCase();
    status.textContent = `${state.message} Keeping the ${instrument}…`;
    try {
      await player.load(player.instrument);
      status.textContent = `${state.message} The ${instrument} is kept too, so tunes play offline.`;
    } catch {
      status.textContent = `${state.message} The ${instrument} could not be kept; reconnect and prepare again to play offline.`;
    }
  });
  sounds.addEventListener("click", async () => {
    sounds.disabled = true;
    try {
      for (const id of INSTRUMENT_ORDER) await player.load(id);
      status.textContent = "Every instrument is kept in this browser.";
    } catch {
      status.textContent =
        "Some instruments could not be downloaded. Check your connection and retry.";
    } finally {
      sounds.disabled = false;
    }
  });
  // Fresh each time the dialog opens, and now, as it opens for the first time.
  const dialog = document.getElementById("offline-dialog") as HTMLDialogElement | null;
  dialog?.addEventListener("toggle", () => {
    if (dialog.open) void refresh();
  });
  void refresh();
  return panel;
}
