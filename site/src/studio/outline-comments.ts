import type { FountainDocument, FountainElement } from "./fountain";

export interface OutlineCommentSnapshot {
  id: string;
  source: string;
}
export interface OutlineComment {
  from: number;
  to: number;
  line: number;
  kind: "note" | "boneyard";
  text: string;
}
export interface OutlineCommentGroup {
  key: string;
  title: string;
  comments: OutlineComment[];
}

/** Only parser-confirmed private passages belong here. Unclosed or escaped markers
 * remain screenplay text and must never be advertised as private comments. */
export function outlineCommentGroups(source: string, parsed: FountainDocument) {
  const groups = new Map<number, OutlineCommentGroup>();
  const occurrences = new Map<string, number>();
  groups.set(0, { key: "before", title: "Before the first scene", comments: [] });
  for (const item of parsed.elements) {
    if (item.kind !== "scene" && item.kind !== "section") continue;
    const identity = `${item.kind}:${item.text}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    groups.set(item.line, {
      key: `${identity}:${occurrence}`,
      title: item.text,
      comments: [],
    });
  }
  let elementIndex = 0;
  let group = groups.get(0);
  for (const omission of parsed.omissions) {
    while (
      elementIndex < parsed.elements.length &&
      (parsed.elements[elementIndex]?.from ?? Number.POSITIVE_INFINITY) <= omission.from
    ) {
      const item = parsed.elements[elementIndex++];
      if (item && groups.has(item.line)) group = groups.get(item.line);
    }
    const element = parsed.elements[Math.max(0, elementIndex - 1)];
    const opening = omission.kind === "note" ? "[[" : "/*";
    const closing = omission.kind === "note" ? "]]" : "*/";
    // Fail closed if a caller accidentally pairs stale parse offsets with new text.
    if (
      source.slice(omission.from, omission.from + 2) !== opening ||
      source.slice(omission.to - 2, omission.to) !== closing
    )
      continue;
    group?.comments.push({
      ...omission,
      line: element?.line ?? 1,
      text: source.slice(omission.from + 2, omission.to - 2).trim(),
    });
  }
  return groups;
}

/** Augments existing heading buttons without replacing their active-scene semantics.
 * Disclosure state lives only in memory; neither private text nor headings are stored. */
export function mountOutlineComments(callbacks: {
  current(): OutlineCommentSnapshot;
  jump(line: number): void;
}) {
  const expanded = new Map<string, boolean>();
  let groups = new Map<number, OutlineCommentGroup>();
  let snapshot: OutlineCommentSnapshot = { id: "", source: "" };
  let sequence = 0;
  const fresh = (captured: OutlineCommentSnapshot) => {
    const current = callbacks.current();
    return captured.id === current.id && captured.source === current.source;
  };
  function rowFor(group: OutlineCommentGroup, heading: HTMLElement): HTMLElement {
    if (!group.comments.length) return heading;
    const captured = snapshot;
    const key = `${captured.id}:${group.key}`;
    const owner = heading.ownerDocument;
    const row = owner.createElement("div");
    row.className = "outline-comment-group";
    const header = owner.createElement("div");
    header.className = "outline-comment-heading";
    const toggle = owner.createElement("button");
    toggle.type = "button";
    toggle.className = "outline-comment-toggle";
    const list = owner.createElement("div");
    list.className = "outline-comment-list";
    list.id = `outline-comments-${++sequence}`;
    toggle.setAttribute("aria-controls", list.id);
    let limit = 50;
    function renderList() {
      list.replaceChildren();
      for (const comment of group.comments.slice(0, limit)) {
        const button = owner.createElement("button");
        button.type = "button";
        button.className = "outline-comment-link";
        const label = comment.kind === "note" ? "Comment" : "Omitted passage";
        const excerpt = comment.text.length > 400 ? `${comment.text.slice(0, 400)}…` : comment.text;
        button.textContent = excerpt || `Empty ${label.toLowerCase()}`;
        button.setAttribute("aria-label", `${label}, line ${comment.line}: ${button.textContent}`);
        button.addEventListener("click", () => {
          if (fresh(captured)) callbacks.jump(comment.line);
        });
        list.append(button);
      }
      if (group.comments.length > limit) {
        const more = owner.createElement("button");
        more.type = "button";
        more.className = "outline-comment-more";
        more.textContent = `Show more (${group.comments.length - limit} remaining)`;
        more.addEventListener("click", () => {
          if (!fresh(captured)) return;
          const nextIndex = limit;
          limit += 50;
          renderList();
          (list.children[nextIndex] as HTMLElement | undefined)?.focus();
        });
        list.append(more);
      }
    }
    function setOpen(open: boolean) {
      toggle.setAttribute("aria-expanded", String(open));
      const count = group.comments.length;
      toggle.setAttribute(
        "aria-label",
        `${open ? "Hide" : "Show"} ${count} ${count === 1 ? "comment" : "comments"} for ${group.title}`,
      );
      toggle.title = `${count} ${count === 1 ? "comment" : "comments"}`;
      toggle.textContent = open ? "⌄" : "›";
      list.hidden = !open;
      if (open && !list.childNodes.length) renderList();
    }
    setOpen(expanded.get(key) ?? false);
    toggle.addEventListener("click", () => {
      if (!fresh(captured)) return;
      const open = toggle.getAttribute("aria-expanded") !== "true";
      expanded.delete(key);
      expanded.set(key, open);
      if (expanded.size > 2000) {
        const oldest = expanded.keys().next().value;
        if (oldest !== undefined) expanded.delete(oldest);
      }
      setOpen(open);
    });
    header.append(toggle, heading);
    row.append(header, list);
    return row;
  }
  return {
    update(next: OutlineCommentSnapshot, parsed: FountainDocument) {
      snapshot = { ...next };
      groups = outlineCommentGroups(next.source, parsed);
    },
    row(item: FountainElement, heading: HTMLButtonElement): HTMLElement {
      const group = groups.get(item.line);
      return group ? rowFor(group, heading) : heading;
    },
    leading(owner: Document = document): HTMLElement | null {
      const group = groups.get(0);
      if (!group?.comments.length) return null;
      const heading = owner.createElement("span");
      heading.className = "outline-comment-leading";
      heading.textContent = group.title;
      return rowFor(group, heading);
    },
  };
}
