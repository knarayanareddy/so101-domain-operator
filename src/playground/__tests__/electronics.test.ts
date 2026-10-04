import { describe, expect, it } from "vitest";
import { ALL_SCENARIOS } from "../scenarios";
import { electronicsScenarios } from "../scenarios/electronics";
import { A_BASE, B_BASE } from "../scenarios/dsl";
import type { Phase } from "../sim/types";

const ids = ["screwdriver-bench", "multimeter-bench"];

describe("electronics service bench", () => {
  it("both missions are registered", () => {
    for (const id of ids) {
      expect(ALL_SCENARIOS.some((s) => s.id === id), `${id} not registered`).toBe(true);
    }
    expect(electronicsScenarios()).toHaveLength(2);
  });

  it("both are two-arm, because the split of labour IS the claim", () => {
    for (const id of ids) {
      const s = ALL_SCENARIOS.find((x) => x.id === id)!;
      expect(s.arms, id).toBe(2);
    }
  });

  it("both run arms in PARALLEL, not in turns", () => {
    for (const id of ids) {
      const s = ALL_SCENARIOS.find((x) => x.id === id)!;
      const ph = (s.program as { phases: Phase[] }).phases;
      const both = ph.filter((p) => p.a && p.b);
      expect(both.length, `${id}: no simultaneous phase`).toBeGreaterThan(0);
      // and the two sides do different work
      const distinct = both.some(
        (p) => p.a?.p && p.b?.p && Math.hypot(p.a.p[0] - p.b.p[0], p.a.p[2] - p.b.p[2]) > 3,
      );
      expect(distinct, `${id}: both sides point at the same place`).toBe(true);
    }
  });

  it("every screw and test point is inside an arm's envelope", () => {
    for (const id of ids) {
      const s = ALL_SCENARIOS.find((x) => x.id === id)!;
      for (const p of s.props ?? []) {
        if (!p.grab) continue;
        const dA = Math.hypot(p.pos[0] - A_BASE[0], p.pos[2] - A_BASE[2]);
        const dB = Math.hypot(p.pos[0] - B_BASE[0], p.pos[2] - B_BASE[2]);
        expect(Math.min(dA, dB) <= 23.1, `${id}/${p.id} unreachable (A ${dA.toFixed(1)} / B ${dB.toFixed(1)})`).toBe(true);
      }
    }
  });

  it("the screwdriver walks a DESCENDING helix, not a spin in place", () => {
    const s = ALL_SCENARIOS.find((x) => x.id === "screwdriver-bench")!;
    const ph = (s.program as { phases: Phase[] }).phases;
    // alternating roll with a falling height
    const rolls = ph.filter((p) => p.b?.roll !== undefined && Math.abs(p.b.roll) > 10);
    expect(rolls.length, "no helix rotation found").toBeGreaterThan(4);
    const heights = rolls.map((p) => p.b!.p![1]);
    const falling = heights.some((h, i) => i > 0 && h < heights[i - 1]);
    expect(falling, "the screw does not descend as it is withdrawn").toBe(true);
  });

  it("the multimeter readings are SCRIPTED and labelled as such", () => {
    const s = ALL_SCENARIOS.find((x) => x.id === "multimeter-bench")!;
    const ph = (s.program as { phases: Phase[] }).phases;
    const readings = ph.filter((p) => p.say && /scripted reading/i.test(p.say));
    expect(readings.length, "readings are not marked as scripted").toBe(4);
    // every reading carries a unit
    expect(readings.every((p) => /\d+(\.\d+)?\s?(V|mA|A)\b/.test(p.say!))).toBe(true);
    // and the code sample refuses to invent a value
    expect(s.code).toMatch(/or "unknown"/);
  });

  it("both state their limits rather than overclaiming", () => {
    for (const id of ids) {
      const s = ALL_SCENARIOS.find((x) => x.id === id)!;
      expect(s.code, `${id} code must carry a limitation note`).toMatch(/HONEST LIMIT/);
    }
    const sd = ALL_SCENARIOS.find((x) => x.id === "screwdriver-bench")!;
    expect(sd.code).toMatch(/load/i); // the real-hardware step the sim cannot fake
  });

  it("the screwdriver has 4 screws to remove", () => {
    const s = ALL_SCENARIOS.find((x) => x.id === "screwdriver-bench")!;
    expect((s.props ?? []).filter((p) => p.grab).length).toBe(4);
  });
});

describe("registry integrity", () => {
  it("no duplicate ids after adding the electronics pair", () => {
    const ids2 = ALL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids2).size).toBe(ids2.length);
  });
  it("the electronics pair sits 4th and 5th, after the three anchor scenarios", () => {
    const ids2 = ALL_SCENARIOS.slice(0, 5).map((x) => x.id);
    expect(ids2.indexOf("screwdriver-bench")).toBe(3);
    expect(ids2.indexOf("multimeter-bench")).toBe(4);
  });
});