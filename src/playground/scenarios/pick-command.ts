/**
 * Natural-language pick commands.
 *
 * The control panel needs "pick up the resistor" to resolve to a specific item
 * without the operator navigating a list. This is deliberately a *pure* resolver:
 * it maps text to an item id and an action, and touches neither the arm nor the
 * renderer. That keeps it unit-testable without WebGL and without hardware, which
 * is the same discipline `decideStep()` follows.
 *
 * Design constraints:
 *  - Closed output set. `PickCommand.action` is `"pick" | "place" | "sequence" | "unknown"`.
 *    Free-form intent strings would just move the ambiguity downstream.
 *  - No fuzzy guessing into motion. An unresolved phrase returns `"unknown"` with
 *    candidates, never a best guess. Picking the wrong part is worse than asking.
 *  - Vocabulary comes from the scenario catalogue, so a term can only resolve if a
 *    scenario actually places that item.
 */

import type { PickTarget } from "./individpick";

export type PickAction = "pick" | "place" | "sequence" | "unknown";

export interface PickCommand {
  action: PickAction;
  /** Fully-qualified target id, when one was resolved. */
  targetId?: string;
  label?: string;
  /** Human-readable reason, always populated. */
  reason: string;
  /** Near matches when nothing resolved exactly — lets the UI offer options. */
  candidates: string[];
}

const STOP = new Set([
  "the", "a", "an", "please", "can", "you", "could", "would", "get", "grab",
  "give", "bring", "me", "for", "to", "of", "and", "then", "now", "just",
]);

/** Words that mean "run the whole thing". */
const SEQUENCE_WORDS = [
  "run all", "run the order", "run the work order", "sequence", "start",
  "go", "begin", "run everything", "full run", "work order",
];

/** Words that mean "put it down where it belongs". */
const PLACE_WORDS = ["place", "put down", "set down", "deliver", "install", "fit", "drop"];

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

/**
 * Score how well an utterance names an item.
 *
 * Deliberately simple and explainable: exact label match beats a whole-word
 * match on a label token, which beats a substring match on the label or the
 * domain. No embeddings — at this vocabulary size they would add a dependency
 * and a failure mode for no accuracy gain.
 */
function score(utterance: string, item: PickTarget): number {
  const u = normalise(utterance);
  const ut = tokens(utterance);
  if (!ut.length) return 0;

  const label = normalise(item.label);
  if (u === label) return 100;
  if (u.includes(label) && label.length > 2) return 80;

  let best = 0;
  for (const w of ut) {
    if (w.length < 3) continue;
    if (label === w) best = Math.max(best, 60);
    else if (label.includes(w)) best = Math.max(best, 40);
    else if (w.includes(label) && label.length > 3) best = Math.max(best, 35);
    // domain word, e.g. "the board" -> logic board
    else if (normalise(item.domain).includes(w)) best = Math.max(best, 20);
  }
  return best;
}

/**
 * Resolve an utterance to a pick command.
 *
 * `catalogue` comes from `showcaseItems()`, so only real, reachable items can be
 * named. Returns `"unknown"` with candidates rather than guessing.
 */
export function resolvePick(utterance: string, catalogue: PickTarget[]): PickCommand {
  const u = normalise(utterance);
  if (!u) {
    return { action: "unknown", reason: "empty request", candidates: [] };
  }

  // Sequence intent wins: "run the work order" must not pick a part.
  if (SEQUENCE_WORDS.some((w) => u.includes(w))) {
    return { action: "sequence", reason: "run the whole work order in sequence", candidates: [] };
  }

  const ranked = catalogue
    .map((item) => ({ item, s: score(utterance, item) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!ranked.length) {
    return {
      action: "unknown",
      reason: `no item matches "${utterance}"`,
      candidates: catalogue.slice(0, 5).map((c) => c.label),
    };
  }

  const top = ranked[0];
  // A weak, contested match is a question, not a command.
  const runnerUp = ranked[1];
  if (top.s < 40 || (runnerUp && top.s - runnerUp.s < 10)) {
    return {
      action: "unknown",
      reason:
        top.s < 40
          ? `ambiguous: "${utterance}" does not name an item clearly`
          : `"${utterance}" matches ${top.item.label} and ${runnerUp.item.label} equally`,
      candidates: ranked.slice(0, 3).map((r) => r.item.label),
    };
  }

  const action: PickAction = PLACE_WORDS.some((w) => u.includes(w)) ? "place" : "pick";
  return {
    action,
    targetId: top.item.id,
    label: top.item.label,
    reason: `${action} "${top.item.label}" (${top.item.domain})`,
    candidates: [],
  };
}

/** Phrases the UI offers as examples, generated from the real catalogue. */
export function examplePhrases(catalogue: PickTarget[]): string[] {
  const picks = catalogue.slice(0, 3).map((c) => `pick up the ${c.label}`);
  const places = catalogue.slice(0, 1).map((c) => `place the ${c.label}`);
  return [...picks, ...places, "run the work order"];
}