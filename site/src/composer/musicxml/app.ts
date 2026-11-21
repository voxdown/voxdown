/**
 * MusicXML in the app: the import report, and exporting tunes. Part of the MusicXML module, loaded
 * the first time it is used.
 */
import { createDialog } from "../dialog";
import { download } from "../local-file";
import { plainMessage } from "../plain";
import { loadAbcjs, tuneSource } from "../score";
import { abcName } from "../source";
import { type FileIndex, type TuneInfo, tuneLabel } from "../tunes";
import { exportMusicXml } from "./export";
import type { ImportReport } from "./import";
import { writeZip } from "./zip";

// biome-ignore lint/suspicious/noExplicitAny: abcjs's parse has no published types.
type Any = any;

let importDialog: ReturnType<typeof createDialog> | null = null;
/** What an import kept, left out and approximated. */
export function showImportReport(report: ImportReport, name: string, summary: string) {
  importDialog ??= createDialog("import-report", "Imported from MusicXML");
  const dialog = importDialog;
  const body = dialog.body;
  body.replaceChildren();
  const lead = document.createElement("p");
  lead.textContent = summary;
  const source = document.createElement("p");
  source.className = "hint";
  source.textContent = `From ${name}. It is now ABC text in a new draft: the score is drawn from it, and ${name} is left as it was.`;
  body.append(lead, source);
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("ul");
    list.className = "import-list";
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      list.append(entry);
    }
    body.append(heading, list);
  };
  section(
    "Left out",
    report.dropped.map((item) =>
      item.label === "page layout"
        ? "Page layout (margins, spacing, fonts, credits)"
        : `${item.count} ${item.label}`,
    ),
  );
  section("Good to know", report.notes);
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary";
  done.textContent = "OK";
  done.addEventListener("click", () => dialog.close());
  const row = document.createElement("div");
  row.className = "dialog-actions";
  row.append(done);
  body.append(row);
  dialog.open();
}

/** MusicXML out: this tune, or every tune as .musicxml files in one .zip. */
export async function exportMusicXmlFiles(context: {
  all: boolean;
  text: string;
  file: FileIndex;
  tune: TuneInfo | null;
  name: string;
  notice: (message: string, kind?: "success") => void;
  noticeError: (message: string) => void;
}) {
  const { all, text, file: index, notice, noticeError } = context;
  const tunes = all ? index.tunes : context.tune ? [context.tune] : [];
  if (!tunes.length) return notice("Write a tune first: there is nothing to export yet.");
  try {
    const abcjs = await loadAbcjs();
    const encoder = new TextEncoder();
    const date = new Date().toISOString().slice(0, 10);
    const used = new Set<string>();
    const files = tunes.map((tune) => {
      const { source } = tuneSource({ text, file: index, tune });
      const parsed = (abcjs as Any).parseOnly(source)[0];
      let base = abcName(tuneLabel(tune)).replace(/\.abc$/, "");
      // Two tunes with one title get numbered names in the .zip.
      for (let count = 2; used.has(base); count++)
        base = `${abcName(tuneLabel(tune)).replace(/\.abc$/, "")} ${count}`;
      used.add(base);
      return {
        name: `${base}.musicxml`,
        data: encoder.encode(exportMusicXml(parsed, { date })),
      };
    });
    if (files.length === 1) {
      const [file] = files as [(typeof files)[number]];
      download(file.data as BlobPart, file.name, "application/vnd.recordare.musicxml+xml");
      notice(`Exported ${file.name}: open it in MuseScore, Dorico, Finale or Sibelius.`, "success");
    } else {
      const zipName = `${abcName(context.name).replace(/\.abc$/, "")} (MusicXML).zip`;
      download(writeZip(files) as BlobPart, zipName, "application/zip");
      notice(`Exported ${files.length} tunes as MusicXML in ${zipName}.`, "success");
    }
  } catch (error) {
    noticeError(
      `The MusicXML could not be written. ${plainMessage(error, "The details are in the browser's console.")}`,
    );
  }
}
