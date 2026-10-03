import { describe, expect, it } from "vitest";
import { A_BASE } from "../scenarios/dsl";
import { showcaseScenarios, showcaseById } from "../scenarios/showcase";
import { ALL_SCENARIOS } from "../scenarios";
import {
  requestPick,
  clearPick,
  pendingPick,
  resetPickState,
  withSinglePick,
} from "../scenarios/single-pick";
import type { LiveCtx } from "../sim/types";

const ids = ["phone-repair", "pcb-assembly", "lab-samples", "assistive-handover", "restock-kiosk"];

/** Drive the live program at a fixed timestep, like the render loop does. */
function makeCtx(dt = 1 / 60): LiveCtx {
  return {
    t: 0,
    dt,
    tips: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    bases: [
      [A_BASE[0], 0, A_BASE[2]],
      [12, 0, -12],
    ],
    prop: () => undefined,
    laser: null,
    pointer: null,
    triggers: 0,
  };
}

describe("single pick: one fetch, then hold", () => {
  it("registers a single-pick variant for every showcase domain", () => {
    for (const id of ids) {
      const v = ALL_SCENARIOS.find((s) => s.id === `${id}-single`);
      expect(v, `${id}-single`).toBeDefined();
      expect(v!.program.kind, id).toBe("live");
      // the scripted variant must still exist and still loop — that is the demo
      expect(ALL_SCENARIOS.find((s) => s.id === id)!.program.kind, id).toBe("phases");
    }
  });

  it("does nothing at all until a pick is requested", () => {
    resetPickState();
    const s = showcaseById("phone-repair")!;
    const fn = withSinglePick(s).program as { kind: "live"; fn: (c: LiveCtx) => unknown };
    const ctx = makeCtx();
    // no request queued -> must hold the ready pose, not move toward anything
    for (let i = 0; i < 600; i++) {
      const out = fn.fn(ctx) as { a?: { p: number[] } };
      expect(out.a?.p, `frame ${i}`).toBeDefined();
      const p = out.a!.p;
      // parked at the ready pose, not descending to any part
      expect(p[1]).toBeGreaterThan(6);
    }
  });

  it("fetches the requested item and then STOPS — no auto-advance", () => {
    resetPickState();
    const s = showcaseById("phone-repair")!;
    const fn = withSinglePick(s).program as { kind: "live"; fn: (c: LiveCtx) => unknown };
    const ctx = makeCtx();
    const battery = (s.props ?? []).find((p) => p.id === "part-battery")!;
    const screen = (s.props ?? []).find((p) => p.id === "part-screen")!;

    requestPick("part-battery", "pick");
    expect(pendingPick()?.propId).toBe("part-battery");

    // run 20 s of frames: far longer than one pick takes
    let said: string[] = [];
    for (let i = 0; i < 1200; i++) {
      const out = fn.fn(ctx) as { a?: { p: number[] }; say?: string };
      if (out.say) said.push(out.say);
    }

    // it went to the battery, not the screen
    const wentToBattery = said.some((t) => /battery/i.test(t));
    expect(wentToBattery, `narration was: ${said.join(" | ")}`).toBe(true);
    // and nothing ever announced the next item
    expect(said.some((t) => /screen|logic board|step 2|step 3/i.test(t)), said.join(" | ")).toBe(false);
    expect(battery).toBeDefined();
    expect(screen).toBeDefined();
  });

  it("returns to hold after a completed pick instead of repeating", () => {
    resetPickState();
    const s = showcaseById("phone-repair")!;
    const fn = withSinglePick(s).program as { kind: "live"; fn: (c: LiveCtx) => unknown };
    const ctx = makeCtx();
    requestPick("part-battery", "pick");
    for (let i = 0; i < 1200; i++) fn.fn(ctx);
    // after completion the pose must be the neutral ready pose again
    const out = fn.fn(ctx) as { a?: { p: number[] } };
    expect(out.a?.p[1]).toBeGreaterThan(6);
  });

  it("clearPick stops an in-flight pick", () => {
    resetPickState();
    const s = showcaseById("phone-repair")!;
    const fn = withSinglePick(s).program as { kind: "live"; fn: (c: LiveCtx) => unknown };
    const ctx = makeCtx();
    requestPick("part-battery", "pick");
    for (let i = 0; i < 30; i++) fn.fn(ctx);
    clearPick();
    expect(pendingPick()).toBeNull();
    for (let i = 0; i < 600; i++) {
      const out = fn.fn(ctx) as { a?: { p: number[] } };
      expect(out.a?.p[1], `frame ${i} after hold`).toBeGreaterThan(6);
    }
  });

  it("a repeat of the SAME item restarts the motion", () => {
    resetPickState();
    const s = showcaseById("phone-repair")!;
    const fn = withSinglePick(s).program as { kind: "live"; fn: (c: LiveCtx) => unknown };
    const ctx = makeCtx();
    requestPick("part-battery", "pick");
    for (let i = 0; i < 1200; i++) fn.fn(ctx);
    // asking again for the same item must work, not be swallowed as "already done"
    requestPick("part-battery", "pick");
    let moved = false;
    for (let i = 0; i < 120; i++) {
      const out = fn.fn(ctx) as { say?: string };
      if (out.say && /battery/i.test(out.say)) moved = true;
    }
    expect(moved, "repeat request should restart the pick").toBe(true);
  });

  it("refuses an item this scenario does not place, and stays put", () => {
    resetPickState();
    const s = showcaseById("phone-repair")!;
    const fn = withSinglePick(s).program as { kind: "live"; fn: (c: LiveCtx) => unknown };
    const ctx = makeCtx();
    requestPick("reel-r", "pick"); // a PCB item, not in the phone scenario
    const out = fn.fn(ctx) as { a?: { p: number[] }; say?: string };
    expect(out.say).toMatch(/not in this scenario/i);
    expect(out.a?.p[1]).toBeGreaterThan(6);
  });

  it("every single-pick variant only addresses reachable props", () => {
    for (const id of ids) {
      const v = ALL_SCENARIOS.find((s) => s.id === `${id}-single`)!;
      const allowBoth = (v.arms ?? 1) === 2;
      for (const p of v.props ?? []) {
        if (!p.grab) continue;
        const dA = Math.hypot(p.pos[0] - A_BASE[0], p.pos[2] - A_BASE[2]);
        const dB = Math.hypot(p.pos[0] - 12, p.pos[2] + 12);
        const ok = allowBoth ? Math.min(dA, dB) <= 24.2 - 1.1 : dA <= 24.2 - 1.1;
        expect(ok, `${id}/${p.id} unreachable`).toBe(true);
      }
    }
  });

  it("the old individpick module is no longer wired in", () => {
    // guard against the buggy per-frame-hover implementation coming back
    expect(ALL_SCENARIOS.some((s) => s.id.endsWith("-individual"))).toBe(false);
  });
});

describe("scenario count", () => {
  it("showcase is 5 scripted + 5 single-pick", () => {
    expect(showcaseScenarios()).toHaveLength(5);
    for (const id of ids) {
      expect(ALL_SCENARIOS.some((s) => s.id === id)).toBe(true);
      expect(ALL_SCENARIOS.some((s) => s.id === `${id}-single`)).toBe(true);
    }
  });
});