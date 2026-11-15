/**
 * Export › A manuscript to submit: the writer's name and how to reach them (kept in this browser
 * for the next one), then the Word document in the standard manuscript format (manuscript.ts).
 */
import { renderBook } from "@voxdown/render";
import { type Story, parse } from "voxdown";
import { paragraphsOf } from "./convert";
import { countsOf } from "./counts";
import { download } from "./files";
import { chapterLevelIn } from "./story-data";

export type ManuscriptHost = {
  story(): Story;
  /** The story's file name without its extension. */
  baseName(): string;
  notice(message: string): void;
};

const CONTACT = "vxd-writer-contact";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

/** The last word of a name: its surname, for the running header. */
const lastWord = (name: string) => name.trim().split(/\s+/).at(-1) ?? "";

export function openManuscript(host: ManuscriptHost): void {
  const dialog = $<HTMLDialogElement>("#manuscript");
  const story = host.story();
  const kept = (() => {
    try {
      return JSON.parse(localStorage.getItem(CONTACT) ?? "{}") as {
        contact?: string;
        surname?: string;
      };
    } catch {
      return {};
    }
  })();
  const contact = $<HTMLTextAreaElement>("#manuscript-contact");
  const byline = $<HTMLInputElement>("#manuscript-byline");
  const surname = $<HTMLInputElement>("#manuscript-surname");
  contact.value = kept.contact ?? "";
  byline.value = story.meta.author ?? kept.contact?.split("\n")[0]?.trim() ?? "";
  surname.value =
    kept.surname || lastWord(contact.value.split("\n")[0] ?? "") || lastWord(byline.value) || "";
  // The surname follows the name until the writer gives one: kept from before, or typed here.
  let given = Boolean(kept.surname);
  surname.oninput = () => {
    given = surname.value.trim() !== "";
  };
  contact.oninput = () => {
    if (!given) surname.value = lastWord(contact.value.split("\n")[0] ?? "");
  };
  $("#manuscript-go").onclick = () => {
    try {
      localStorage.setItem(
        CONTACT,
        JSON.stringify({ contact: contact.value, surname: surname.value }),
      );
    } catch {
      // Kept for this visit only.
    }
    dialog.close();
    // The name it is published under: given, or the whole first line of the contact (a name),
    // never only its surname.
    const name = byline.value.trim() || (contact.value.split("\n")[0] ?? "").trim();
    void exportManuscript(host, {
      contact: contact.value,
      byline: name,
      // The surname for every page's header: given, or the last word of the name it is under.
      surname: surname.value.trim() || lastWord(name) || lastWord(story.meta.author ?? ""),
    });
  };
  dialog.showModal();
  contact.focus();
}

/**
 * The level a manuscript's chapters are: the story's chapter level, unless its headings there are
 * all parts ("Part One", "Book Two"), with headings under them: then those are the chapters, each
 * titled on a page of its own, the parts over them.
 */
export function manuscriptChapterLevel(story: Story): number {
  const level = chapterLevelIn(story);
  const headings = story.blocks.flatMap((block) =>
    block.kind === "heading"
      ? [
          {
            level: block.level,
            name: story.source
              .slice(block.range.from, block.range.to)
              .replace(/^[ \t]*#+[ \t]*/, "")
              .replace(/[ \t]*\{[^}]*\}[ \t]*$/, "")
              .trim(),
          },
        ]
      : [],
  );
  const at = headings.filter((each) => each.level === level && each.name !== story.meta.title);
  const parts = at.length > 0 && at.every((each) => /^(?:part|book|volume)\b/i.test(each.name));
  return parts && headings.some((each) => each.level === level + 1) ? level + 1 : level;
}

async function exportManuscript(
  host: ManuscriptHost,
  who: { contact: string; byline: string; surname: string },
): Promise<void> {
  const story = host.story();
  const level = manuscriptChapterLevel(story);
  // A chapter's or a scene's heading the book never prints (hidden, or for the audio) still
  // starts one: a break, where the manuscript has one (a short story's sections are set apart
  // that way, never each on a page of its own).
  let source = story.source;
  for (const block of [...story.blocks].reverse())
    if (
      block.kind === "heading" &&
      block.level >= level &&
      (block.visibility === "hidden" || block.visibility === "audio")
    )
      source = `${source.slice(0, block.range.from)}* * *${source.slice(block.range.to)}`;
  const printed = source === story.source ? story : parse(source);
  const body = new DOMParser().parseFromString(
    renderBook(printed, { header: false }),
    "text/html",
  ).body;
  const paragraphs = paragraphsOf(body);
  const { manuscriptDocx } = await import("./manuscript");
  const title = story.meta.title ?? host.baseName();
  download(
    manuscriptDocx(paragraphs, {
      ...who,
      chapterLevel: level,
      title,
      words: countsOf(story).words,
      ...(story.meta.language ? { language: story.meta.language } : {}),
    }),
    `${host.baseName()} (manuscript).docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  host.notice("The manuscript is in your downloads.");
}
