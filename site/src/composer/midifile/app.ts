/**
 * The MIDI import report: what became of the tracks, the grid, what was guessed and what was left
 * out, with a way to import again at another grid (or with the drums kept).
 */
import "./midifile.css";
import { createDialog } from "../dialog";
import { GRID_NAMES, type Grid, type MidiOptions } from "./convert";
import type { MidiImport } from "./index";

let dialog: ReturnType<typeof createDialog> | null = null;

export function showMidiReport(
  result: MidiImport,
  name: string,
  summary: string,
  again: (options: MidiOptions) => Promise<void>,
) {
  dialog ??= createDialog("midi-report", "Imported from MIDI");
  const shown = dialog;
  const body = shown.body;
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
  section("Good to know", result.report.notes);
  section(
    "Left out",
    result.report.dropped.map((item) => `${item.count} ${item.label}`),
  );

  // Import again: another grid, the drums kept or not.
  const form = document.createElement("form");
  form.className = "midi-again";
  const heading = document.createElement("h3");
  heading.textContent = "Import again";
  const select = (id: string, label: string, options: [string, string][], chosen: string) => {
    const wrap = document.createElement("label");
    wrap.htmlFor = id;
    wrap.textContent = label;
    const control = document.createElement("select");
    control.id = id;
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = value === chosen;
      control.append(option);
    }
    wrap.append(control);
    return { wrap, control };
  };
  const grid = select(
    "midi-grid",
    "Grid",
    (["auto", "8", "16", "32", "triplets", "mixed"] as Grid[]).map((key) => [key, GRID_NAMES[key]]),
    result.options.grid,
  );
  const fields = document.createElement("div");
  fields.className = "midi-again-fields";
  fields.append(grid.wrap);
  const drums = result.hasDrums
    ? select(
        "midi-drums",
        "Drums",
        [
          ["omit", "Left out"],
          ["staff", "On a percussion staff"],
        ],
        result.options.drums,
      )
    : null;
  if (drums) fields.append(drums.wrap);
  const status = document.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  const row = document.createElement("div");
  row.className = "dialog-actions";
  const redo = document.createElement("button");
  redo.type = "submit";
  redo.textContent = "Import again";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary";
  done.textContent = "OK";
  done.addEventListener("click", () => shown.close());
  row.append(redo, done);
  form.append(heading, fields, status, row);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "Importing again…";
    redo.disabled = true;
    void again({
      grid: grid.control.value as Grid,
      drums: (drums?.control.value ?? result.options.drums) as MidiOptions["drums"],
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : "That didn't work.";
      redo.disabled = false;
    });
  });
  body.append(form);
  shown.open();
  done.focus();
}
