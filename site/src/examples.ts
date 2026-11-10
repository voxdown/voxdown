/**
 * The examples shelf: every story in the repository's examples folder, and its screenplay
 * imported from Fountain.
 */
import { fromFountain, parse } from "voxdown";

export type Example = { name: string; title: string; byline: string; text: string };

const files = import.meta.glob("../../examples/*.{vxd,fountain}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** How each example is introduced; anything not listed is shown by its title alone. */
const BYLINES: Record<string, string> = {
  "peter-rabbit.vxd": "Beatrix Potter, 1902",
  "the-dragon-who-would-not-roar.vxd": "new",
  "the-north-wind-and-the-sun.vxd": "after Aesop",
  "die-bremer-stadtmusikanten.vxd": "in German",
  "the-lighthouse.vxd": "a screenplay, imported",
};

const ORDER = [
  "the-dragon-who-would-not-roar.vxd",
  "peter-rabbit.vxd",
  "the-north-wind-and-the-sun.vxd",
  "die-bremer-stadtmusikanten.vxd",
  "the-lighthouse.vxd",
];

export const examples: Example[] = Object.entries(files)
  .map(([path, raw]) => {
    const file = path.split("/").pop() ?? path;
    const fountain = file.endsWith(".fountain");
    const name = fountain ? file.replace(/\.fountain$/, ".vxd") : file;
    const text = fountain ? fromFountain(raw) : raw;
    const title = parse(text).meta.title ?? name;
    return { name, title, byline: BYLINES[name] ?? "", text };
  })
  .sort((a, b) => rank(a.name) - rank(b.name));

function rank(name: string): number {
  const index = ORDER.indexOf(name);
  return index < 0 ? ORDER.length : index;
}
