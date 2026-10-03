/**
 * Optional Atech board input for the repair ledger.
 *
 * ADDITIVE BY CONTRACT. With no board, no server, or an unreachable server, every
 * probe returns `undefined` and the caller records `unknown` — the run still
 * completes and still produces a ledger. See spec group F.
 *
 * The mission body never touches this module's transport directly; it only reads
 * `probe()` (spec F5). That keeps the HTTP/serial concern out of the domain logic
 * and makes the ledger testable with a plain function.
 *
 * The board is read by `tools/atech_watch.py` (separate process, separate serial
 * port). We speak plain HTTP to it. Nothing here can actuate a robot: the upstream
 * service whitelists LED/display actions and rejects set_torque/move_all/move_joint.
 */

export interface TrayProbe {
  /** Whether the tray reads as occupied, unoccupied, or unknown. */
  occupied: boolean | null;
  /** Raw millimetres when available. */
  distance_mm?: number;
  /** Human-readable explanation, always populated. */
  reason: string;
}

export interface OptionalInputs {
  /** Tray-slot occupancy keyed by slot id, e.g. "tray-1". Absent when unavailable. */
  trayOccupancy?: (slot: string) => Promise<TrayProbe>;
  /** True when a technician explicitly confirmed the current step. */
  stepConfirmed?: () => Promise<boolean>;
  /** Short description of what was actually reachable, for the ledger reason field. */
  describe?: () => string;
}

const TIMEOUT_MS = 700;

async function getJson(url: string): Promise<unknown> {
  // `fetch` exists in Node 18+ and in the browser. Both consumers are supported.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build an `OptionalInputs` against a running atech_watch.
 *
 * Nothing here throws: any transport, JSON, or timeout failure becomes
 * `occupied: null` with the reason attached. A dead sensor must not be able to
 * fail a repair run.
 */
export function atechInputs(baseUrl = "http://127.0.0.1:8767"): OptionalInputs {
  const unreachable = (why: string): TrayProbe => ({
    occupied: null,
    reason: `Atech board unavailable (${why}) — occupancy not verified`,
  });

  return {
    async trayOccupancy(slot: string): Promise<TrayProbe> {
      // Slot-to-distance thresholds are the customer's calibration, not ours.
      // Default: treat <400 mm as occupied, >=400 mm as empty.
      const thresholds = SLOT_THRESHOLDS[slot];
      if (!thresholds) return { occupied: null, reason: `no threshold calibrated for ${slot}` };
      try {
        const data = (await getJson(`${baseUrl}/events`)) as {
          connected?: boolean;
          latest?: Record<string, unknown>;
        };
        if (!data.connected) return unreachable("board not connected");
        const raw = data.latest?.distance ?? data.latest?.min_distance;
        if (typeof raw !== "number") return unreachable("no distance reading yet");
        const occupied = raw < thresholds.occupiedBelowMm;
        return {
          occupied,
          distance_mm: raw,
          reason: `Atech distance ${raw} mm ${occupied ? "<" : "≥"} ${thresholds.occupiedBelowMm} mm`,
        };
      } catch (e) {
        return unreachable(e instanceof Error ? e.message : String(e));
      }
    },

    async stepConfirmed(): Promise<boolean> {
      try {
        const data = (await getJson(`${baseUrl}/events`)) as {
          latest?: Record<string, unknown>;
        };
        return data.latest?.button_1 === 1;
      } catch {
        return false;
      }
    },

    describe: () => `Atech board @ ${baseUrl}`,
  };
}

/**
 * Occupancy thresholds per tray slot, in millimetres.
 *
 * A VL53L5CX measures to the nearest surface, so "occupied" means something is
 * within this range of the sensor. Calibrate against the real tray and real parts;
 * the default is a placeholder and is deliberately not presented as measured.
 */
export const SLOT_THRESHOLDS: Record<string, { occupiedBelowMm: number }> = {
  "tray-1": { occupiedBelowMm: 400 },
  "tray-2": { occupiedBelowMm: 400 },
  "tray-3": { occupiedBelowMm: 400 },
};