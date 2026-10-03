import { describe, expect, it } from "vitest";
import { A_BASE, B_BASE } from "../scenarios/dsl";
import { ALL_SCENARIOS } from "../scenarios";
import {
  showcaseScenarios,
  showcaseById,
  showcaseItems,
  SHOWCASE_SCRIPT,
} from "../scenarios/showcase";

const REACH = 24.2;
const MARGIN = 1.1;
const ids = ["phone-repair", "pcb-assembly", "lab-samples", "assistive-handover", "restock-kiosk"];

/** Same envelope the scenario file enforces. */
function reachable(arm: 'a' | 'b', x: number, z: number) {
  const b = arm === 'a' ? A_BASE : B_BASE;
  return Math.hypot(x - b[0], z - b[2]) <= REACH - MARGIN;
}

/** Every arm that could serve a coordinate, for a two-arm scene. */
function reachableBySomeArm(x: number, z: number) {
  return reachable('a', x, z) || reachable('b', x, z);
}

describe("REACH: no scenario may place a prop outside the arm's workspace", () => {
  it("every grabbable prop is within reach of the arm that uses it", () => {
    const problems: string[] = [];
    for (const s of showcaseScenarios()) {
      // a two-arm scene may serve either arm; a one-arm scene must use arm A
      const allowBoth = s.arms === 2;
      for (const p of s.props ?? []) {
        if (!p.grab) continue;
        const ok = allowBoth
          ? reachableBySomeArm(p.pos[0], p.pos[2])
          : reachable('a', p.pos[0], p.pos[2]);
        if (!ok) {
          const dA = Math.hypot(p.pos[0] - A_BASE[0], p.pos[2] - A_BASE[2]).toFixed(1);
          problems.push(`${s.id}/${p.id} at (${p.pos[0]}, ${p.pos[2]}) — ${dA} cm from arm A`);
        }
      }
    }
    expect(problems, `unreachable props (this is the "grabbing thin air" bug):\n${problems.join("\n")}`).toEqual([]);
  });

  it("every place destination is reachable", () => {
    // Destinations come from the phase programs; assert the ones we can see by
    // re-deriving them from the same bench() maths the file uses.
    const cases: [string, number, number][] = [
      // phone-repair: mat at bench(a, 11, -2) => (5, -14)
      ["phone-repair mat", A_BASE[0] + 11, A_BASE[2] - 2],
      // pcb: board at bench(a, 13, 3) => (1, -9); holder at bench(b, 13, 2) => (25, -10)
      ["pcb board", A_BASE[0] + 13, A_BASE[2] + 3],
      ["pcb holder", B_BASE[0] + 13, B_BASE[2] + 2],
      // lab: rack bench(a,18) => (6,-12); analyser bench(a,12,-3) => (0,-15)
      ["lab rack", A_BASE[0] + 18, A_BASE[2]],
      ["lab analyser", A_BASE[0] + 12, A_BASE[2] - 3],
      // assistive: handoff bench(a,20,6) => (8,-6); human bench(b,19,5) => (31,-7)
      ["assistive robot-robot handoff", A_BASE[0] + 20, A_BASE[2] + 6],
      ["assistive human point", B_BASE[0] + 19, B_BASE[2] + 5],
      // kiosk: crates bench(a,19,2) => (7,-10); shelf bench(a,20,-6) => (8,-18)
      ["kiosk crates", A_BASE[0] + 19, A_BASE[2] + 2],
      ["kiosk shelf", A_BASE[0] + 20, A_BASE[2] - 6],
    ];
    const bad = cases.filter(([, x, z]) => !reachableBySomeArm(x, z)).map(([n, x, z]) => `${n} (${x},${z})`);
    expect(bad, `unreachable destinations:\n${bad.join("\n")}`).toEqual([]);
  });

  it("the guard is real: a prop beyond the envelope is rejected", () => {
    // Proves the check can fail. x=26 was the original bug — 38 cm from arm A.
    expect(reachable('a', 26, -6)).toBe(false);
    expect(Math.hypot(26 - A_BASE[0], -6 - A_BASE[2])).toBeGreaterThan(REACH - MARGIN);
    // and a legitimate bench coordinate passes
    expect(reachable('a', A_BASE[0] + 17, A_BASE[2])).toBe(true);
  });
});

describe("five-domain showcase registry", () => {
  it("all five domains exist and are retrievable by id", () => {
    const list = showcaseScenarios();
    expect(list).toHaveLength(5);
    expect(list.map((s) => s.id).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(showcaseById(id), id).toBeDefined();
  });

  it("narrative fields are populated for every domain", () => {
    for (const s of showcaseScenarios()) {
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.tagline.length, s.id).toBeGreaterThan(10);
      expect(s.story.length, s.id).toBeGreaterThan(60);
      expect(s.novelty.length, s.id).toBeGreaterThan(30);
      expect(s.hardware.length, s.id).toBeGreaterThan(0);
      expect(s.approach.length, s.id).toBeGreaterThan(30);
      expect(s.howTo.length, s.id).toBeGreaterThan(2);
      expect(s.code.length, s.id).toBeGreaterThan(40);
    }
  });

  it("every domain scripts motion with narration", () => {
    for (const s of showcaseScenarios()) {
      const phases = s.program.kind === "phases" ? s.program.phases : [];
      expect(phases.length, s.id).toBeGreaterThan(4);
      expect(phases.some((p) => typeof p.say === "string" && p.say.length > 0), s.id).toBe(true);
    }
  });

  it("assistive handover demonstrates BOTH robot-to-robot and robot-to-human", () => {
    const s = showcaseById("assistive-handover")!;
    expect(s.arms).toBe(2);
    const labels = (s.fixtures ?? []).map((f) => f.label ?? "").join(" | ");
    expect(labels, "needs a robot-to-robot handover mark").toMatch(/robot↔robot/i);
    expect(labels, "needs a human handover mark").toMatch(/human handover/i);
    // both arms must actually move in the program
    const phases = s.program.kind === "phases" ? s.program.phases : [];
    expect(phases.some((p) => "a" in p), "arm A never moves").toBe(true);
    expect(phases.some((p) => "b" in p), "arm B never moves").toBe(true);
  });

  it("pcb assembly uses two arms with one holding and one kitting", () => {
    const s = showcaseById("pcb-assembly")!;
    expect(s.arms).toBe(2);
    expect(s.approach).toMatch(/stead|hold/i);
    expect(s.code).toMatch(/board_holder\.hold/);
  });

  it("still claims no person detection", () => {
    for (const s of showcaseScenarios()) {
      const text = `${s.story} ${s.novelty} ${s.code} ${s.howTo.join(" ")}`.toLowerCase();
      expect(text.match(/detect (a )?person|person detection|face detect/), s.id).toBeNull();
    }
    expect(showcaseById("assistive-handover")!.code).toMatch(/NOT do: detect people/i);
  });

  it("the demo script runs the live domain first", () => {
    expect(SHOWCASE_SCRIPT).toHaveLength(5);
    expect(SHOWCASE_SCRIPT.filter((s) => s.live)).toHaveLength(1);
    expect(SHOWCASE_SCRIPT[0].live).toBe(true);
    expect(SHOWCASE_SCRIPT.reduce((n, s) => n + s.duration_s, 0)).toBeLessThanOrEqual(300);
  });
});

describe("control-panel item index", () => {
  it("exposes every grabbable item with a label and a position", () => {
    const items = showcaseItems();
    expect(items.length).toBeGreaterThanOrEqual(10);
    for (const it of items) {
      expect(it.id, "id should be domain-qualified").toContain(":");
      expect(it.label.length, it.id).toBeGreaterThan(0);
      expect(it.domain.length, it.id).toBeGreaterThan(0);
      expect(it.pos).toHaveLength(3);
      // an item offered to a user must actually be pickable
      expect(reachableBySomeArm(it.pos[0], it.pos[2]), `${it.id} offered but unreachable`).toBe(true);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});
describe("real components instead of generic shapes", () => {
  it("phone parts are built from composed primitives, not bare boxes", () => {
    const phone = showcaseById("phone-repair")!;
    for (const p of phone.props ?? []) {
      expect(p.label, `${p.id} should be a named component`).toBeTruthy();
      // every showcase part is a composed Prim with children
      expect(Array.isArray(p.children), `${p.id} has no detail geometry`).toBe(true);
      expect((p.children as unknown[]).length, `${p.id} children`).toBeGreaterThan(2);
    }
  });

  it("component library produces distinct, non-degenerate geometry", async () => {
    const parts = await import("../scenarios/parts3d");
    const items = [parts.phoneBattery(), parts.phoneScreen(), parts.logicBoard(),
                   parts.componentReel(0xd9a441), parts.sampleTube(0xe05252),
                   parts.drinkCup(), parts.magazine(), parts.stockCrate(0xd94f4f)];
    for (const it of items) {
      expect(it.grabWidth, "grabWidth").toBeGreaterThan(0.5);
      expect(it.prim.size.length, "size").toBeGreaterThan(0);
      expect(it.prim.size.every((n) => n > 0), "no zero dimensions").toBe(true);
      expect(it.prim.children?.length ?? 0, `${it.prim.label} detail`).toBeGreaterThan(2);
    }
    // battery, screen and board must not be the same shape
    const sigs = items.slice(0, 3).map((i) => `${i.prim.shape}:${i.prim.size.join("x")}`);
    expect(new Set(sigs).size, "phone parts are indistinguishable").toBe(3);
  });

  it("no showcase prop is a bare untextured box", () => {
    for (const s of showcaseScenarios()) {
      for (const p of s.props ?? []) {
        const children = (p.children as unknown[] | undefined) ?? [];
        expect(children.length, `${s.id}/${p.id} is a plain shape`).toBeGreaterThan(0);
      }
    }
  });
});

describe("individual pick mode", () => {
  it("every showcase item is individually addressable and reachable", () => {
    const items = showcaseItems();
    expect(items.length).toBeGreaterThanOrEqual(10);
    for (const it of items) {
      expect(it.scenario, `${it.id} needs a scenario id`).toBeTruthy();
      expect(reachableBySomeArm(it.pos[0], it.pos[2]), `${it.id} unreachable`).toBe(true);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("individual-pick variants are registered alongside the scripted ones", () => {
    for (const id of ids) {
      expect(showcaseById(id), id).toBeDefined();
      expect(ALL_SCENARIOS.some((x) => x.id === `${id}-individual`), `${id}-individual`).toBe(true);
    }
  });

  it("the demo script exposes both modes", () => {
    expect(SHOWCASE_SCRIPT).toHaveLength(5);
    expect(SHOWCASE_SCRIPT.filter((s) => s.live)).toHaveLength(1);
  });
});
