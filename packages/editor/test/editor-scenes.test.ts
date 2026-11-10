import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { marksField, sceneNumbers } from "../src/decorations";
import {
  nameReadAt,
  readNamesField,
  readSceneNameSpec,
  sceneNameChange,
  spokenName,
} from "../src/scene-names";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [marksField] });
const numbersOf = (doc: string) => {
  const state = stateOf(doc);
  return [...sceneNumbers(state)].map(([from, n]) => [state.doc.lineAt(from).text, n]);
};
/** The text after pressing the speaker on the mark that starts `mark`, named `name`. */
const press = (doc: string, mark: string, name: string, was?: string) => {
  const state = stateOf(doc);
  const change = sceneNameChange(state, doc.indexOf(mark), name, was);
  return change ? doc.slice(0, change.from) + change.insert + doc.slice(change.to) : doc;
};

describe("scenes in text order", () => {
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

  it("skips a mark with nothing after it before the next, as a host applying it does", () => {
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
    const front = "---\nvoxdown: 1.0\ntitle: Toast\n---\n\n";
    expect(numbersOf(`${front}---\n\nOne.\n\n---\n\nTwo.`)).toEqual([
      ["---", 1],
      ["---", 2],
    ]);
    expect(numbersOf(`${front}One.\n\n---\n\nTwo.`)).toEqual([["---", 2]]);
  });
});

describe("a scene's name read aloud", () => {
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

  it("knows a directed name by its words, and takes it out or renumbers it, marks kept", () => {
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

  it("gives the name a paragraph of its own when no blank line follows the mark", () => {
    const doc = "One.\n\n---\nTwo.\n\nSafe.";
    const on = press(doc, "---", "Scene 2");
    expect(on).toBe("One.\n\n---\n\nScene 2.\n\nTwo.\n\nSafe.");
    expect(spokenName(stateOf(on), "One.\n\n---".length, "Scene 2")).toMatchObject({
      stale: false,
    });
    expect(press(on, "---", "Scene 2")).toBe("One.\n\n---\n\nTwo.\n\nSafe.");
    expect(press("## Den {hidden}\nOne.", "##", "Den")).toBe("## Den {hidden}\n\nDen.\n\nOne.");
  });

  it("knows a renamed heading's old name, and says its number in the story's language", () => {
    const renamed = "## The Pantry\n\nThe Hallway.\n\nOne.";
    expect(spokenName(stateOf(renamed), 13, "The Pantry")).toBeNull();
    expect(spokenName(stateOf(renamed), 13, "The Pantry", "The Hallway")).toMatchObject({
      stale: true,
    });
    expect(press(renamed, "##", "The Pantry", "The Hallway")).toBe(
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

  it("changes only the spoken words of an old name, its sound, note and pause kept", () => {
    const doc =
      "Alpha.\n\n## The Pantry {hidden}\n\n@Rupert (brightly) “The Kitchen.” [small bell] %% Keep the chime. %% {pause 1.2s}\n\nBravo.";
    expect(press(doc, "##", "The Pantry", "The Kitchen")).toBe(
      "Alpha.\n\n## The Pantry {hidden}\n\n@Rupert (brightly) “The Pantry.” [small bell] %% Keep the chime. %% {pause 1.2s}\n\nBravo.",
    );
  });

  it("remembers the name it wrote, so a heading renamed before the host applies it is known", () => {
    const doc = "Alpha.\n\n## The Kitchen {hidden}\n\nBravo.";
    let state = EditorState.create({ doc, extensions: [marksField, readNamesField] });
    const at = doc.indexOf("##");
    const spec = readSceneNameSpec(state, at, "The Kitchen");
    expect(spec).not.toBeNull();
    state = state.update(spec ?? {}).state;
    expect(state.doc.toString()).toBe(
      "Alpha.\n\n## The Kitchen {hidden}\n\nThe Kitchen.\n\nBravo.",
    );
    // Renamed by hand, before the host applies anything: the line still says the old name, and is out of date.
    const word = state.doc.toString().indexOf("Kitchen {hidden}");
    state = state.update({
      changes: { from: word, to: word + "Kitchen".length, insert: "Pantry" },
    }).state;
    expect(nameReadAt(state, at)).toBe("The Kitchen");
    const markEnd = state.doc.lineAt(at).to;
    expect(spokenName(state, markEnd, "The Pantry", nameReadAt(state, at))).toMatchObject({
      stale: true,
    });
    state = state.update(
      readSceneNameSpec(state, at, "The Pantry", nameReadAt(state, at)) ?? {},
    ).state;
    expect(state.doc.toString()).toBe("Alpha.\n\n## The Pantry {hidden}\n\nThe Pantry.\n\nBravo.");
    expect(nameReadAt(state, at)).toBe("The Pantry");
  });
});
