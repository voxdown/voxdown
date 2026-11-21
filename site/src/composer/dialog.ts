/** A dialog in the family's style: a sticky title bar with Close, and a body. */
export function createDialog(id: string, title: string, wide = false) {
  const dialog = document.createElement("dialog");
  dialog.id = id;
  dialog.className = `composer-dialog${wide ? " wide" : ""}`;
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  const header = document.createElement("div");
  header.className = "dialog-header";
  const heading = document.createElement("h2");
  heading.id = `${id}-title`;
  heading.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const body = document.createElement("div");
  body.className = "dialog-body";
  dialog.append(header, body);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return {
    dialog,
    body,
    heading,
    open() {
      if (!dialog.open) dialog.showModal();
      (
        body.querySelector<HTMLElement>("[autofocus], button, input, select, [tabindex='0']") ??
        close
      ).focus();
    },
    close: () => dialog.close(),
  };
}

/** A dialog whose contents are built the first time it opens, from a module loaded then. */
export function lazyDialog(
  id: string,
  title: string,
  wide: boolean,
  fill: () => Promise<Node>,
): ReturnType<typeof createDialog> {
  const made = createDialog(id, title, wide);
  let filled: Promise<void> | null = null;
  const open = made.open;
  return {
    ...made,
    open() {
      filled ??= fill().then((node) => {
        made.body.append(node);
      });
      void filled.then(open);
    },
  };
}
