/** File drops are explicit opens, never text insertion or page navigation. Text drags remain native. */
export function mountFileDrop(
  host: Document,
  actions: { open(file: File): void; notice(message: string): void; locked(): boolean },
) {
  const isFiles = (event: DragEvent) =>
    event.dataTransfer?.types.includes("Files") || Boolean(event.dataTransfer?.files.length);
  const fileInput = (event: DragEvent) =>
    event.target instanceof HTMLInputElement && event.target.type === "file";
  const dragover = (event: DragEvent) => {
    if (!isFiles(event) || fileInput(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer)
      event.dataTransfer.dropEffect =
        actions.locked() || host.querySelector("dialog[open]") ? "none" : "copy";
  };
  const drop = (event: DragEvent) => {
    if (!isFiles(event) || fileInput(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (actions.locked() || host.querySelector("dialog[open]")) {
      actions.notice(
        "Close the current dialog and wait for Studio to finish opening before dropping a screenplay.",
      );
      return;
    }
    const files = event.dataTransfer?.files;
    if (files?.length !== 1) {
      actions.notice(
        "Drop one .fountain or .txt screenplay at a time. Your current screenplay is unchanged.",
      );
      return;
    }
    const file = files[0];
    if (!file) return;
    if (!/\.(fountain|txt)$/i.test(file.name)) {
      actions.notice(
        "Drop a .fountain or .txt screenplay. For .fdx, use Commands → Import Final Draft XML; use Backups for a Studio project.",
      );
      return;
    }
    actions.open(file);
  };
  host.addEventListener("dragover", dragover, true);
  host.addEventListener("drop", drop, true);
  return () => {
    host.removeEventListener("dragover", dragover, true);
    host.removeEventListener("drop", drop, true);
  };
}
