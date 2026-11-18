/** Success feedback can yield writing space; attention messages require explicit replacement. */
export type NoticeLifetime = "important" | "success";

export function createNoticePresenter(element: HTMLElement) {
  let lifetime: NoticeLifetime = "important";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");

  return {
    show(message: string, nextLifetime: NoticeLifetime = "important") {
      lifetime = nextLifetime;
      element.textContent = message;
      element.hidden = !message;
    },
    /** Call synchronously only after an accepted source edit, before its new feedback. */
    sourceEdited() {
      if (lifetime !== "success") return;
      element.textContent = "";
      element.hidden = true;
      lifetime = "important";
    },
  };
}
