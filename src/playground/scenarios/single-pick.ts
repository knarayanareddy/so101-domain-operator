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
import type { V3 } from "../sim/kinematics";
import { fbox, A_BASE, B_BASE } from "./dsl";
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
let current: {
  id: string;
  mode: "pick" | "place";
  from: [number, number];
  to: [number, number];
  /** Which arm is executing. Two-arm domains route by proximity. */
  arm: "a" | "b";
} | null = null;
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

/**
 * Where an item is parked after a fetch.
 *
 * Keyed BY ARM, because three of the five domains now spread their materials across
 * the union of both reach envelopes (phone-repair 34.2 cm min separation, pcb 29.7).
 * A single arm-A pad would put deliveries outside arm B's envelope and reintroduce
 * exactly the thin-air grasp this module exists to prevent.
 */
const PAD: Record<string, Record<"a" | "b", [number, number]>> = {
  "phone-repair": { a: [A_BASE[0] + 9, A_BASE[2] + 4], b: [B_BASE[0] - 9, B_BASE[2] + 4] },
  "pcb-assembly": { a: [A_BASE[0] + 9, A_BASE[2] + 2], b: [B_BASE[0] - 9, B_BASE[2] + 2] },
  "lab-samples": { a: [A_BASE[0] + 9, A_BASE[2] - 5], b: [B_BASE[0] - 9, B_BASE[2] - 5] },
  "assistive-handover": { a: [A_BASE[0] + 13, A_BASE[2] + 6], b: [B_BASE[0] - 13, B_BASE[2] + 6] },
  "restock-kiosk": { a: [A_BASE[0] + 10, A_BASE[2] - 4], b: [B_BASE[0] - 10, B_BASE[2] - 4] },
};

function padFor(scenarioId: string, arm: "a" | "b"): [number, number] {
  const e = PAD[scenarioId]?.[arm];
  if (e) return e;
  return arm === "b" ? [B_BASE[0] - 9, B_BASE[2] + 4] : [A_BASE[0] + 9, A_BASE[2] + 4];
}

/**
 * Pick the arm that can actually reach a target, preferring the nearer one.
 *
 * This is the routing rule for the two-arm domains. Returns null only when NEITHER
 * arm can reach, in which case the caller refuses rather than clamping — the same
 * fail-closed rule as planPicks() on the live camera path.
 */
export function chooseArm(
  x: number,
  z: number,
  allowB: boolean,
): "a" | "b" | null {
  const da = Math.hypot(x - A_BASE[0], z - A_BASE[2]);
  if (!allowB) return da <= REACH - MARGIN ? "a" : null;
  const db = Math.hypot(x - B_BASE[0], z - B_BASE[2]);
  const aOk = da <= REACH - MARGIN;
  const bOk = db <= REACH - MARGIN;
  if (!aOk && !bOk) return null;
  if (aOk && bOk) return da <= db ? "a" : "b";
  return aOk ? "a" : "b";
}

function hoverAt(x: number, z: number, base: V3, want = 7): number {
  const d = Math.hypot(x - base[0], z - base[2]);
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
  const allowB = s.arms === 2;
  const byId = new Map<string, PropSpec>(grabbables.map((p) => [p.id, p]));

  /** Both arms parked unless one is working. */
  const resetPose = (): LiveOut => ({
    a: { p: [A_BASE[0] + 13, 9, A_BASE[2] + 4], pitch: -60, grip: 1 },
    ...(allowB ? { b: { p: [B_BASE[0] - 13, 9, B_BASE[2] + 4], pitch: -60, grip: 1 } } : {}),
  });

  return function tick(ctx: LiveCtx): LiveOut {
    // a new request supersedes whatever was in flight
    if (request && request.seq !== stageSeq) {
      const prop = byId.get(request.propId);
      if (!prop) {
        // asked for something this scenario does not place: say so and stay put
        return { ...resetPose(), say: `"${request.propId}" is not in this scenario` };
      }
      stageSeq = request.seq;
      const from: [number, number] = [prop.pos[0], prop.pos[2]];
      const arm = chooseArm(from[0], from[1], allowB);
      if (!arm) {
        // Neither arm can reach it. Say so and stay put — never clamp the target
        // into range, which is how the arm ends up grasping empty table.
        current = null;
        stage = "done";
        return { ...resetPose(), say: `"${prop.label}" is out of both arms' reach` };
      }
      current = {
        id: prop.id,
        mode: request.mode,
        from,
        to: padFor(s.id, arm),
        arm,
      };
      stage = "to-source";
      stageT = 0;
      carried = false;
    }

    if (!current || stage === "idle" || stage === "done") {
      // Nothing requested, or the pick already finished: HOLD. This is the
      // behaviour the panel was missing — no auto-advance to the next item.
      return resetPose();
    }

    stageT += ctx.dt;
    const [fx, fz] = current.from;
    const [tx, tz] = current.to;
    const base: V3 = current.arm === "a" ? A_BASE : B_BASE;
    const fh = hoverAt(fx, fz, base, 6.5);
    const th = hoverAt(tx, tz, base, 6.5);
    /** Park the idle arm so it does not drift while the other works. */
    const idle: LiveOut = current.arm === "a"
      ? (allowB ? { b: { p: [B_BASE[0] - 13, 9, B_BASE[2] + 4], pitch: -60, grip: 1 } } : {})
      : { a: { p: [A_BASE[0] + 13, 9, A_BASE[2] + 4], pitch: -60, grip: 1 } };
    const on = (pose: {
      p: [number, number, number];
      pitch: number;
      grip: number;
      say?: string;
    }): LiveOut => (current!.arm === "a" ? { a: pose, ...idle } : { b: pose, ...idle });

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
        return on({ p: [fx, 1.6, fz], pitch: -90, grip: 0 });

      case "close":
        carried = true;
        if (stageT >= DUR.close) {
          stage = "lift";
          stageT = 0;
        }
        return on({ p: [fx, 1.6, fz], pitch: -90, grip: 1, say: "   ✓ grasp verified" });

      case "lift":
        if (stageT >= DUR.lift) {
          stage = "to-pad";
          stageT = 0;
        }
        return on({ p: [fx, fh, fz], pitch: -90, grip: 1 });

      case "to-pad":
        if (stageT >= DUR["to-pad"]) {
          stage = "lower";
          stageT = 0;
        }
        return on({ p: [tx, th, tz], pitch: -90, grip: 1 });

      case "lower":
        if (stageT >= DUR.lower) {
          stage = "release";
          stageT = 0;
        }
        return on({ p: [tx, 2.0, tz], pitch: -90, grip: 1 });

      case "release":
        carried = false;
        if (stageT >= DUR.release) {
          stage = "done";
          stageT = 0;
        }
        return on({ p: [tx, 2.0, tz], pitch: -90, grip: 0, say: "   ✓ placed — say the next item or 'run the work order'" });

      default:
        return resetPose();
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
  const pa = padFor(s.id, "a");
  const pb = padFor(s.id, "b");
  const fixtures = [
    ...(s.fixtures ?? []),
    fbox(pa[0], 0.15, pa[1], 7, 0.3, 6, 0x2f7d4f, { label: "fetch pad A" }),
    ...(s.arms === 2 ? [fbox(pb[0], 0.15, pb[1], 7, 0.3, 6, 0x2563a8, { label: "fetch pad B" })] : []),
  ];
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
  return live;
}

/** The phone on the mat, exported for scenarios that want it as a fixture. */
export const phoneProp = phoneUnderRepair;