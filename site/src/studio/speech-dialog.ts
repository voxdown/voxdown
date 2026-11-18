import {
  MAX_SPEECH_LENGTH,
  type SpeechEditPlan,
  planSpeechEdit,
  selectSpeech,
} from "./speech-edit";
type Snapshot = { source: string; id: string };
export function mountSpeechEditor(
  host: HTMLElement,
  actions: {
    current(): Snapshot;
    apply(snapshot: Snapshot, plan: SpeechEditPlan): boolean;
  },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "studio-speech-editor";
  const title = document.createElement("h2");
  title.id = "speech-editor-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const description = document.createElement("p");
  description.textContent =
    "Edit this complete speech in Fountain. This includes its parentheticals, lyrics and private [[notes]] or /* omitted passages */. Private text appears here because you are editing its source; completed comments remain excluded from screenplay exports. The character cue stays unchanged.";
  const label = document.createElement("label");
  label.textContent = "Speech source";
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "Speech source");
  input.rows = 12;
  input.maxLength = MAX_SPEECH_LENGTH;
  input.spellcheck = true;
  input.style.width = "100%";
  input.style.maxWidth = "100%";
  label.append(input);
  const help = document.createElement("p");
  help.textContent =
    "An empty line ends a speech. A line containing two spaces keeps an intentional blank dialogue line. Preview checks that other speakers, scenes and private passages remain unchanged.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const preview = document.createElement("button");
  preview.type = "button";
  preview.textContent = "Preview speech edit";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply speech edit";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.onclick = () => dialog.close();
  dialog.append(title, description, label, help, status, preview, apply, cancel);
  host.append(dialog);
  let snapshot: Snapshot | undefined;
  let cueLine = 0;
  let plan: SpeechEditPlan | undefined;
  function invalidate() {
    plan = undefined;
    apply.disabled = true;
  }
  function isCurrent() {
    const now = actions.current();
    return snapshot && snapshot.id === now.id && snapshot.source === now.source;
  }
  input.oninput = () => {
    invalidate();
    status.textContent = "Preview your changes before applying.";
  };
  preview.onclick = () => {
    invalidate();
    if (!snapshot || !isCurrent()) {
      status.textContent = "The screenplay changed. Close and reopen this speech before editing.";
      return;
    }
    try {
      plan = planSpeechEdit(snapshot.source, cueLine, input.value);
      status.textContent = plan.changes.length
        ? "Ready to apply this speech. The cue and surrounding screenplay are unchanged. Undo will restore the entire original speech."
        : "This speech is unchanged.";
      apply.disabled = !plan.changes.length;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "This edit could not be checked.";
    }
  };
  apply.onclick = () => {
    if (!snapshot || !plan?.changes.length) return;
    if (!isCurrent()) {
      invalidate();
      status.textContent = "The screenplay changed. Close and reopen this speech before applying.";
      return;
    }
    try {
      if (actions.apply(snapshot, plan)) dialog.close();
      else {
        invalidate();
        status.textContent =
          "The screenplay changed. Close and reopen this speech before applying.";
      }
    } catch {
      invalidate();
      status.textContent =
        "The speech could not be applied. Your proposed text remains here; the screenplay was not confirmed changed.";
    }
  };
  dialog.addEventListener("close", () => {
    // A queued close event must not clear a dialog already reopened in the same turn.
    if (dialog.open) return;
    snapshot = undefined;
    plan = undefined;
    input.value = "";
  });
  return {
    open(line: number) {
      snapshot = actions.current();
      cueLine = line;
      invalidate();
      try {
        const speech = selectSpeech(snapshot.source, cueLine);
        title.textContent = `Edit speech — line ${cueLine}`;
        input.value = speech.source;
        input.disabled = preview.disabled = false;
        status.textContent = "Preview your changes before applying.";
      } catch (error) {
        title.textContent = "Speech unavailable";
        input.value = "";
        input.disabled = preview.disabled = true;
        status.textContent =
          error instanceof Error ? error.message : "This speech could not be opened.";
      }
      dialog.showModal();
      (input.disabled ? cancel : input).focus();
    },
  };
}
