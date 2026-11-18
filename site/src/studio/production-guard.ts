import {
  Annotation,
  EditorState,
  type Extension,
  RangeSet,
  RangeValue,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { parseFountain } from "./fountain";
import { planReserveSceneNumbers, readProduction } from "./production-numbering";

export const productionNumberingAction = Annotation.define<boolean>();
export const productionGuardMessage =
  "Scene numbers are locked. Unlock them in Tools → Scene numbering to edit labels.";

class ProtectedRange extends RangeValue {
  constructor(
    readonly number: string | undefined,
    readonly markerOffset = 0,
  ) {
    super();
  }
}
interface GuardIndex {
  locked: boolean;
  ranges: RangeSet<ProtectedRange>;
}
const marker = /\/\*[ \t]*VoxDown production\b/g;
function index(doc: Text): GuardIndex {
  const source = doc.toString();
  const matches = [...source.matchAll(marker)];
  if (!matches.length) return { locked: false, ranges: RangeSet.empty };
  const parsed = parseFountain(source);
  const ranges = [];
  for (const match of matches) {
    const from = match.index;
    const end = source.indexOf("*/", from + 2);
    // A truncated imported block still locks numbering, without making all the
    // prose after it read-only. Its header can only be changed by an explicit action.
    const to = end < 0 ? doc.lineAt(from).to : end + 2;
    ranges.push(new ProtectedRange(undefined).range(from, to));
  }
  for (const element of parsed.elements) {
    if (element.kind !== "scene" || element.sceneNumber === undefined) continue;
    const raw = source.slice(element.from, element.to);
    const offset = raw.lastIndexOf(`#${element.sceneNumber}#`);
    ranges.push(
      new ProtectedRange(element.sceneNumber, Math.max(0, offset)).range(element.from, element.to),
    );
  }
  return { locked: true, ranges: RangeSet.of(ranges, true) };
}
const examined = new WeakMap<Transaction, GuardIndex>();
function authorized(tr: Transaction) {
  return (
    tr.annotation(productionNumberingAction) === true ||
    tr.isUserEvent("undo") ||
    tr.isUserEvent("redo")
  );
}
function suspicious(tr: Transaction, value: GuardIndex): boolean {
  let result = false;
  tr.changes.iterChanges((from, to, _c, _d, inserted) => {
    if (result) return;
    const added = inserted.toString();
    if (!value.locked) {
      result = added.includes("VoxDown production");
      return;
    }
    if (/[#\[\]/*]/.test(added) || /[#\[\]/*]/.test(tr.startState.doc.sliceString(from, to))) {
      result = true;
      return;
    }
    const first = tr.startState.doc.lineAt(from);
    const last = tr.startState.doc.lineAt(to);
    if (first.text.includes("#") || last.text.includes("#")) {
      result = true;
      return;
    }
    // Boundary changes immediately before a scene can change Fountain's scene
    // classification. Ordinary Enter elsewhere only maps this range index.
    const until =
      last.number < tr.startState.doc.lines ? tr.startState.doc.line(last.number + 1).to : last.to;
    value.ranges.between(first.from, until, () => {
      result = true;
    });
  });
  return result;
}
const guardIndex = StateField.define<GuardIndex>({
  create: (state) => index(state.doc),
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (authorized(tr) || suspicious(tr, value)) return examined.get(tr) ?? index(tr.newDoc);
    return { locked: value.locked, ranges: value.ranges.map(tr.changes) };
  },
});
function counts(value: GuardIndex): Map<string, number> {
  const result = new Map<string, number>();
  for (let cursor = value.ranges.iter(); cursor.value; cursor.next()) {
    const number = cursor.value.number;
    if (number !== undefined) result.set(number, (result.get(number) ?? 0) + 1);
  }
  return result;
}
/** Protect accidental production renumbering. This is an editing aid, not a
 * security boundary: explicit source actions and undo/redo retain normal control. */
export function productionGuard(onBlocked: () => void): Extension {
  return [
    guardIndex,
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || authorized(tr)) return tr;
      const before = tr.startState.field(guardIndex);
      if (!before.locked || !suspicious(tr, before)) return tr;
      let blocked = false;
      const removed = new Map<string, number>();
      tr.changes.iterChanges((from, to) => {
        before.ranges.between(from, to, (start, end, value) => {
          if (value.number === undefined) {
            if (
              ((from < end && to > start) || (from === to && from > start && from < end)) &&
              !(from <= start && to >= end)
            )
              blocked = true;
            return;
          }
          const markerFrom = start + value.markerOffset;
          const markerTo = markerFrom + value.number.length + 2;
          const intersects =
            (from < markerTo && to > markerFrom) ||
            (from === to && from > markerFrom && from < markerTo);
          if (from <= start && to >= end && from !== to) {
            removed.set(value.number, (removed.get(value.number) ?? 0) + 1);
          } else if (intersects) blocked = true;
        });
      });
      if (!blocked) {
        const after = index(tr.newDoc);
        examined.set(tr, after);
        const oldCounts = counts(before);
        const newCounts = counts(after);
        if (!after.locked) blocked = true;
        for (const [number, count] of oldCounts) {
          if ((newCounts.get(number) ?? 0) < count - (removed.get(number) ?? 0)) blocked = true;
        }
        for (const [number, count] of newCounts) {
          if (count > (oldCounts.get(number) ?? 0)) blocked = true;
        }
        // Newly inserted metadata or corruption at its delimiters must not alter
        // the reservation list. Incomplete unrelated notes remain editable.
        const blocks = (value: GuardIndex, doc: Text) => {
          const result: string[] = [];
          for (let cursor = value.ranges.iter(); cursor.value; cursor.next())
            if (cursor.value.number === undefined)
              result.push(doc.sliceString(cursor.from, cursor.to));
          return result;
        };
        if (
          JSON.stringify(blocks(before, tr.startState.doc)) !==
          JSON.stringify(blocks(after, tr.newDoc))
        )
          blocked = true;
      }
      if (!blocked && removed.size) {
        try {
          const source = tr.newDoc.toString();
          const reserved = new Set(readProduction(source).reserved);
          const missing = [...removed.keys()].filter((number) => !reserved.has(number));
          if (missing.length) {
            const plan = planReserveSceneNumbers(source, missing);
            return [
              tr,
              {
                changes: plan.changes,
                sequential: true,
                annotations: productionNumberingAction.of(true),
              },
            ];
          }
        } catch {
          blocked = true;
        }
      }
      if (!blocked) return tr;
      onBlocked();
      return [];
    }),
  ];
}
