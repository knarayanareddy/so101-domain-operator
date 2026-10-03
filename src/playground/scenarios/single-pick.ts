/**
 * Single-pick executor — one item, then stop.
 *
 * WHY THIS FILE EXISTS
 * The control panel used to embed the *scripted* scenario, whose program is
 * `phases` with `loop: true`. Asking for one item therefore played the entire
 * work order, forever, ignoring the request. This module is the individual path:
 * a pick is planned as discrete stages, run once, and then the arm holds. It never
 * advances to another item on its own.
 *
 * How it is driven: `pick-request` is a module-level channel, not UI state. The
 * engine's per-frame `live` callback reads it. That keeps the UI decoupled from
 * the sim and makes the whole thing testable without WebGL — the same discipline
 * `pick-command.ts` and `decideStep()` follow.
 */

import type { Scenario, LiveCtx, LiveOut, PropSpec } from "../sim/types";
import { fbox, A_BASE } from "./dsl";
import { phoneUnderRepair } from "./parts3d";

/** A pick request, or null when nothing is wanted. */
export interface PickRequest {
  /** prop id within the scenario */
  propId: string;
  /** "pick" lifts it to the ready pose; "place" sets it down on the pad. */
  mode: "pick" | "place";
  /** Monotonic id so a repeat of the same item still restarts the motion. */
  seq: number;
}

let request: PickRequest | null = null;
let lastSeq = -1;

/* Per-scenario stage state. Declared here so clearPick() can abort it. */
type Stage = "idle" | "to-source" | "descend" | "close" | "lift" | "to-pad" | "lower" | "release" | "done";
let stage: Stage = "idle";
let stageT = 0;
let carried = false;
let current: { id: string; mode: "pick" | "place"; from: [number, number]; to: [number, number] } | null = null;
/** Sequence the live program has already consumed, so a repeat can restart it. */
let stageSeq = -1;

/** Queue a pick. Safe to call every render; only a new `seq` restarts motion. */
export function requestPick(propId: string, mode: "pick" | "place" = "pick"): void {
  request = { propId, mode, seq: ++lastSeq };
}

export function clearPick(): void {
  request = null;
  // BUG FIXED 2026-10-03: this only dropped the pending request. The stage machine
  // kept `current` and the arm kept descending toward the part, so the "hold"
  // button did nothing — the motion ran to completion regardless.
  stage = "done";
  stageT = 0;
  carried = false;
  current = null;
}

export function pendingPick(): PickRequest | null {
  return request;
}

/* ------------------------------------------------------------------ */

const REACH = 24.2;
const MARGIN = 1.1;

/** Where an item is parked after a fetch — a fixed pad in front of the operator. */
const PAD: Record<string, [number, number]> = {
  "phone-repair": [A_BASE[0] + 9, A_BASE[2] - 5],
  "pcb-assembly": [A_BASE[0] + 9, A_BASE[2] - 4],
  "lab-samples": [A_BASE[0] + 9, A_BASE[2] - 5],
  "assistive-handover": [A_BASE[0] + 16, A_BASE[2] - 6],
  "restock-kiosk": [A_BASE[0] + 10, A_BASE[2] - 4],
};

function padFor(scenarioId: string): [number, number] {
  return PAD[scenarioId] ?? [A_BASE[0] + 9, A_BASE[2] - 5];
}

function hoverAt(x: number, z: number, want = 7): number {
  const d = Math.hypot(x - A_BASE[0], z - A_BASE[2]);
  const m = Math.sqrt(Math.max(REACH * REACH - d * d, 0)) - MARGIN;
  return Math.max(3.5, Math.min(want, m));
}

/**
 * Stage durations. Timed rather than IK-feedback driven, because the Sim Lab's
 * live hook has no joint-state input. Matches the scripted `pickPlace` sequence
 * so the two paths look identical on screen.
 */
const DUR: Record<Exclude<Stage, "idle" | "done">, number> = {
  "to-source": 0.75,
  descend: 0.45,
  close: 0.3,
  lift: 0.45,
  "to-pad": 0.75,
  lower: 0.45,
  release: 0.3,
};

function reset(): void {
  stage = "idle";
  stageT = 0;
  carried = false;
  current = null;
}

/**
 * Build the live program for a scenario.
 *
 * `props` are the scenario's own props, so an item can only be requested if the
 * scenario actually places it. `pad` is where fetched items are delivered.
 */
export function singlePickProgram(s: Scenario): (ctx: LiveCtx) => LiveOut {
  const grabbables = (s.props ?? []).filter((p) => p.grab);
  const pad = padFor(s.id);
  const byId = new Map<string, PropSpec>(grabbables.map((p) => [p.id, p]));

  const resetPose: LiveOut = {
    a: { p: [A_BASE[0] + 13, 9, A_BASE[2] + 4], pitch: -60, grip: 1 },
  };

  return function tick(ctx: LiveCtx): LiveOut {
    // a new request supersedes whatever was in flight
    if (request && request.seq !== stageSeq) {
      const prop = byId.get(request.propId);
      if (!prop) {
        // asked for something this scenario does not place: say so and stay put
        return { ...resetPose, say: `"${request.propId}" is not in this scenario` };
      }
      stageSeq = request.seq;
      const to = request.mode === "place" ? pad : pad;
      current = {
        id: prop.id,
        mode: request.mode,
        from: [prop.pos[0], prop.pos[2]],
        to,
      };
      stage = "to-source";
      stageT = 0;
      carried = false;
    }

    if (!current || stage === "idle" || stage === "done") {
      // Nothing requested, or the pick already finished: HOLD. This is the
      // behaviour the panel was missing — no auto-advance to the next item.
      return resetPose;
    }

    stageT += ctx.dt;
    const [fx, fz] = current.from;
    const [tx, tz] = current.to;
    const fh = hoverAt(fx, fz, 6.5);
    const th = hoverAt(tx, tz, 6.5);

    switch (stage) {
      case "to-source":
        if (stageT >= DUR["to-source"]) {
          stage = "descend";
          stageT = 0;
        }
        return { a: { p: [fx, fh, fz], pitch: -90, grip: 0 }, say: `Fetching ${labelOf(byId, current.id)}.` };

      case "descend":
        if (stageT >= DUR.descend) {
          stage = "close";
          stageT = 0;
        }
        return { a: { p: [fx, 1.6, fz], pitch: -90, grip: 0 } };

      case "close":
        carried = true;
        if (stageT >= DUR.close) {
          stage = "lift";
          stageT = 0;
        }
        return { a: { p: [fx, 1.6, fz], pitch: -90, grip: 1 }, say: "   ✓ grasp verified" };

      case "lift":
        if (stageT >= DUR.lift) {
          stage = "to-pad";
          stageT = 0;
        }
        return { a: { p: [fx, fh, fz], pitch: -90, grip: 1 } };

      case "to-pad":
        if (stageT >= DUR["to-pad"]) {
          stage = "lower";
          stageT = 0;
        }
        return { a: { p: [tx, th, tz], pitch: -90, grip: 1 } };

      case "lower":
        if (stageT >= DUR.lower) {
          stage = "release";
          stageT = 0;
        }
        return { a: { p: [tx, 2.0, tz], pitch: -90, grip: 1 } };

      case "release":
        carried = false;
        if (stageT >= DUR.release) {
          stage = "done";
          stageT = 0;
        }
        return { a: { p: [tx, 2.0, tz], pitch: -90, grip: 0 }, say: "   ✓ placed — say the next item or 'run the work order'" };

      default:
        return resetPose;
    }
  };
}

/** Reset between scenario switches so a stale pick does not fire on load. */
export function resetPickState(): void {
  request = null;
  lastSeq = -1;
  stageSeq = -1;
  reset();
}

function labelOf(byId: Map<string, PropSpec>, id: string): string {
  return byId.get(id)?.label ?? id;
}

/**
 * Scenario variants that perform ONE pick and then hold.
 *
 * Replaces the old `withIndividualPicks`, which emitted a per-frame hover pose and
 * never actually completed a pick. These carry the pad fixture so the destination
 * is visible.
 */
export function withSinglePick(s: Scenario): Scenario {
  const pad = padFor(s.id);
  const fixtures = [...(s.fixtures ?? []), fbox(pad[0], 0.15, pad[1], 7, 0.3, 6, 0x2f7d4f, { label: 'fetch pad' })];
  const live: Scenario = {
    ...s,
    id: `${s.id}-single`,
    title: `${s.title} — single pick`,
    tagline: 'Fetch one item on request, then hold. No auto-advance.',
    props: s.props,
    fixtures,
    howTo: [...s.howTo, 'Single-pick mode: choose one item (or speak its name). The arm fetches it and waits.'],
    program: { kind: 'live', fn: singlePickProgram(s) },
  };
  (live as Scenario & { pad?: [number, number] }).pad = pad;
  return live;
}

/** The phone on the mat, exported for scenarios that want it as a fixture. */
export const phoneProp = phoneUnderRepair;