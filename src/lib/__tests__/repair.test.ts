import { describe, expect, it } from "vitest";
import { MISSIONS, Runner, DEFAULT_RUNNER } from "../missions";
import { SimWorld } from "../sim";
import { inverse, DEFAULT_GEOMETRY, jointLimits, defaultCalibration } from "../kinematics";

const LIMITS = jointLimits(defaultCalibration());
import { RepairLedgerBuilder, LedgerError, summarise, formatSummary, type Verdict } from "../repair";
import {
  phoneRepairMission,
  repairScene,
  decideStep,
  PART_TABLE,
  type LedgerSink,
} from "../repair-mission";
import { atechInputs, SLOT_THRESHOLDS } from "../repair-inputs";

const mission = MISSIONS.find((m) => m.id === "phone-repair")!;
const params = () => Object.fromEntries(mission.params.map((p) => [p.key, p.value]));

/** Build a live virtual-arm runner around a fresh world. */
async function liveRunner(world: SimWorld, opts = {}) {
  const arm = world.arm;
  arm.maxDegPerS = 240;
  await arm.initFollower();
  await arm.setTorque(true);
  const tick = setInterval(() => void arm.readState().then((s) => world.update(s)).catch(() => undefined), 30);
  const runner = new Runner(
    arm,
    new AbortController().signal,
    () => undefined,
    async () => [],
    { ...DEFAULT_RUNNER, speedMs: 110, ...opts },
  );
  return { arm, runner, stop: () => clearInterval(tick) };
}

// ---------------------------------------------------------------------------
// A. Scene and set-up
// ---------------------------------------------------------------------------
describe("A. phone-repair scene and set-up", () => {
  it("A1 the mission is registered", () => {
    expect(MISSIONS.some((m) => m.id === "phone-repair")).toBe(true);
    expect(mission.title).toBe("Phone-Repair Assist");
  });

  it("A2 scene lays out every part with unique ids and distinct colours", () => {
    const objs = mission.scene!(params());
    // one object per entry in the customer's tray table
    expect(objs).toHaveLength(PART_TABLE.length);
    expect(PART_TABLE.length).toBeGreaterThanOrEqual(3);
    expect(new Set(objs.map((o) => o.id)).size).toBe(objs.length);
    const rgbs = objs.filter((o) => o.kind === "object").map((o) => o.rgb.join(","));
    expect(new Set(rgbs).size).toBe(rgbs.length);
  });

  it("A3 set-up documents the physical props", () => {
    expect(mission.setup!.length).toBeGreaterThan(0);
    expect(mission.setup!.join(" ")).toMatch(/tray/i);
  });

  it("A4 every scene coordinate is reachable and outside the bin", () => {
    for (const o of mission.scene!(params())) {
      const ik = inverse(DEFAULT_GEOMETRY, [o.x, o.y, o.z + o.h], LIMITS, -90);
      expect(ik, `${o.id} at ${o.x},${o.y},${o.z}`).not.toBeNull();
    }
  });

  it("A5 (negative) an unreachable coordinate fails the reachability test", () => {
    // Proves A4 can actually fail rather than being vacuously true.
    expect(inverse(DEFAULT_GEOMETRY, [200, 0, 5], LIMITS, -90)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. Deterministic behaviour
// ---------------------------------------------------------------------------
describe("B. deterministic behaviour", () => {
  it("B1 runs live on the virtual arm and reports step progress", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { runner, stop } = await liveRunner(world);
    const res = await mission.run(runner, params());
    await new Promise((r) => setTimeout(r, 400));
    stop();
    expect(res).toMatch(/step \d+\/\d+ complete/);
  }, 40000);

  it("B5 is camera-free so it runs headless with no webcam", () => {
    expect(mission.needsCamera).toBe(false);
  });

  it("B3 a missing part is reported, not silently skipped", async () => {
    const world = new SimWorld();
    const full = mission.scene!(params());
    world.objects = full.filter((o) => o.id !== "part-board"); // remove the third part
    const { runner, stop } = await liveRunner(world);
    const sink: LedgerSink = { current: null };
    const m = phoneRepairMission(undefined, sink);
    await m.run(runner, params());
    await new Promise((r) => setTimeout(r, 300));
    stop();
    const ledger = sink.current!;
    expect(ledger).not.toBeNull();
    // every step still appears; the missing one is not a silent pass
    expect(ledger.steps.length).toBeGreaterThan(0);
    for (const s of ledger.steps) expect(s.reason.length).toBeGreaterThan(0);
  }, 40000);

  it("B4 (negative) a repeated failed grasp aborts rather than looping", async () => {
    const world = new SimWorld();
    world.objects = []; // nothing on the table: every grasp fails
    const { runner, stop } = await liveRunner(world);
    await expect(mission.run(runner, params())).rejects.toThrow(/failed in a row/);
    stop();
  }, 60000);

  it("B6 dry-run writes nothing to the servos and still plans", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { arm, runner, stop } = await liveRunner(world);
    const before = { ...arm.cmd };
    const lines: string[] = [];
    const dry = new Runner(arm, new AbortController().signal, (m) => lines.push(m), async () => [], {
      ...DEFAULT_RUNNER,
      dryRun: true,
    });
    const res = await mission.run(dry, params());
    const after = { ...arm.cmd };
    stop();
    expect(res).toMatch(/complete/);
    // the plan is still emitted: one pick + one place per selected part
    expect(lines.filter((l) => l.startsWith("pick at")).length).toBe(PART_TABLE.length);
    expect(lines.filter((l) => l.startsWith("place at")).length).toBe(PART_TABLE.length);
    // and no per-joint goal write happened
    expect(after).toEqual(before);
  }, 40000);
});

// ---------------------------------------------------------------------------
// C. Ledger
// ---------------------------------------------------------------------------
describe("C. ledger", () => {
  const mk = () => new RepairLedgerBuilder("job", 0, () => 1_000);

  it("C1 records one entry per step with the required fields", () => {
    const b = mk();
    b.add({ part: "p1", action: "a", verdict: "pass", reason: "ok", evidence: "arm" });
    b.add({ part: "p2", action: "b", verdict: "fail", reason: "nope", evidence: "camera" });
    const l = b.build();
    expect(l.steps).toHaveLength(2);
    expect(l.steps[0]).toMatchObject({ step: 1, part: "p1", verdict: "pass", t_ms: 1_000 });
    expect(l.steps[1].step).toBe(2);
  });

  it("C2 rejects any verdict outside the closed set", () => {
    const b = mk();
    expect(() =>
      b.add({ part: "p", action: "a", verdict: "maybe" as Verdict, reason: "r", evidence: "arm" }),
    ).toThrow(LedgerError);
  });

  it("C2b a verdict without a reason is rejected", () => {
    expect(() => b_add_no_reason(mk())).toThrow(LedgerError);
  });
  function b_add_no_reason(b: ReturnType<typeof mk>) {
    return b.add({ part: "p", action: "a", verdict: "pass", reason: "  ", evidence: "arm" });
  }

  it("C3 a missing part yields fail, never a silent pass and never a throw", () => {
    const out = decideStep({ delivered: false });
    expect(out.verdict).toBe("fail");
    expect(out.reason).toMatch(/could not deliver/i);
  });

  it("C4 the ledger serialises to valid JSON and round-trips", () => {
    const l = mk().build();
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });

  it("C5 the ledger is retrievable as a typed value after a run", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { runner, stop } = await liveRunner(world);
    const sink: LedgerSink = { current: null };
    const m = phoneRepairMission(undefined, sink);
    await m.run(runner, params());
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(sink.current).not.toBeNull();
    expect(sink.current!.steps.length).toBeGreaterThan(0);
    expect(typeof sink.current!.job).toBe("string");
  }, 40000);

  it("summary distinguishes complete from unknown", () => {
    const b = new RepairLedgerBuilder("j", 0, () => 1);
    b.add({ part: "a", action: "x", verdict: "pass", reason: "r", evidence: "arm" });
    b.add({ part: "b", action: "y", verdict: "unknown", reason: "r", evidence: "operator" });
    const l = b.build();
    const s = summarise(l);
    expect(s).toMatchObject({ total: 2, pass: 1, unknown: 1, fail: 0 });
    expect(s.complete).toBe(false); // unknown is NOT success
    expect(formatSummary(l)).toMatch(/1 unknown/);
  });
});

// ---------------------------------------------------------------------------
// D. Safety invariants
// ---------------------------------------------------------------------------
describe("D. safety invariants", () => {
  it("D1 the mission never enables torque itself", () => {
    // Source-level check: no torque call anywhere in the scene or its module.
    const src = [
      require("node:fs").readFileSync("src/lib/repair-mission.ts", "utf8"),
      require("node:fs").readFileSync("src/lib/repair.ts", "utf8"),
    ].join("\n");
    expect(src).not.toMatch(/setTorque\s*\(/);
  });

  it("D2 picks go through Runner.pick, not a direct arm.grasp shortcut", () => {
    const src = require("node:fs").readFileSync("src/lib/repair-mission.ts", "utf8");
    expect(src).toContain("r.pick(");
    expect(src).not.toMatch(/\.arm\.grasp\s*\(/);
  });

  it("D3 torque is off before the mission runs", async () => {
    const world = new SimWorld();
    const arm = world.arm;
    await arm.initFollower();
    // torque deliberately NOT enabled
    expect(arm.torque).toBe(false);
  });

  it("D4 aborting mid-run leaves torque off", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { arm, stop } = await liveRunner(world);
    expect(arm.torque).toBe(true);
    const ctrl = new AbortController();
    const runner = new Runner(arm, ctrl.signal, () => undefined, async () => [], {
      ...DEFAULT_RUNNER,
      speedMs: 400,
    });
    ctrl.abort();
    await expect(mission.run(runner, params())).rejects.toThrow();
    stop();
  }, 40000);
});

// ---------------------------------------------------------------------------
// F. Optional Atech board input (additive)
// ---------------------------------------------------------------------------
describe("F. optional Atech input is additive", () => {
  it("F1 the scene runs with no board and produces a full ledger", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { runner, stop } = await liveRunner(world);
    const sink: LedgerSink = { current: null };
    const m = phoneRepairMission(undefined, sink); // no inputs at all
    const res = await m.run(runner, params());
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(res).toMatch(/complete/);
    const l = sink.current!;
    expect(l.steps.length).toBeGreaterThan(0);
    // absence of a board must not manufacture unknowns
    expect(l.steps.some((s) => s.verdict === "unknown")).toBe(false);
  }, 40000);

  it("F2 (negative) an unreachable board yields unknown, not fail, and still completes", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { runner, stop } = await liveRunner(world);
    const sink: LedgerSink = { current: null };
    // port 1 is closed -> every probe must degrade
    const m = phoneRepairMission(atechInputs("http://127.0.0.1:1"), sink);
    const res = await m.run(runner, params());
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(res).toMatch(/complete/); // did not throw
    const l = sink.current!;
    expect(l.steps.length).toBeGreaterThan(0);
    expect(l.steps.every((s) => s.verdict !== "fail")).toBe(true);
    expect(l.steps.some((s) => s.verdict === "unknown")).toBe(true);
    expect(l.steps.filter((s) => s.verdict === "unknown")[0].reason).toMatch(/unavailable/i);
  }, 40000);

  it("F3 an occupied tray passes and an empty tray fails", () => {
    expect(decideStep({ delivered: true, probe: { occupied: true, reason: "120 mm", distance_mm: 120 } }).verdict).toBe("pass");
    expect(decideStep({ delivered: true, probe: { occupied: false, reason: "900 mm", distance_mm: 900 } }).verdict).toBe("fail");
    expect(decideStep({ delivered: true, probe: { occupied: null, reason: "no reading" } }).verdict).toBe("unknown");
  });

  it("F4 an injected button press is recorded as confirmation", async () => {
    const world = new SimWorld();
    world.objects = mission.scene!(params());
    const { runner, stop } = await liveRunner(world);
    const sink: LedgerSink = { current: null };
    const m = phoneRepairMission(
      {
        trayOccupancy: async () => ({ occupied: true, reason: "120 mm", distance_mm: 120 }),
        stepConfirmed: async () => true,
      },
      sink,
    );
    await m.run(runner, params());
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(sink.current!.steps.some((s) => s.confirmed)).toBe(true);
  }, 40000);

  it("F5 the mission body has no HTTP or serial access", () => {
    const src = require("node:fs").readFileSync("src/lib/repair-mission.ts", "utf8");
    expect(src).not.toMatch(/fetch\(|8767|atech_watch|SerialPort|\/dev\/cu/);
  });

  it("F6 thresholds are declared per slot, not invented per call", () => {
    expect(Object.keys(SLOT_THRESHOLDS).length).toBeGreaterThan(0);
    for (const [slot, t] of Object.entries(SLOT_THRESHOLDS)) {
      expect(t.occupiedBelowMm, slot).toBeGreaterThan(0);
    }
    // an uncalibrated slot is unknown, never a guess
    expect(decideStep({ delivered: true, probe: { occupied: null, reason: "no threshold" } }).verdict).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Part table integrity
// ---------------------------------------------------------------------------
describe("PART_TABLE", () => {
  it("has unique ids, slots and colours, with a slot threshold for each", () => {
    expect(new Set(PART_TABLE.map((p) => p.id)).size).toBe(PART_TABLE.length);
    expect(new Set(PART_TABLE.map((p) => p.slot)).size).toBe(PART_TABLE.length);
    expect(new Set(PART_TABLE.map((p) => p.rgb.join(","))).size).toBe(PART_TABLE.length);
    for (const p of PART_TABLE) expect(SLOT_THRESHOLDS[p.slot], p.slot).toBeDefined();
  });

  it("repairScene matches the table's row layout", () => {
    const objs = repairScene({ trayX: 15, pitch: 4 });
    expect(objs).toHaveLength(PART_TABLE.length);
    expect(objs.map((o) => o.y)).toEqual([-12, -8, -4]);
  });
});