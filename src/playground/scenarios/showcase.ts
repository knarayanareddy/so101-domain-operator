import type { Scenario, Phase, PropSpec, FixtureSpec } from '../sim/types';
import { P, wait, pickPlace, fbox, fcyl, A_BASE, B_BASE } from './dsl';
import {
  phoneBattery, phoneScreen, logicBoard, componentReel, sampleTube,
  drinkCup, magazine, stockCrate, phoneUnderRepair, at,
} from './parts3d';

/**
 * Five-domain showcase — REACH-SAFE rebuild.
 *
 * WHY THIS FILE WAS REWRITTEN
 * The first version placed every prop at x≈26 while arm A's base is [-12, 0, -12]
 * with a 24.2 cm reach envelope. Every prop sat ~38 cm away, outside the workspace,
 * so the arm visibly grabbed thin air. The props were mostly *inside arm B's*
 * envelope while the programs drove arm 'a'.
 *
 * Two rules now make that class of bug impossible:
 *   1. `inReach(arm, x, z)` is asserted at module load. Any prop outside the
 *      envelope throws immediately, rather than looking fine in a screenshot.
 *   2. Coordinates are derived from the arm's own base via `bench(arm, ...)`,
 *      so moving an arm base cannot silently strand the layout.
 *
 * The methodology claim is unchanged: Script -> Voice -> Perception -> Verification
 * -> Ledger, identical across all five domains.
 *
 * Honesty notes carried in the copy, deliberately:
 *  - Sim Lab does NOT drive hardware. It is a three.js rig with its own IK.
 *  - No person/occupant detection is claimed anywhere.
 *  - The vision path is colour thresholding + planar homography, not a component model.
 */

type V3 = [number, number, number];

/** Reach envelope used by the Sim Lab rig (matches dsl.safeAt). */
const REACH = 24.2;
/** Keep 1.1 cm of margin, same as safeAt. */
const MARGIN = 1.1;

/** True when (x,z) is inside the arm's usable horizontal envelope. */
function inReach(arm: 'a' | 'b', x: number, z: number): boolean {
  const b = arm === 'a' ? A_BASE : B_BASE;
  return Math.hypot(x - b[0], z - b[2]) <= REACH - MARGIN;
}

/**
 * Place a point relative to the arm's own base, so the layout travels with the arm.
 * `fwd` is +x (away from the operator), `side` is +z (left), `out` is lateral spread.
 */
function bench(arm: 'a' | 'b', fwd: number, side = 0): [number, number] {
  const b = arm === 'a' ? A_BASE : B_BASE;
  return [b[0] + fwd, b[2] + side];
}

/**
 * Frame the camera on a set of points instead of hand-tuning a position.
 *
 * Hand-tuned camera numbers were the second bug in this file: the first version
 * framed ~36 units from a scene spanning ~25 cm of table plus two arm rigs, so the
 * arms filled the view and the parts were crammed into the middle. Deriving the
 * distance from the actual bounds means a layout change cannot silently break the
 * shot again.
 */
function frame(points: [number, number][]): { pos: [number, number, number]; target: [number, number, number] } {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  const span = Math.max(spanX, spanZ);
  // Pull back far enough that BOTH arm rigs fit either side of the work area.
  // The arms sit ~12 cm either side of centre and stand ~35 cm tall, so the
  // working distance has to clear that, not just the table.
  const dist = Math.max(span * 1.6, 46) + 46;
  const height = dist * 0.82;
  return {
    pos: [cx - 6, height, cz - dist * 0.68],
    target: [cx, 2, cz],
  };
}

/** Fail loudly at import time rather than shipping a scene that grabs air. */
function assertReachable(arm: 'a' | 'b', pts: [string, number, number][], who: string) {
  for (const [id, x, z] of pts) {
    if (!inReach(arm, x, z)) {
      const b = arm === 'a' ? A_BASE : B_BASE;
      const d = Math.hypot(x - b[0], z - b[2]).toFixed(1);
      throw new Error(
        `${who}: ${id} at (${x}, ${z}) is ${d} cm from arm ${arm}'s base ` +
          `(${b[0]}, ${b[2]}) — outside the ${(REACH - MARGIN).toFixed(1)} cm envelope`,
      );
    }
  }
}

/* ========================================================================
 * 1. MOBILE PHONE REPAIR — the live-hardware anchor domain
 *    One arm: technician's bench on the arm's own side.
 * ===================================================================== */
function phoneRepair(): Scenario {
  const ARM = 'a' as const;
  // Tray column and work mat, both derived from arm A's base.
  const [tx, tz] = bench(ARM, 19);          // parts tray, near the far edge of reach
  const [mx, mz] = bench(ARM, 10, -4);      // work mat, ~10 cm away and toward the operator

  const PARTS = [
    { id: 'part-battery', label: 'battery', color: 0x4a7fe0 },
    { id: 'part-screen', label: 'screen', color: 0x4dab5f },
    { id: 'part-board', label: 'logic board', color: 0xe05252 },
  ];
  const ROWS = [-5, 0, 5];   // spread so three parts are individually addressable
  PARTS.forEach((p, i) => assertReachable(ARM, [[p.id, tx, tz + ROWS[i]]], 'phone-repair'));

  // Real components rather than generic boxes: a battery with a flex ribbon, a
  // screen with a bezel and earpiece slot, a populated logic board.
  const BUILDERS = [phoneBattery, phoneScreen, logicBoard];
  const props: PropSpec[] = PARTS.map((p, i) => {
    const b = BUILDERS[i]();
    return {
      id: p.id,
      ...at(b.prim, tx, 0, tz + ROWS[i]),
      grab: true,
      width: b.grabWidth,
    } as PropSpec;
  });

  const fixtures: FixtureSpec[] = [
    fbox(mx, 0.2, mz, 10, 0.4, 8, 0x2b2f36, { label: 'work mat' }),
    at(phoneUnderRepair(), mx, 0, mz), // the phone being repaired
    fbox(tx, 0.15, tz, 8, 0.3, 14, 0x545a63, { label: 'tray' }),
  ];
  // tray label cards
  PARTS.forEach((p, i) =>
    fixtures.push(fbox(tx - 2.6, 0.9, tz + ROWS[i], 1.4, 1.8, 0.2, 0xf1f3f5, { label: p.label })),
  );

  const phases: Phase[] = [wait(0.6, '📋 Work order open: screen replacement, 3 parts')];
  PARTS.forEach((p, i) => {
    phases.push(
      ...pickPlace(ARM, [tx, tz + ROWS[i]], [mx, mz], {
        speed: 0.85, fh: 1.4, th: 2.0, safe: 7,
        say: i === 0 ? '🗣️ "Next: battery." → arm fetches from the tray' : `step ${i + 1}/3 · ${p.label}`,
      }),
    );
    phases.push(wait(0.35, `   ✓ stall-verified grasp · ledger step ${i + 1} recorded`));
  });
  phases.push(wait(0.8, '📄 Ledger: 3/3 steps verified · 0 fail · 0 unknown'));

  return {
    id: 'phone-repair',
    title: 'Mobile Phone Repair',
    emoji: '🔧',
    category: 'Industry & Testing',
    tagline: 'Parts-tray fetch in checklist order, with a verified ledger',
    story:
      'A technician works a repair order at the bench. Three parts sit in labelled trays on the arm\'s own side of the table. The arm fetches each one in checklist order, verifies the grasp by motor load, and writes one ledger entry per step recording what was done and which input proved it.',
    novelty:
      'The deliverable is not the pick — it is the record. Every verdict names its evidence, and an input that could not be checked yields "unknown", never a false pass.',
    difficulty: 2,
    arms: 1,
    hardware: ['3 colour-coded parts on taped tray marks', 'Optional Atech VL53L5CX distance sensor over a tray', 'Microphone (voice)', 'Overhead camera (colour detection + homography)'],
    approach:
      'Scripted pick & place + closed-loop verification via motor stall, then a ledger whose verdict is pass / fail / unknown with the evidence source recorded.',
    howTo: [
      'Tape tray marks on the table on the arm\'s own side, and a work mat in front of the technician.',
      'Place one distinct-coloured part per tray row, centred on its mark.',
      'Calibrate the camera homography once with 4+ marks on the table plane.',
      'Run: the arm picks each part in order and writes one ledger entry per step.',
    ],
    code: `for step in work_order.steps:
    part = vision.locate(step.part, rgb=step.rgb)        # colour + homography -> world cm
    if part is None:
        ledger.record(step, "fail", reason="part not on table"); continue
    ok = arm.pick(part.world)                             # stall-verified grasp
    if not ok:
        ledger.record(step, "fail", reason="grasp/slip check failed"); continue
    occ = distance.tray_occupancy(step.slot)              # optional sensor
    verdict = "pass" if occ is None else ("pass" if occ else "fail")
    ledger.record(step, verdict, evidence="arm+sensor" if occ is not None else "arm")`,
    theme: 'lab',
    props,
    fixtures,
    // Frame the working volume: tray column and mat both sit in view.
    cam: frame([[tx, tz - 5], [tx, tz + 5], [mx, mz]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 2. ELECTRONICS BENCH / PCB ASSEMBLY
 *    Two arms: A kits from the tray, B holds the board steady.
 * ===================================================================== */
function pcbAssembly(): Scenario {
  const A = 'a' as const;
  const B = 'b' as const;
  const [rx, rz] = bench(A, 17);
  const [px, pz] = bench(A, 13, 3);
  const [hx, hz] = bench(B, 13, 2);

  const REELS = [
    { id: 'reel-r', label: '0402 resistors', color: 0xd9a441, off: -5 },
    { id: 'reel-c', label: '0402 capacitors', color: 0x5f8fd9, off: 0 },
    { id: 'reel-led', label: 'LEDs', color: 0xe06a5f, off: 5 },
  ];
  const FOOT = [-1.6, 0, 1.6];
  REELS.forEach((r, i) => assertReachable(A, [[r.id, rx, rz + r.off]], 'pcb-assembly src'));
  REELS.forEach((_, i) => assertReachable(B, [[`hold${i}`, px + 1.6 + i * 1.6, pz]], 'pcb-assembly dst'));

  const props: PropSpec[] = REELS.map((r) => {
    const reel = componentReel(r.color);
    return {
      id: r.id,
      ...at(reel.prim, rx, 0, rz + r.off),
      // The catalogue surfaces this label, so it must identify the PART, not the
      // container. Three items all called "reel" would be indistinguishable to
      // "pick up the resistor".
      label: r.label,
      grab: true,
      width: reel.grabWidth,
    } as PropSpec;
  });

  const fixtures: FixtureSpec[] = [
    fbox(rx, 0.3, rz, 8, 0.6, 12, 0x545a63, { label: 'kitting tray' }),
    fbox(px, 0.35, pz, 7, 0.5, 5, 0x1d5c3a, { label: 'PCB' }),
    fbox(hx, 1.0, hz, 1.6, 2.0, 1.6, 0x2b3038, { label: 'board holder' }),
  ];
  REELS.forEach((r) => fixtures.push(fbox(rx - 2.6, 0.9, rz + r.off, 1.4, 1.8, 0.2, 0xf1f3f5, { label: r.label })));

  const phases: Phase[] = [wait(0.7, '📐 Assembly order loaded · arm B steadies the board')];
  REELS.forEach((r, i) => {
    phases.push(
      ...pickPlace(A, [rx, rz + r.off], [px + 1.6 + i * 1.6, pz], {
        speed: 0.7, fh: 1.2, th: 1.6, safe: 7,
        say: i === 0 ? '🗣️ "Pass the resistor pack." → same vision, same grasp' : `place ${r.label} at footprint ${i + 1}`,
      }),
    );
    phases.push(wait(0.3, `   ✓ placed · ledger step ${i + 1}/3`));
  });
  phases.push(P(B, 1.2, { p: [hx, 2.6, hz], pitch: -70, grip: 1 }, '   🤝 arm B holds the board until the step is signed off'));
  void FOOT;
  phases.push(wait(0.7, '⚠️ Out-of-order step → flagged BEFORE the board is closed'));

  return {
    id: 'pcb-assembly',
    title: 'PCB Assembly Kitting',
    emoji: '🔌',
    category: 'Industry & Testing',
    tagline: 'Two arms: one kits, one steadies the board',
    story:
      'A bench technician builds a board from a kitting tray. Arm A fetches component reels in assembly order and places them at footprints while arm B holds the board steady — which is the honest version of "two arms", because a steadying hand is a real job. The value is not the pick: it is that a step done out of order, or with the wrong reel, is flagged while the board is still open.',
    novelty:
      'Proves the methodology is domain-independent AND that two arms are useful for a reason other than spectacle. Different object scale, different names — identical detect → verify → record pipeline.',
    difficulty: 2,
    arms: 2,
    hardware: ['3 labelled component reels (or blocks standing in)', 'Overhead camera', 'Optional distance sensor for reel-present check', 'Second arm as board holder'],
    approach:
      'Same colour-threshold detection and stall-verified grasp as the repair bench. Arm B holds rather than picks — a steadying hand is a real production job.',
    howTo: [
      'Lay out the kitting tray with one labelled well per component type.',
      'Place the bare PCB on the mat; arm B holds it while arm A works.',
      'Load the assembly order; each step names a well and a footprint.',
      'Run: arm A fetches each reel in order and records placement.',
    ],
    code: `order = work_instruction.steps        # [(reel_well, footprint), ...]
board_holder.hold(PCB)                    # arm B: steady, do not release
for i, (well, footprint) in enumerate(order):
    if tray_occupancy(well) is False:
        ledger.record(i, "fail", reason=f"well {well} empty — wrong reel fetched")
    part = vision.locate(reel_rgb[well], tol=40)
    kitting_arm.pick(part.world) and kitting_arm.place(footprint)
    ledger.record(i, "pass")`,
    theme: 'lab',
    props,
    fixtures,
    cam: frame([[rx, rz - 5], [rx, rz + 5], [px, pz], [hx, hz]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 3. LABORATORY SAMPLE HANDLING — becomes an audit trail
 * ===================================================================== */
function labSamples(): Scenario {
  const ARM = 'a' as const;
  const [qx, qz] = bench(ARM, 18);
  const [ax, az] = bench(ARM, 12, -3);

  const SAMPLES = [
    { id: 'smp-a1', label: 'A1', color: 0xe05252, off: -4.5 },
    { id: 'smp-a2', label: 'A2', color: 0x5f8fd9, off: 0 },
    { id: 'smp-a3', label: 'A3', color: 0x69b87a, off: 4.5 },
  ];
  SAMPLES.forEach((s) => assertReachable(ARM, [[s.id, qx, qz + s.off]], 'lab-samples src'));
  SAMPLES.forEach((s) => assertReachable(ARM, [[s.id, ax, az + s.off]], 'lab-samples dst'));

  const props: PropSpec[] = SAMPLES.map((s) => {
    const tube = sampleTube(s.color);
    return {
      id: s.id,
      ...at(tube.prim, qx, 0, qz + s.off),
      label: `sample ${s.label}`,   // "sample A1", not three identical "sample"s
      grab: true,
      width: tube.grabWidth,
    } as PropSpec;
  });

  const fixtures: FixtureSpec[] = [
    fbox(qx, 0.3, qz, 10, 0.6, 14, 0x545a63, { label: 'sample rack' }),
    fbox(ax, 1.0, az, 5, 2.0, 6, 0x2b3038, { label: 'analyser' }),
  ];
  for (let i = 0; i < 4; i++) {
    fixtures.push(fbox(qx, 0.65, qz - 4.5 + i * 3, 8, 0.2, 2.4, 0x2f343b, { label: `slot ${i + 1}` }));
  }

  const phases: Phase[] = [wait(0.6, '🧪 Manifest loaded: A1, A2, A3 → analyser')];
  SAMPLES.forEach((s, i) => {
    phases.push(
      ...pickPlace(ARM, [qx, qz + s.off], [ax, az + s.off], {
        speed: 0.7, fh: 1.6, th: 2.6, safe: 7,
        say: i === 0 ? '🗣️ "Rack position one." → position, not appearance, is checked' : `sample ${s.label} → analyser`,
      }),
    );
    phases.push(wait(0.3, `   ✓ slot ${i + 1} vacated · timestamped`));
  });
  phases.push(wait(0.8, '🔒 Chain of custody: every movement recorded with a time'));

  return {
    id: 'lab-samples',
    title: 'Lab Sample Handling',
    emoji: '🧪',
    category: 'Lab & Kitchen',
    tagline: 'Manifest-driven fetching that doubles as a custody record',
    story:
      'A lab technician walks a numbered rack of samples to an analyser. The manifest states the order. What matters is not what a tube looks like but that the arm took the right SLOT — so the record is a chain-of-custody log, timestamped, one entry per movement.',
    novelty:
      'The same pipeline that moved parts now produces traceability. The deliverable is the audit trail, which is what a regulated lab actually buys.',
    difficulty: 1,
    arms: 1,
    hardware: ['Numbered sample rack', 'Analyser station', 'Overhead camera or fixed marks', 'Optional distance sensor per slot'],
    approach:
      'Position-first verification: the manifest is ground truth, the slot occupancy is the check, and the ledger is the custody record.',
    howTo: [
      'Fix the rack at a known position and mark each slot.',
      'Load the manifest: an ordered list of slot IDs.',
      'Optionally put a distance sensor over the rack to confirm a slot was vacated.',
      'Run: each movement is fetched, verified and timestamped.',
    ],
    code: `for slot in manifest.order:
    if distance.slot_occupied(slot):
        continue                                  # already in place
    tube = rack.pick(slot)
    assert tube.slot == slot                     # wrong slot -> abort
    analyser.place(tube)
    custody.append(t_ms=now(), event="moved", slot=slot, sample=tube.id)`,
    theme: 'lab',
    props,
    fixtures,
    cam: frame([[qx, qz - 5], [qx, qz + 5], [ax, az]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 4. ASSISTIVE HANDOVER — TWO ARMS: robot → robot → human
 *    The question was fair. A handover between two robots demonstrates
 *    collaboration; a handover to a person demonstrates assistance.
 *    This one does both, explicitly, in that order.
 * ===================================================================== */
function assistiveHandover(): Scenario {
  const A = 'a' as const;
  const B = 'b' as const;
  // Item starts on a side table near arm A.
  const [ix, iz] = bench(A, 19, -4);
  // Arm A hands to arm B at a shared handover point.
  const [hx, hz] = bench(A, 20, 6);
  // Arm B then delivers to the taped human handover mark.
  const [ux, uz] = bench(B, 19, 5);

  assertReachable(A, [['item', ix, iz]], 'assistive src');
  assertReachable(A, [['handover', hx, hz]], 'assistive handoff');
  assertReachable(B, [['handover', hx, hz]], 'assistive handoff (arm B)');
  assertReachable(B, [['human point', ux, uz]], 'assistive human point');

  const cup = drinkCup();
  const mag = magazine();
  const props: PropSpec[] = [
    { id: 'cup', ...at(cup.prim, ix, 0, iz), grab: true, width: cup.grabWidth } as PropSpec,
    { id: 'book', ...at(mag.prim, ix, 0, iz + 6), grab: true, width: mag.grabWidth } as PropSpec,
  ];
  for (const p of props) assertReachable(A, [[p.id, p.pos[0], p.pos[2]]], 'assistive prop');

  const fixtures: FixtureSpec[] = [
    fbox(ix, 0.4, iz, 8, 0.8, 12, 0x6b5545, { label: 'side table' }),
    fcyl(hx, 0.03, hz, 3.0, 0.06, 0x2fa84f, { label: 'robot↔robot handover' }),
    fcyl(ux, 0.03, uz, 3.0, 0.06, 0x1f7ae0, { label: 'human handover' }),
    fbox(ux - 4.5, 0.5, uz, 5, 1.0, 5, 0x3f4750, { label: 'seat' }),
  ];

  const phases: Phase[] = [wait(0.8, '🔔 Voice request: "Here is your drink." — hands are the bottleneck')];
  // --- arm A -> arm B ---
  phases.push(...pickPlace(A, [ix, iz], [hx, hz], {
    speed: 0.65, fh: 1.6, th: 2.4, safe: 7,
    say: '🤝 arm A picks from the side table and hands to arm B',
  }));
  phases.push(wait(0.5, '   ✓ robot↔robot handover · both arms stall-verified'));
  // --- arm B -> human ---
  phases.push(...pickPlace(B, [hx, hz], [ux, uz], {
    speed: 0.65, fh: 1.6, th: 2.4, safe: 7,
    say: '🗣️ arm B delivers to the taped handover point',
  }));
  phases.push(wait(0.6, '   ✓ handover complete · awaiting confirmation button'));
  phases.push(P(B, 1.0, { p: [hx, 8, hz], pitch: -60, grip: 1 }, '   …arm withdraws to rest'));
  phases.push(wait(0.8, '📄 Ledger: robot↔robot and robot→human, both timestamped'));

  return {
    id: 'assistive-handover',
    title: 'Assistive Handover (robot → robot → human)',
    emoji: '🤲',
    category: 'Care & Assistive',
    tagline: 'Two-stage handover: collaboration, then assistance',
    story:
      'A person at a table asks for a drink by voice. Arm A picks it from a side table and hands it to arm B at a shared point; arm B places it on a taped handover mark within the person\'s reach, then withdraws. Two different claims in one scenario: robots can cooperate, and a robot can serve a person without occupying their space.',
    novelty:
      'The two-arm handover is not decoration — it is the difference between showing coordination and showing assistance. Voice is the interface because the user\'s hands are the bottleneck. The human handover point is a taped mark, NOT a person-detection claim.',
    difficulty: 2,
    arms: 2,
    hardware: ['Side table', 'Two taped handover marks (robot↔robot, robot→human)', 'Microphone', 'Optional button for confirmation'],
    approach:
      'Voice request → arm A fetch → robot↔robot handover → arm B delivery to a taped mark → withdraw. Verification is stall check at each transfer plus an optional operator confirmation.',
    howTo: [
      'Tape two marks: one between the arms for the robot↔robot handover, one in front of the person.',
      'Put the items on a side table within arm A\'s reach.',
      'Connect a microphone; speak the request.',
      'Optionally add a button: the person confirms and the ledger records it.',
    ],
    code: `# What this does NOT do: detect people. Both marks are taped on the table.
request = stt.listen()                        # voice in
item = catalogue.match(request)              # "drink" -> cup
arm_a.pick(item.world) and arm_a.place(ROBOT_HANDOVER_MARK)
assert gripper_load > threshold               # arm B actually has it now
arm_b.pick(ROBOT_HANDOVER_MARK) and arm_b.place(HUMAN_HANDOVER_MARK)
ledger.record(request, "delivered", evidence="arm",
               confirmed=button.pressed())    # optional human confirmation`,
    theme: 'warm',
    props,
    fixtures,
    // Wide shot: item, robot↔robot mark and human mark all in frame.
    cam: frame([[ix, iz], [ix, iz + 6], [hx, hz], [ux, uz]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 5. RETAIL / KIOSK RESTOCKING — the most obviously monetisable closer
 * ===================================================================== */
function restockKiosk(): Scenario {
  const ARM = 'a' as const;
  const [cx, cz] = bench(ARM, 19, 2);
  const [sx, sz] = bench(ARM, 20, -6);

  const SLOTS = [
    { id: 'slot-1', label: 'slot 1', color: 0xd94f4f, off: -4.5 },
    { id: 'slot-2', label: 'slot 2', color: 0x4f8fd9, off: -1.5 },
    { id: 'slot-3', label: 'slot 3', color: 0x5fb96f, off: 1.5 },
    { id: 'slot-4', label: 'slot 4', color: 0xd9b04f, off: 4.5 },
  ];
  SLOTS.forEach((s) => assertReachable(ARM, [[`stock-${s.id}`, cx, cz + s.off]], 'kiosk src'));
  SLOTS.forEach((s) => assertReachable(ARM, [[s.id, sx, sz + s.off]], 'kiosk dst'));

  const props: PropSpec[] = SLOTS.map((s) => {
    const crate = stockCrate(s.color);
    return {
      id: `stock-${s.id}`,
      ...at(crate.prim, cx, 0, cz + s.off),
      label: `crate for ${s.label}`, // distinguishes four identical crates
      grab: true,
      width: crate.grabWidth,
    } as PropSpec;
  });

  const fixtures: FixtureSpec[] = [
    fbox(sx, 1.6, sz, 4, 3.2, 20, 0x4a5058, { label: 'shelf' }),
    fbox(cx, 0.5, cz, 8, 1.0, 18, 0x6b5545, { label: 'stock crates' }),
  ];
  SLOTS.forEach((s) => {
    const slotY = 0.9 + (s.off > 0 ? 1.6 : 0);
    fixtures.push(fbox(sx - 2.1, slotY, sz + s.off, 0.3, 1.2, 8, 0x2f343b, { label: s.label }));
  });

  const phases: Phase[] = [wait(0.7, '📦 Facing plan: 4 slots · distance sensor confirms occupancy')];
  SLOTS.forEach((s, i) => {
    phases.push(
      ...pickPlace(ARM, [cx, cz + s.off], [sx, sz + s.off], {
        speed: 0.8, fh: 1.4, th: (s.off > 0 ? 2.5 : 0.9) + 0.8, safe: 8,
        say: i === 0 ? '🗣️ "Refill slot one." → occupancy is the whole problem' : `slot ${i + 1} restocked`,
      }),
    );
    phases.push(wait(0.3, `   ✓ occupancy before/after recorded`));
  });
  phases.push(wait(0.8, '📄 Restock log with timestamps — the deliverable a retailer wants'));

  return {
    id: 'restock-kiosk',
    title: 'Kiosk Restocking',
    emoji: '📦',
    category: 'Industry & Testing',
    tagline: 'Slot occupancy before and after, logged',
    story:
      'A kiosk or vending face has a facing plan. Empty slots are refilled from crates. The distance sensor is the natural fit: occupancy before and after is the entire problem, and the restock log with timestamps is what the operator actually wants.',
    novelty:
      'The narrowest and most obviously monetisable case in the set. It needs no object recognition at all — just "is this slot full or not".',
    difficulty: 1,
    arms: 1,
    hardware: ['Shelf with 4 slots', '4 stock crates', 'Atech VL53L5CX distance sensor per slot (or one, moved)', 'Voice'],
    approach:
      'Occupancy-only verification. Slot full before → skip. Slot empty after → flag. No identification required, which makes it the cheapest deployment in the catalogue.',
    howTo: [
      'Mark each slot position and fix the shelf.',
      'Place one crate per slot within the arm\'s reach.',
      'Mount a distance sensor per slot, or one sensor and a per-slot threshold table.',
      'Run: empty slots are refilled and each before/after reading is logged.',
    ],
    code: `for slot in facing_plan:
    before = distance.read(slot)                 # mm
    if before < OCCUPIED_BELOW_MM:
        continue                                  # already full
    arm.pick(crate[slot]) and arm.place(slot)
    after = distance.read(slot)
    restock_log.append(slot, before, after, t_ms=now())
    if after > OCCUPIED_BELOW_MM:
        restock_log.flag(slot, "still reads empty")   # restock did not take`,
    theme: 'stage',
    props,
    fixtures,
    cam: frame([[cx, cz - 5], [cx, cz + 5], [sx, sz - 5], [sx, sz + 5]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ------------------------------------------------------------------ */
export function showcaseScenarios(): Scenario[] {
  return [phoneRepair(), pcbAssembly(), labSamples(), assistiveHandover(), restockKiosk()];
}

/** Ordered demo script: the live hardware segment runs first, then breadth. */
export const SHOWCASE_SCRIPT: {
  domain: string;
  live: boolean;
  duration_s: number;
  says: string;
}[] = [
  { domain: 'Mobile Phone Repair', live: true, duration_s: 90, says: 'This one is running on the real arm in front of you.' },
  { domain: 'PCB Assembly Kitting', live: false, duration_s: 40, says: 'Same pipeline — and two arms, because a steadying hand is a real job.' },
  { domain: 'Lab Sample Handling', live: false, duration_s: 40, says: 'Same pipeline — and now it produces a custody record.' },
  { domain: 'Assistive Handover', live: false, duration_s: 40, says: 'Same pipeline — robot hands to robot, then robot hands to you.' },
  { domain: 'Kiosk Restocking', live: false, duration_s: 40, says: 'Same pipeline — occupancy only. Cheapest thing we deploy.' },
];

/** Convenience: a single scenario by id, for the control panel. */
export function showcaseById(id: string): Scenario | undefined {
  return showcaseScenarios().find((s) => s.id === id);
}

/** Every grabbable item across the showcase, for the control panel's picker. */
export function showcaseItems(): {
  id: string;
  label: string;
  domain: string;
  scenario: string;
  arm: 'a' | 'b';
  pos: [number, number, number];
}[] {
  const out: {
    id: string;
    label: string;
    domain: string;
    scenario: string;
    arm: 'a' | 'b';
    pos: [number, number, number];
  }[] = [];
  for (const s of showcaseScenarios()) {
    for (const p of s.props ?? []) {
      if (!p.grab) continue;
      out.push({
        id: `${s.id}:${p.id}`,
        label: p.label ?? p.id,
        domain: s.title,
        scenario: s.id,
        // the arm that serves this scenario; two-arm scenes start on A
        arm: 'a',
        pos: [p.pos[0], p.pos[1], p.pos[2]],
      });
    }
  }
  return out;
}
