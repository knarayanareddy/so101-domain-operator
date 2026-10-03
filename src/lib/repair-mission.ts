/**
 * Phone-repair assist scene.
 *
 * A parts-tray fetch-and-place sequence driven by the technician's checklist. The
 * arm fetches the part for the current step, places it on the work mat, and the
 * ledger records what was verified and by which input.
 *
 * Implements docs/specs/2026-10-03-phone-repair-scene.md.
 *
 * Deliberate constraints:
 *  - Camera-free (needsCamera: false). Works with no webcam, headless, offline.
 *  - Every pick goes through `Runner.pick`, so grasps are stall-verified and a
 *    failure streak aborts the mission (spec B4). No direct `arm.grasp()` shortcut.
 *  - Never enables torque itself (spec D1).
 *  - No HTTP or serial access in this file (spec F5). Optional board input arrives
 *    as an injected `OptionalInputs`; omit it and everything still runs.
 *
 * Parts are distinct-size coloured blocks, not realistic components: the detector
 * is HSV thresholding and the grasp is stall-based, so both are indifferent to what
 * an object represents. The block-colour to part-name mapping lives in PART_TABLE,
 * which makes a customer's real parts tray a data change rather than a code change.
 */

import type { Runner, Mission, ParamDef } from "./missions";
import type { SimObject } from "./sim";
import { RepairLedgerBuilder, formatSummary, type RepairLedger, type Verdict } from "./repair";
import type { OptionalInputs, TrayProbe } from "./repair-inputs";

/** Part identity. `block` is the physical stand-in; `label` is what the technician calls it. */
export interface RepairPart {
  id: string;
  label: string;
  /** RGB of the stand-in block. Distinct across parts (spec A2). */
  rgb: [number, number, number];
  /** Tray slot this part lives in, e.g. "tray-1". */
  slot: string;
  /** Block edge in cm. Varying sizes make each part visually unambiguous. */
  w: number;
  h: number;
}

const P = (key: string, label: string, value: number): ParamDef => ({ key, label, value });

/** Where the technician's work mat is. Parts land here. */
export const MAT = { x: 6, y: 0 };

/**
 * The customer's tray. In a real deployment this comes from the work order; here it
 * is a table so the scene is self-contained and testable.
 */
export const PART_TABLE: RepairPart[] = [
  { id: "part-battery", label: "battery", rgb: [40, 80, 210], slot: "tray-1", w: 3, h: 2 },
  { id: "part-screen", label: "screen", rgb: [40, 170, 70], slot: "tray-2", w: 4, h: 0.6 },
  { id: "part-board", label: "logic board", rgb: [210, 40, 40], slot: "tray-3", w: 5, h: 0.5 },
];

export interface StepOutcome {
  verdict: Verdict;
  reason: string;
  confirmed: boolean;
}

/**
 * Decide a step's verdict. Pure and exported, so the decision table is testable
 * with no robot, camera, or board.
 *
 * Precedence is deliberate:
 *   1. arm failed to deliver        -> fail    (we know it went wrong)
 *   2. board says the tray is empty -> fail    (we know it went wrong)
 *   3. board unreachable / uncalibrated -> unknown (we did not check)
 *   4. board confirms occupancy     -> pass
 *   5. no board supplied at all     -> pass    (the arm's own verified grasp is evidence)
 *
 * Rule 5 keeps the scene runnable with zero extra hardware. Rule 3 stops
 * "unavailable" from masquerading as "wrong", which is how a QA record loses trust.
 */
export function decideStep(o: { delivered: boolean; probe?: TrayProbe | undefined }): StepOutcome {
  if (!o.delivered) {
    return {
      verdict: "fail",
      reason: "arm could not deliver the part (grasp or slip check failed)",
      confirmed: false,
    };
  }
  const p = o.probe;
  if (p === undefined) {
    return {
      verdict: "pass",
      reason: "arm delivered the part (stall-verified grasp + slip check)",
      confirmed: false,
    };
  }
  if (p.occupied === false) {
    return { verdict: "fail", reason: `tray reads empty after delivery — ${p.reason}`, confirmed: false };
  }
  if (p.occupied === null) {
    return { verdict: "unknown", reason: p.reason, confirmed: false };
  }
  return {
    verdict: "pass",
    reason: `arm delivered and tray confirms occupancy — ${p.reason}`,
    confirmed: true,
  };
}

/** Virtual-table layout: the three parts in their tray rows. */
export function repairScene(p: Record<string, number>): SimObject[] {
  const dx = p.trayX ?? 15;
  const pitch = p.pitch ?? 4;
  return PART_TABLE.map((part, i) => ({
    id: part.id,
    name: part.label,
    rgb: part.rgb,
    x: dx,
    y: -12 + i * pitch,
    z: 0,
    w: part.w,
    h: part.h,
    held: false,
    kind: "object" as const,
  }));
}

/** A caller-supplied slot for the ledger a run produced, so it can be read back
 *  as a typed value instead of parsed out of a log string (spec C5). */
export type LedgerSink = { current: RepairLedger | null };

/**
 * Build the mission.
 *
 * `inputs` — optional, additive. Omit it and the scene still runs and still
 * produces a complete ledger.
 * `sink`   — optional. If given, receives the finished ledger.
 */
export function phoneRepairMission(inputs?: OptionalInputs, sink?: LedgerSink): Mission {
  return {
    id: "phone-repair",
    title: "Phone-Repair Assist",
    emoji: "🔧",
    category: "Lab & Industry",
    summary:
      "Fetches each part from its labelled tray onto the work mat in checklist order and records a verified ledger of what was done.",
    novelty:
      "Modelled on a technician's workflow rather than a party trick: parts bins, step order, an exportable record. Every pick is stall-verified; every verdict names the input that proved it.",
    sensors: [
      "3 coloured blocks (one per part) on taped tray marks",
      "Optional: Atech distance sensor over a tray for occupancy confirmation",
    ],
    needsCamera: false,
    params: [
      P("trayX", "Tray column X", 15),
      P("pitch", "Tray row pitch (cm)", 4),
      P("matX", "Work mat X", 6),
      P("steps", "Steps to run", 3),
    ],
    run: async (r: Runner, p: Record<string, number>): Promise<string> => {
      const builder = new RepairLedgerBuilder("phone-repair", Date.now());
      const n = Math.max(1, Math.min(PART_TABLE.length, Math.round(p.steps ?? PART_TABLE.length)));
      const matX = p.matX ?? MAT.x;
      const trayX = p.trayX ?? 15;
      const pitch = p.pitch ?? 4;
      const parts = PART_TABLE.slice(0, n);

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const rowY = -12 + i * pitch;

        r.log(`step ${i + 1}/${parts.length}: fetch ${part.label} from ${part.slot}`);

        // One verified pick with a single retry. Runner.pick owns the failure-streak
        // valve (spec B4): four failures in a row throws and stops the mission.
        const delivered =
          (await r.pick(trayX, rowY, { grabZ: part.h + 0.6 })) ||
          (await r.pick(trayX, rowY, { grabZ: part.h + 0.6 }));

        if (delivered) await r.place(matX, MAT.y, part.h + 0.4);

        // Probe only if the caller supplied an input. Absent stays absent, which is
        // what separates "pass" (arm evidence) from "unknown" (board unreachable).
        const probe = inputs?.trayOccupancy ? await inputs.trayOccupancy(part.slot) : undefined;
        const outcome = decideStep({ delivered, probe });
        const confirmed = outcome.confirmed || (inputs?.stepConfirmed ? await inputs.stepConfirmed() : false);

        builder.add({
          part: part.id,
          action: `fetch ${part.label} from ${part.slot} to work mat`,
          verdict: outcome.verdict,
          reason: outcome.reason,
          evidence: probe && probe.occupied !== null ? "sensor" : "arm",
          confirmed,
        });

        r.log(`  -> ${outcome.verdict}: ${outcome.reason}`);
      }

      await r.home();

      // Steps not selected for this run are recorded, not silently omitted: a record
      // that hides what it did not check is not a record.
      for (const part of PART_TABLE.slice(n)) {
        builder.unknown(part.id, `fetch ${part.label} from ${part.slot} to work mat`, "step not selected for this run");
      }

      const ledger = builder.build();
      if (sink) sink.current = ledger;
      return `${formatSummary(ledger)} — step ${n}/${n} complete`;
    },
  };
}