// @vitest-environment happy-dom
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import {
  type BookEntry,
  PLAYER_SCRIPT,
  exportName,
  htmlBook,
  playerNotes,
  standaloneSvg,
  tuneTimeline,
} from "../src/composer/exports";
import { writeMidi } from "../src/composer/midi";
import { parseXml } from "../src/composer/musicxml/xml";
import { readZip, writeZip } from "../src/composer/musicxml/zip";
import { tuneSource } from "../src/composer/score";
import { indexFile, tuneLabel } from "../src/composer/tunes";
import { readMidi } from "./midi-read";

/** A drawing shaped like abcjs's, with our highlight classes on it. */
const DRAWN = `<svg xmlns="http://www.w3.org/2000/svg" class="abcjs-container" width="740.5" height="210" style="overflow: visible" aria-hidden="true" data-tune="1">
<style>.abcjs-dragging-in-progress text { user-select: none; }</style><title xmlns="http://www.w3.org/1999/xhtml">Sheet Music for "A &amp; B"</title>
<g class="abcjs-staff abcjs-l0"><path class="abcjs-note abcjs-n0 is-caret is-playing" fill="currentColor" stroke="none" d="M10 10h5"/></g>
<text class="abcjs-annotation" font-family="&quot;Recursive Variable&quot;" font-size="11" fill="currentColor" x="20" y="30">2nd time <tspan class="abc-dyn">p</tspan></text>
<text class="abcjs-title" font-family="&quot;Literata Variable&quot;, Georgia, serif" x="300" y="20">A &amp; B</text>
</svg>`;
const drawn = () =>
  new DOMParser().parseFromString(DRAWN, "image/svg+xml").documentElement as unknown as Element;

const BOOK = `X:1
T:The <First> & Best
C:Trad.
M:2/4
L:1/8
K:G
GABc|d2B2|]

X:2
T:Jumps
M:1/4
L:1/4
Q:1/4=120
K:C
C|!segno!D|"^To Coda"E|!D.S.alcoda!F|!coda!G|]
`;

describe("SVG export", () => {
  it("writes a standalone SVG: valid XML, a viewBox, no classes or styles, colours and fonts written in", () => {
    const svg = standaloneSvg(drawn(), { title: "A & B" });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg')).toBe(
      true,
    );
    // Strictly well-formed: our own XML reader takes it.
    const root = parseXml(svg);
    expect(root.name).toBe("svg");
    expect(root.attrs).toMatchObject({
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 740.5 210",
      width: "741",
      height: "210",
      role: "img",
      fill: "#000000",
    });
    expect(svg).not.toMatch(/\sclass=|\sstyle=|data-tune|aria-hidden|is-caret|currentColor/);
    expect(root.children[0]).toMatchObject({ name: "title", text: "A & B" });
    expect(root.children[1]).toMatchObject({
      name: "rect",
      attrs: { x: "0", y: "0", width: "740.5", height: "210", fill: "#ffffff", stroke: "none" },
    });
    // abcjs's own stylesheet and XHTML title are gone; one title, ours.
    expect(svg).not.toMatch(/<style|Sheet Music for|xhtml/);
    expect(svg.match(/<title>/g)).toHaveLength(1);
    expect(svg).toContain('font-family="&quot;Recursive Variable&quot;, sans-serif"');
    expect(svg).toContain('font-family="&quot;Literata Variable&quot;, Georgia, serif"');
    expect(svg).toContain('<tspan font-weight="bold" font-style="italic">p</tspan>');
  });
  it("can take the current look's colours", () => {
    const svg = standaloneSvg(drawn(), {
      title: "Dark",
      colours: { ink: "rgb(230, 230, 230)", paper: "rgb(20, 22, 24)" },
      declaration: false,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="rgb(20, 22, 24)" stroke="none"');
    expect(svg).toContain('fill="rgb(230, 230, 230)" stroke="none"');
  });
});

describe("the HTML tune book", () => {
  const entries: BookEntry[] = [
    {
      title: "The <First> & Best",
      subtitle: "Trad. · K:G",
      svg: '<svg viewBox="0 0 10 10"></svg>',
      abc: "X:1\nT:The <First> & Best",
    },
    {
      title: "Jumps",
      subtitle: "",
      svg: '<svg viewBox="0 0 10 10"></svg>',
      abc: "X:2\nT:Jumps",
      notes: [[0, 0.5, 60, 80]],
    },
  ];
  const read = (html: string) => new DOMParser().parseFromString(html, "text/html");
  it("lists the tunes, links each, draws them, and needs no scripts", () => {
    const html = htmlBook(entries, { name: "Book & Co", abc: "closed", player: false });
    expect(html).not.toContain("<script");
    const page = read(html);
    expect(page.title).toBe("Book & Co");
    const links = [...page.querySelectorAll("nav a")].map((link) => link.getAttribute("href"));
    expect(links).toEqual(["#tune-1", "#tune-2"]);
    for (const link of links)
      expect(page.querySelector(link as string)?.querySelector("svg")).toBeTruthy();
    expect(page.querySelector("#tune-1 h2")?.textContent).toBe("The <First> & Best");
    expect(page.querySelectorAll("details:not([open])")).toHaveLength(2);
    expect(page.querySelector("#tune-1 pre")?.textContent).toBe("X:1\nT:The <First> & Best");
    expect(html).toMatch(/@media print\{[^]*\.tune\{break-before:page;break-inside:avoid/);
  });
  it("shows the ABC, or leaves it out, as chosen", () => {
    expect(
      read(htmlBook(entries, { name: "B", abc: "open", player: false })).querySelectorAll(
        "details[open]",
      ),
    ).toHaveLength(2);
    expect(
      read(htmlBook(entries, { name: "B", abc: "none", player: false })).querySelectorAll(
        "details",
      ),
    ).toHaveLength(0);
  });
  it("adds a small offline player when asked: a Play button where there are notes", () => {
    const html = htmlBook(entries, { name: "B", abc: "closed", player: true });
    const page = read(html);
    expect(page.querySelectorAll("button.play")).toHaveLength(1);
    expect(JSON.parse(page.getElementById("tune-2-notes")?.textContent ?? "[]")).toEqual([
      [0, 0.5, 60, 80],
    ]);
    expect(PLAYER_SCRIPT.length).toBeLessThan(2 * 1024);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});

describe("exports for every tune", () => {
  it("names files from titles, made safe and never twice", () => {
    const taken = new Set<string>();
    expect(exportName("The <First> & Best", "mid", taken)).toBe("The -First- & Best.mid");
    expect(exportName("The <First> & Best", "mid", taken)).toBe("The -First- & Best (2).mid");
    expect(exportName("A/B: C?", "svg")).toBe("A-B- C.svg");
  });
  it("builds each tune's timeline as the player does, D.S. al Coda included", () => {
    const file = indexFile(BOOK);
    const jumps = file.tunes[1] as never;
    const timeline = tuneTimeline(
      abcjs,
      tuneSource({ text: BOOK, file, tune: jumps }).source,
      true,
    );
    expect(timeline?.notes.map((note) => note.pitch)).toEqual([60, 62, 64, 65, 62, 64, 67]);
    expect(timeline?.returns?.map((each) => each.label)).toEqual(["D.S.", "Coda"]);
    const written = tuneTimeline(
      abcjs,
      tuneSource({ text: BOOK, file, tune: jumps }).source,
      false,
    );
    expect(written?.notes.map((note) => note.pitch)).toEqual([60, 62, 64, 65, 67]);
    // Half a second a quarter at 120.
    expect(playerNotes(timeline as never).slice(0, 2)).toEqual([
      [0, 0.5, 60, expect.any(Number)],
      [0.5, 0.5, 62, expect.any(Number)],
    ]);
  });
  it("puts every tune's MIDI in one .zip, a file each", async () => {
    const file = indexFile(BOOK);
    const taken = new Set<string>();
    const files = file.tunes.map((tune) => ({
      name: exportName(tuneLabel(tune), "mid", taken),
      data: writeMidi(
        tuneTimeline(abcjs, tuneSource({ text: BOOK, file, tune }).source, true) as never,
        {
          title: tuneLabel(tune),
        },
      ),
    }));
    const entries = readZip(writeZip(files));
    expect(entries.map((entry) => entry.name)).toEqual(["The -First- & Best.mid", "Jumps.mid"]);
    const second = readMidi(await (entries[1] as (typeof entries)[number]).data());
    expect(second.tracks[0]?.name).toBe("Jumps");
    expect(second.tracks[1]?.notes.map((note) => note.pitch)).toEqual([60, 62, 64, 65, 62, 64, 67]);
    const first = readMidi(await (entries[0] as (typeof entries)[number]).data());
    expect(first.tracks[1]?.notes).toHaveLength(6);
  });
});
