import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { marksField, sceneNumbers } from "../src/editor/decorations";
import { sceneNameChange, spokenName } from "../src/editor/scene-names";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [marksField] });
const numbersOf = (doc: string) => {
  const state = stateOf(doc);
  return [...sceneNumbers(state)].map(([from, n]) => [state.doc.lineAt(from).text, n]);
};
/** The text after pressing the speaker on the mark that starts `mark`, named `name`. */
const press = (doc: string, mark: string, name: string) => {
  const state = stateOf(doc);
  const change = sceneNameChange(state, doc.indexOf(mark), name);
  return doc.slice(0, change.from) + change.insert + doc.slice(change.to);
};

describe("scenes in text order (owner, 9 Nov)", () => {
  it("numbers a new break by where it is, the first scene having none before it", () => {
    expect(numbersOf("One.\n\n---\n\nTwo.\n\n---\n\nThree.")).toEqual([
      ["---", 2],
      ["---", 3],
    ]);
    // A break typed between two others takes its place, and the ones after move up.
    expect(numbersOf("One.\n\n---\n\nTwo.\n\n---\n\nNew.\n\n---\n\nThree.")).toEqual([
      ["---", 2],
      ["---", 3],
      ["---", 4],
    ]);
  });

  it("counts headings as scenes, and a text that opens with one starts at 1", () => {
    expect(numbersOf("## The kitchen {hidden}\n\nOne.\n\n---\n\nTwo.")).toEqual([
      ["## The kitchen {hidden}", 1],
      ["---", 2],
    ]);
  });

  it("skips a mark with nothing after it before the next, as Apply does (r18)", () => {
    expect(numbersOf("One.\n\n---\n\n---\n\nTwo.\n\n---\n\nThree.")).toEqual([
      ["---", 2],
      ["---", 3],
    ]);
    expect(numbersOf("One.\n\n---\n\n## Den\n\nTwo.\n\n---\n\nThree.")).toEqual([
      ["## Den", 2],
      ["---", 3],
    ]);
    expect(numbersOf("One.\n\n---\n\n")).toEqual([]);
  });

  it("reads past the front matter to see whether the story opens with a scene", () => {
    const front = "---\naudiobook-markup: 0.1\ntitle: Toast\n---\n\n";
    expect(numbersOf(`${front}---\n\nOne.\n\n---\n\nTwo.`)).toEqual([
      ["---", 1],
      ["---", 2],
    ]);
    expect(numbersOf(`${front}One.\n\n---\n\nTwo.`)).toEqual([["---", 2]]);
  });
});

describe("a scene's name read aloud (owner, 9 Nov)", () => {
  it("writes the name as a line of its own after the break, and takes it out again", () => {
    const doc = "One.\n\n---\n\nTwo.";
    const on = press(doc, "---", "Scene 2");
    expect(on).toBe("One.\n\n---\n\nScene 2.\n\nTwo.");
    expect(spokenName(stateOf(on), "One.\n\n---".length, "Scene 2")).toMatchObject({
      said: "Scene 2.",
      stale: false,
    });
    expect(press(on, "---", "Scene 2")).toBe(doc);
  });

  it("reads a heading's name, keeping a name's own punctuation and escaping marks", () => {
    const doc = "## The kitchen {hidden}\n\nOne.";
    expect(press(doc, "##", "The kitchen")).toBe("## The kitchen {hidden}\n\nThe kitchen.\n\nOne.");
    expect(press("## Wait!\n\nOne.", "##", "Wait!")).toBe("## Wait!\n\nWait!\n\nOne.");
    expect(press("## A [b]\n\nOne.", "##", "A [b]")).toBe("## A [b]\n\nA \\[b\\].\n\nOne.");
  });

  it("takes out a name typed by hand as heard only", () => {
    expect(press("One.\n\n---\n\n{audio only} Scene 2.\n\nTwo.", "---", "Scene 2")).toBe(
      "One.\n\n---\n\nTwo.",
    );
  });

  it("is off for a story's own paragraph, and says the new number when the scene's changed", () => {
    const after = "One.\n\n---".length;
    const story = stateOf("One.\n\n---\n\nScene 2.\nAnd more.\n\nTwo.");
    expect(spokenName(story, after, "Scene 2")).toBeNull();
    expect(spokenName(stateOf("One.\n\n---\n\nTwo.\n\nThree."), after, "Scene 2")).toBeNull();
    const old = "One.\n\n---\n\nScene 2.\n\nTwo.";
    expect(spokenName(stateOf(old), after, "Scene 3")).toMatchObject({ stale: true });
    expect(press(old, "---", "Scene 3")).toBe("One.\n\n---\n\nScene 3.\n\nTwo.");
    // A heading's own words that aren't a number are never taken for an old name.
    expect(spokenName(stateOf("## Den\n\nThe kitchen.\n\nTwo."), 6, "Den")).toBeNull();
  });

  it("knows a directed name by its words, and takes it out or renumbers it, marks kept (r18)", () => {
    const after = "One.\n\n---".length;
    const directed = "One.\n\n---\n\n@(brightly) Scene 2.\n\nTwo.";
    expect(spokenName(stateOf(directed), after, "Scene 2")).toMatchObject({
      said: "Scene 2.",
      stale: false,
    });
    expect(press(directed, "---", "Scene 2")).toBe("One.\n\n---\n\nTwo.");
    expect(spokenName(stateOf(directed), after, "Scene 3")).toMatchObject({ stale: true });
    expect(press(directed, "---", "Scene 3")).toBe("One.\n\n---\n\n@(brightly) Scene 3.\n\nTwo.");
    const given = "One.\n\n---\n\n@Cook (softly) “Scene 2.”\n\nTwo.";
    expect(press(given, "---", "Scene 3")).toBe("One.\n\n---\n\n@Cook (softly) “Scene 3.”\n\nTwo.");
    const heard = "## Pantry\n\n{audio only} @(softly) Kitchen.\n\nTwo.";
    expect(press(heard, "##", "Pantry")).toBe(
      "## Pantry\n\n{audio only} @(softly) Pantry.\n\nTwo.",
    );
  });

  it("gives the name a paragraph of its own when no blank line follows the mark (r18)", () => {
    const doc = "One.\n\n---\nTwo.\n\nSafe.";
    const on = press(doc, "---", "Scene 2");
    expect(on).toBe("One.\n\n---\n\nScene 2.\n\nTwo.\n\nSafe.");
    expect(spokenName(stateOf(on), "One.\n\n---".length, "Scene 2")).toMatchObject({
      stale: false,
    });
    expect(press(on, "---", "Scene 2")).toBe("One.\n\n---\n\nTwo.\n\nSafe.");
    expect(press("## Den {hidden}\nOne.", "##", "Den")).toBe("## Den {hidden}\n\nDen.\n\nOne.");
  });

  it("knows a renamed heading's old name, and says its number in the story's language (r18)", () => {
    const renamed = "## The Pantry\n\nThe Hallway.\n\nOne.";
    expect(spokenName(stateOf(renamed), 13, "The Pantry")).toBeNull();
    expect(spokenName(stateOf(renamed), 13, "The Pantry", "The Hallway")).toMatchObject({
      stale: true,
    });
    const state = stateOf(renamed);
    const change = sceneNameChange(state, 0, "The Pantry", "The Hallway");
    expect(renamed.slice(0, change.from) + change.insert + renamed.slice(change.to)).toBe(
      "## The Pantry\n\nThe Pantry.\n\nOne.",
    );
    expect(press("Een.\n\n---\n\nToneel 2.\n\nTwee.", "---", "Toneel 3")).toBe(
      "Een.\n\n---\n\nToneel 3.\n\nTwee.",
    );
    expect(press("一。\n\n---\n\n第2场。\n\n二。", "---", "第3场")).toBe(
      "一。\n\n---\n\n第3场。\n\n二。",
    );
    expect(press("一。\n\n---\n\n二。", "---", "第2场")).toBe("一。\n\n---\n\n第2场。\n\n二。");
  });
});
