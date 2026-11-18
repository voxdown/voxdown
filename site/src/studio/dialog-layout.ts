/** Reparent existing controls without changing their handlers or accessible names. */
export function arrangeDialogHeader(
  dialog: HTMLDialogElement,
  title: HTMLElement,
  close: HTMLButtonElement,
) {
  const previous = title.parentElement;
  const header = dialog.ownerDocument.createElement("header");
  header.className = "studio-dialog-header";
  header.append(title, close);
  dialog.prepend(header);
  dialog.classList.add("studio-dialog-layout");
  close.classList.add("studio-dialog-close");
  if (previous && previous !== dialog && !previous.childNodes.length) previous.remove();
  return header;
}

export function dialogActions(...buttons: HTMLButtonElement[]) {
  const row = document.createElement("div");
  row.className = "studio-dialog-actions";
  row.append(...buttons);
  return row;
}

export function dialogSection(title: string, ...children: HTMLElement[]) {
  const section = document.createElement("section");
  section.className = "studio-dialog-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, ...children);
  return section;
}

export function dialogDisclosure(label: string, ...content: HTMLElement[]) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary, ...content);
  return details;
}

export function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}
