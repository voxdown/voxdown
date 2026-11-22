import { type FountainElement, parseFountain } from "./fountain";
import { fountainRuns } from "./inline";
import { screenplayInsights } from "./insights";
import { assertUnambiguousOmissions } from "./public-source";
import { readSource } from "./source";

export interface RehearsalContext {
  readonly kind: "speech" | "action" | "simultaneous";
  readonly cue?: string;
  readonly text: string;
}
export interface RehearsalCard {
  readonly line: number;
  readonly role: string;
  readonly cue: string;
  readonly scene: number;
  readonly text: string;
  readonly context?: RehearsalContext;
  readonly dual: "none" | "paired" | "unpaired";
}
export interface RehearsalScene {
  readonly id: number;
  readonly heading: string;
  readonly line: number;
}
export interface RehearsalProject {
  readonly roles: readonly { readonly name: string; readonly cues: number }[];
  readonly scenes: readonly RehearsalScene[];
  cards(role: string, scene?: number): readonly RehearsalCard[];
}
const plain = (value: string) =>
  fountainRuns(value)
    .map((run) => run.text)
    .join("");
const speechKinds = new Set(["dialogue", "parenthetical", "lyric"]);
const privateKinds = new Set(["note", "boneyard"]);
type Event = { kind: "speech" | "action"; cue?: string; parts: string[] };
type Speech = {
  line: number;
  role: string;
  cue: string;
  scene: number;
  event: Event;
  preceding?: Event;
  partner?: Speech;
  dual: boolean;
};

/** Read-only, complete public speeches from one source snapshot. The returned
 * project retains no raw source, title fields, private notes or outline text.
 */
export function prepareRehearsal(source: string): RehearsalProject {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error("Close unfinished private notes and omitted passages before rehearsing.");
  assertUnambiguousOmissions(source, document);
  const names = new Map<number, string>();
  for (const role of screenplayInsights(document, source).characters)
    for (const line of role.lines) names.set(line, role.name);
  const scenes: RehearsalScene[] = [{ id: 0, heading: "Before the first scene", line: 1 }];
  const speeches: Speech[] = [];
  let scene = 0;
  let previous: Event | undefined;
  let pairable: Speech | undefined;
  let action: Event | undefined;
  for (let i = 0; i < document.elements.length; i++) {
    const element = document.elements[i] as FountainElement;
    if (privateKinds.has(element.kind)) continue;
    if (element.kind === "scene") {
      scene++;
      scenes.push({ id: scene, heading: plain(element.text), line: element.line });
      previous = pairable = action = undefined;
    } else if (element.kind === "character") {
      action = undefined;
      const parts: string[] = [];
      let spoken = false;
      let end = i + 1;
      for (; end < document.elements.length; end++) {
        const next = document.elements[end] as FountainElement;
        if (privateKinds.has(next.kind)) continue;
        if (!speechKinds.has(next.kind)) break;
        const text = plain(next.text);
        parts.push(text);
        if ((next.kind === "dialogue" || next.kind === "lyric") && text.trim()) spoken = true;
      }
      const role = names.get(element.line);
      if (role && spoken) {
        const event: Event = { kind: "speech", cue: plain(element.text), parts };
        const speech: Speech = {
          line: element.line,
          role,
          cue: event.cue as string,
          scene,
          event,
          ...(previous ? { preceding: previous } : {}),
          dual: Boolean(element.dual),
        };
        if (speech.dual && pairable && !pairable.dual && !pairable.partner) {
          speech.partner = pairable;
          pairable.partner = speech;
        }
        speeches.push(speech);
        previous = event;
        pairable = speech;
      } else pairable = undefined;
      i = end - 1;
    } else if (
      element.kind === "action" ||
      element.kind === "centered" ||
      element.kind === "transition" ||
      element.kind === "lyric"
    ) {
      if (!action) action = { kind: "action", parts: [] };
      action.parts.push(plain(element.text));
      previous = action;
      pairable = undefined;
    } else if (element.kind === "blank") {
      action = undefined;
    } else {
      // Structural divisions cannot create a synthetic cue across scenes/acts.
      previous = pairable = action = undefined;
    }
  }
  const eventText = new Map<Event, string>();
  const textOf = (event: Event) => {
    let text = eventText.get(event);
    if (text === undefined) {
      text = event.parts.join("\n");
      eventText.set(event, text);
    }
    return text;
  };
  const byRole = new Map<string, RehearsalCard[]>();
  for (const speech of speeches) {
    const contextEvent = speech.partner?.event ?? speech.preceding;
    const context = contextEvent
      ? Object.freeze({
          kind: speech.partner ? ("simultaneous" as const) : contextEvent.kind,
          ...(contextEvent.cue ? { cue: contextEvent.cue } : {}),
          text: textOf(contextEvent),
        })
      : undefined;
    const card: RehearsalCard = Object.freeze({
      line: speech.line,
      role: speech.role,
      cue: speech.cue,
      scene: speech.scene,
      text: textOf(speech.event),
      ...(context ? { context } : {}),
      dual: speech.partner ? "paired" : speech.dual ? "unpaired" : "none",
    });
    const cards = byRole.get(speech.role) ?? [];
    cards.push(card);
    byRole.set(speech.role, cards);
  }
  const usedScenes = new Set(speeches.map((speech) => speech.scene));
  const roles = Object.freeze(
    [...byRole].map(([name, cards]) => Object.freeze({ name, cues: cards.length })),
  );
  for (const cards of byRole.values()) Object.freeze(cards);
  return Object.freeze({
    roles,
    scenes: Object.freeze(
      scenes.filter((entry) => usedScenes.has(entry.id)).map((entry) => Object.freeze(entry)),
    ),
    cards(role: string, scene?: number) {
      const cards = byRole.get(role) ?? [];
      return Object.freeze(
        scene === undefined ? cards : cards.filter((card) => card.scene === scene),
      );
    },
  });
}
