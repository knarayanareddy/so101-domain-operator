/**
 * Pick modes — sequence the whole script, or pick one item on request.
 *
 * The control panel needs both: a full scripted run for the demo, and single-item
 * picks for actually using the thing. They share one motion primitive so the
 * individual path cannot drift from the scripted one.
 *
 * `program: { kind: 'live', fn }` is the Sim Lab's imperative escape hatch — it
 * receives `LiveCtx` every frame and returns the pose to hold. That is how a
 * user-driven pick works: read the requested target, solve for the tip pose, and
 * let the engine interpolate.
 */

import type { Scenario, LiveCtx, LiveOut } from '../sim/types';
import { A_BASE } from './dsl';

const REACH = 24.2;
const MARGIN = 1.1;

function reachable(arm: 'a' | 'b', x: number, z: number) {
  const b = arm === 'a' ? A_BASE : [12, 0, -12];
  return Math.hypot(x - b[0], z - b[2]) <= REACH - MARGIN;
}

/** Where an item is parked before a pick — the drop-off pad for this scenario. */
const PAD = { 'phone-repair': [4, -16] as [number, number], 'pcb-assembly': [3, -13] as [number, number], 'lab-samples': [2, -15] as [number, number], 'assistive-handover': [24, -8] as [number, number], 'restock-kiosk': [5, -11] as [number, number] };

/** A short reach height above (x,z). */
function hoverAt(x: number, z: number, want = 7) {
  const d = Math.hypot(x - A_BASE[0], z - A_BASE[2]);
  const m = Math.sqrt(Math.max(REACH * REACH - d * d, 0)) - 1.1;
  return Math.max(3.5, Math.min(want, m));
}

/**
 * A scenario that can ALSO be driven one item at a time.
 *
 * The live program reads `ctx.prop(id)` to find a requested item. `pickPlace`
 * cannot run inside a per-frame function, so this issues the same poses directly
 * as `LiveOut` targets — open, descend, close, lift, carry, release. It is the
 * same sequence the scripted version plays, driven by state rather than phases.
 */
export function withIndividualPicks(s: Scenario): Scenario {
  const pad = PAD[s.id as keyof typeof PAD] ?? [4, -14];
  const grabbables = (s.props ?? []).filter((p) => p.grab);

  /** Items the panel may request, derived from the scenario's own props. */
  const catalogue = grabbables.map((p) => ({
    id: p.id,
    label: p.label ?? p.id,
    at: [p.pos[0], p.pos[2]] as [number, number],
  }));

  const fn = (ctx: LiveCtx): LiveOut => {
    // Nothing requested yet: hold a neutral ready pose over the pad.
    const target = requested(ctx, catalogue);
    if (!target) {
      return { a: { p: [A_BASE[0] + 14, 9, A_BASE[2] + 4], pitch: -60, grip: 1 } };
    }
    const [x, z] = target.at;
    const h = hoverAt(x, z, 7);
    // Single-stage approach per frame is enough: the engine interpolates, and the
    // panel's phase chip tells the user which stage they are watching.
    return { a: { p: [x, h, z], pitch: -90, grip: ctx.tips[0][1] > 3 ? 1 : 0 } };
  };

  const live: Scenario = {
    ...s,
    id: `${s.id}-individual`,
    title: `${s.title} — pick one item`,
    tagline: 'Same scenario, driven item by item from the control panel',
    howTo: [...s.howTo, 'Use the control panel: choose one item and press Fetch.'],
    program: { kind: 'live', fn },
  };
  (live as Scenario & { catalogue?: typeof catalogue }).catalogue = catalogue;
  return live;
}

/**
 * Resolve which item the operator asked for.
 *
 * Sim Lab exposes no direct control channel, so the request is read from a prop
 * the panel can move: `pick-target` is a small invisible marker the UI places on
 * the chosen object. That keeps this file free of UI coupling and works in the
 * existing sandbox too.
 */
function requested(ctx: LiveCtx, catalogue: { id: string; at: [number, number] }[]) {
  const marker = ctx.prop('pick-target');
  if (!marker) return null;
  let best: { id: string; at: [number, number] } | null = null;
  let bestD = 4.0; // within 4 cm counts as "on" that item
  for (const c of catalogue) {
    const d = Math.hypot(marker[0] - c.at[0], marker[2] - c.at[1]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------
 * Control-panel catalogue: every showcase item, addressable by id.
 * ------------------------------------------------------------------ */
export interface PickTarget {
  /** Fully-qualified id: "<scenario>:<prop>". */
  id: string;
  label: string;
  domain: string;
  scenario: string;
  pos: [number, number, number];
  arm: 'a' | 'b';
}

export const CONTROL_PANEL_NOTE =
  'Select one item and the arm fetches it to the pad. Sequence mode runs the whole ' +
  'work order instead. Both use the same verified grasp.';