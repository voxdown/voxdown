import { arrangeDialogHeader } from "./dialog-layout";
import { MAX_PRACTICE_LENGTH, PRACTICE_LESSONS, assessPractice } from "./learning";

export function mountLearning(
  host: HTMLElement,
  actions: { returnToWriting?(): void; openExample?(): void } = {},
) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  }
  function button(text: string, run: () => void) {
    const element = node("button", text);
    element.type = "button";
    element.onclick = run;
    return element;
  }
  const dialog = node("dialog");
  dialog.className = "studio-learning";
  dialog.setAttribute("aria-labelledby", "learning-title");
  const title = node("h2", "Practice Fountain");
  title.id = "learning-title";
  const privacy = node(
    "p",
    "This is a separate, session-only practice pad. Your screenplay stays untouched. Closing clears the practice; nothing here is saved or exported.",
  );
  const close = button("Close practice", dismiss);
  const exercise = node("section");
  const progress = node("p");
  const heading = node("h3");
  heading.id = "learning-lesson";
  const instruction = node("p");
  instruction.id = "learning-help";
  const example = node("details");
  example.open = true;
  const exampleSummary = node("summary", "Example");
  const exampleText = node("pre");
  exampleText.className = "learning-example";
  const useExample = button("Replace practice with example", () => {
    const lesson = PRACTICE_LESSONS[index];
    if (!lesson) return;
    input.value = lesson.example;
    rememberAndAssess();
    input.focus();
  });
  example.append(exampleSummary, exampleText, useExample);
  const label = node("label", "Practice text");
  label.htmlFor = "learning-input";
  const input = node("textarea");
  input.id = "learning-input";
  input.className = "learning-input";
  input.rows = 8;
  input.maxLength = MAX_PRACTICE_LENGTH;
  input.autocomplete = "off";
  input.spellcheck = true;
  input.setAttribute("aria-describedby", "learning-help learning-limit");
  const limit = node(
    "p",
    "Up to 5,000 characters. Use your own words; the lesson checks structure, not an exact sentence.",
  );
  limit.id = "learning-limit";
  const feedback = node("p");
  feedback.className = "learning-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-atomic", "true");
  const previewHeading = node("h4", "What the screenplay contains");
  const preview = node("dl");
  preview.className = "learning-preview";
  preview.setAttribute("aria-label", "Practice screenplay interpretation");
  const previewNote = node("p");
  const reset = button("Reset this lesson", () => {
    input.value = PRACTICE_LESSONS[index]?.starter ?? "";
    rememberAndAssess();
    input.focus();
  });
  const back = button("Previous lesson", () => {
    if (index > 0) {
      index--;
      showLesson();
    }
  });
  const next = button("Next lesson", () => {
    if (!assessPractice(index, input.value).complete) return;
    drafts[index] = input.value;
    if (index === PRACTICE_LESSONS.length - 1) finish(false);
    else {
      index++;
      showLesson();
    }
  });
  const skip = button("Finish without dual dialogue", () => finish(true));
  exercise.append(
    progress,
    heading,
    instruction,
    example,
    label,
    input,
    limit,
    feedback,
    previewHeading,
    preview,
    previewNote,
    reset,
    back,
    next,
    skip,
  );
  const completion = node("section");
  completion.hidden = true;
  const completionTitle = node("h3", "Ready to try a screenplay");
  completionTitle.tabIndex = -1;
  const completionText = node("p");
  const reminder = node(
    "p",
    "Keep writing in your own screenplay, or explore a sample if one is available. This practice text is not copied into either document. [[Notes]] are omitted from screenplay output but remain in shared Fountain source.",
  );
  const returnButton = button("Return to writing", () => {
    dismiss();
    actions.returnToWriting?.();
  });
  completion.append(completionTitle, completionText, reminder, returnButton);
  if (actions.openExample)
    completion.append(
      button("Open a sample screenplay", () => {
        dismiss();
        actions.openExample?.();
      }),
    );
  completion.append(
    button("Back to lessons", () => {
      completion.hidden = true;
      exercise.hidden = false;
      showLesson();
    }),
  );
  dialog.append(title, privacy, close, exercise, completion);
  arrangeDialogHeader(dialog, title, close);
  host.append(dialog);
  let index = 0;
  let drafts: string[] = [];
  let opener: HTMLElement | undefined;
  let composing = false;
  function assess() {
    const result = assessPractice(index, input.value);
    if (feedback.textContent !== result.message) feedback.textContent = result.message;
    feedback.dataset.state = result.complete ? "complete" : "working";
    next.disabled = !result.complete;
    preview.replaceChildren();
    for (const row of result.preview) preview.append(node("dt", row.label), node("dd", row.text));
    previewNote.textContent = [
      result.privatePassages
        ? `${result.privatePassages} completed private ${result.privatePassages === 1 ? "passage is" : "passages are"} omitted here.`
        : "",
      result.shortened ? "Preview shortened to 12 elements and 200 characters per element." : "",
      !result.preview.length ? "No printable elements to show yet." : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  function rememberAndAssess() {
    if (!dialog.open) return;
    drafts[index] = input.value;
    assess();
  }
  function showLesson() {
    const lesson = PRACTICE_LESSONS[index];
    if (!lesson) return;
    exercise.hidden = false;
    completion.hidden = true;
    progress.textContent = `Lesson ${index + 1} of ${PRACTICE_LESSONS.length}`;
    heading.textContent = lesson.title;
    instruction.textContent = lesson.instruction;
    exampleText.textContent = lesson.example;
    input.value = drafts[index] ?? lesson.starter;
    back.disabled = index === 0;
    next.textContent = index === PRACTICE_LESSONS.length - 1 ? "Finish practice" : "Next lesson";
    skip.hidden = index !== PRACTICE_LESSONS.length - 1;
    composing = false;
    assess();
    input.focus();
  }
  function finish(skipped: boolean) {
    if (!dialog.open || index !== PRACTICE_LESSONS.length - 1) return;
    drafts[index] = input.value;
    exercise.hidden = true;
    completion.hidden = false;
    completionText.textContent = skipped
      ? "You worked through scene headings, action, speech, directions and private notes. Dual dialogue can wait until you need it."
      : "You worked through scene headings, action, speech, directions, private notes and dual dialogue. Page preview in the editor shows the full screenplay layout.";
    completionTitle.focus();
  }
  function clear() {
    drafts = [];
    input.value = "";
    preview.replaceChildren();
    feedback.textContent = previewNote.textContent = "";
    composing = false;
  }
  function dismiss() {
    clear();
    dialog.close();
    opener?.focus();
  }
  input.addEventListener("compositionstart", () => {
    composing = true;
    next.disabled = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    rememberAndAssess();
  });
  input.addEventListener("input", () => {
    if (!composing) rememberAndAssess();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) clear();
  });
  return {
    open() {
      if (dialog.open) return;
      clear();
      index = 0;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      dialog.showModal();
      showLesson();
    },
    close: dismiss,
  };
}
