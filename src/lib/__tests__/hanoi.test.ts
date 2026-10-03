import { describe, expect, it } from "vitest";
import { DEFAULT_RUNNER, MISSIONS, Runner } from "../missions";
import { SimWorld } from "../sim";

const hanoi = MISSIONS.find((m) => m.id === "hanoi")!;
const params = () => Object.fromEntries(hanoi.params.map((p) => [p.key, p.value]));

describe("Tower of Hanoi ships a scene (reviewer: 'dead on move 1 unless you hand-stack')", () => {
  it("has a virtual-table scene and written physical set-up steps", () => {
    expect(hanoi.needsCamera).toBe(false);
    expect(hanoi.scene).toBeTypeOf("function");
    expect(hanoi.setup?.length).toBeGreaterThan(2);
    const objs = hanoi.scene!(params());
    expect(objs).toHaveLength(3);
    // stacked bottom -> top on peg 1 (y = -spacing), at the mission's own coordinates
    expect(objs.map((o) => o.z)).toEqual([0, 3, 6]);
    for (const o of objs) {
      expect(o.x).toBe(16);
      expect(o.y).toBe(-7);
    }
  });

  it("every mission with fixed props documents its set-up", () => {
    for (const id of ["hanoi", "draw", "signature", "button", "keypad", "phone-tap", "pour", "tictactoe", "lightswitch"]) {
      expect(MISSIONS.find((m) => m.id === id)!.setup?.length, id).toBeGreaterThan(0);
    }
  });

  it("solves the puzzle live on the virtual arm: whole stack moves peg 1 -> peg 3 in order", async () => {
    const world = new SimWorld();
    const arm = world.arm;
    arm.maxDegPerS = 220;
    await arm.initFollower();
    await arm.setTorque(true);
    world.objects = hanoi.scene!(params());
    const tick = setInterval(() => void arm.readState().then((s) => world.update(s)).catch(() => undefined), 30);
    const runner = new Runner(arm, new AbortController().signal, () => undefined, async () => [], { ...DEFAULT_RUNNER, speedMs: 120 });
    const res = await hanoi.run(runner, params());
    await new Promise((r) => setTimeout(r, 500));
    clearInterval(tick);
    world.update(await arm.readState());
    expect(res).toBe("solved in 7 moves");
    const sorted = [...world.objects].sort((a, b) => a.z - b.z);
    expect(sorted.map((o) => o.name)).toEqual(["block 1", "block 2", "block 3"]);
    for (const o of world.objects) {
      expect(Math.abs(o.y - 7)).toBeLessThan(1.2);
      expect(Math.abs(o.x - 16)).toBeLessThan(1.2);
    }
    expect(sorted.map((o) => Math.round(o.z))).toEqual([0, 3, 6]);
  }, 240000);
});
