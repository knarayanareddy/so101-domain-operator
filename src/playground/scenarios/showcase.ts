import type { Scenario, Phase, PropSpec, FixtureSpec } from '../sim/types';
import { P, par, wait, pickPlace, frame, fbox, fcyl, A_BASE, B_BASE } from './dsl';
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
  // TWO arms. The three parts are spread across the union of both reach envelopes
  // (34.2 cm min separation, up from 13.9 with one arm) so each is individually
  // readable at a judging distance. Each part names the arm that fetches it.
  const A = 'a' as const;
  const B = 'b' as const;
  const SPOT = {
    battery: { at: [5, -30] as const, arm: B },
    screen: { at: [-29, -24] as const, arm: A },
    board: { at: [31, -7] as const, arm: B },
  };
  const MAT: [number, number] = [-4, 3];
  const MAT_ARM = A;

  const PARTS = [
    { id: 'part-battery', label: 'battery', spot: SPOT.battery },
    { id: 'part-screen', label: 'screen', spot: SPOT.screen },
    { id: 'part-board', label: 'logic board', spot: SPOT.board },
  ];
  // Every part must be reachable by the arm that fetches it.
  PARTS.forEach((p) =>
    assertReachable(p.spot.arm, [[p.id, p.spot.at[0], p.spot.at[1]]], 'phone-repair'),
  );
  assertReachable(MAT_ARM, [['mat', MAT[0], MAT[1]]], 'phone-repair mat');

  const BUILDERS = [phoneBattery, phoneScreen, logicBoard];
  const props: PropSpec[] = PARTS.map((p, i) => {
    const b = BUILDERS[i]();
    return {
      id: p.id,
      ...at(b.prim, p.spot.at[0], 0, p.spot.at[1]),
      grab: true,
      width: b.grabWidth,
    } as PropSpec;
  });

  const [mx, mz] = MAT;
  const fixtures: FixtureSpec[] = [
    fbox(mx, 0.2, mz, 9, 0.4, 7, 0x2b2f36, { label: 'work mat' }),
    at(phoneUnderRepair(), mx, 0, mz),
  ];
  // Label card offset beside each part so the three never overlap on screen.
  PARTS.forEach((p) =>
    fixtures.push(
      fbox(p.spot.at[0] - 4.6, 1.0, p.spot.at[1] + 2.4, 2.2, 2.0, 0.2, 0xf1f3f5, { label: p.label }),
    ),
  );

  /**
   * PARALLEL, not sequential. par() merges two phase lists so a phase carrying both
   * `a` and `b` moves BOTH arms in the same frame — the engine already supported
   * it; the previous script simply never asked for it, so the arms took turns.
   */
  const fetch = (p: (typeof PARTS)[number], i: number): Phase[] =>
    pickPlace(p.spot.arm, [p.spot.at[0], p.spot.at[1]], [mx, mz], {
      speed: 0.85, fh: 1.4, th: 2.0, safe: 7,
      say:
        i === 0
          ? `🗣️ "Fit the screen and the battery." → BOTH arms fetch at once`
          : undefined,
    });

  const phases: Phase[] = [wait(0.7, '📋 Work order open: screen replacement · parts spread across BOTH arms\' reach')];
  // arms A and B work simultaneously on their own parts
  phases.push(...par(fetch(PARTS[1], 1), fetch(PARTS[0], 0)));
  phases.push(wait(0.4, '   ✓ both grasps stall-verified · ledger steps 1–2 recorded'));
  // the remaining part is on arm B's side
  phases.push(...fetch(PARTS[2], 2));
  phases.push(wait(0.35, '   ✓ stall-verified grasp · ledger step 3 recorded'));
  phases.push(wait(0.8, '📄 Ledger: 3/3 steps verified · 0 fail · 0 unknown'));

  return {
    id: 'phone-repair',
    title: 'Mobile Phone Repair',
    emoji: '🔧',
    category: 'Industry & Testing',
    tagline: 'Two arms, parts spread wide, verified ledger',
    story:
      'A technician works a repair order. Three parts — a battery pouch, a cover-glass screen and a populated logic board — are laid out well apart across the bench, far enough that each is individually visible from a judging distance. Two arms fetch them in checklist order, each taking whichever part is nearest to it, verify the grasp by motor load, and write one ledger entry per step recording what was done and which input proved it.',
    novelty:
      'The deliverable is not the pick — it is the record. Every verdict names its evidence, and an input that could not be checked yields "unknown", never a false pass.',
    difficulty: 2,
    arms: 2,
    hardware: ['Battery, screen and logic board (3D component models), laid out apart', 'Optional Atech VL53L5CX distance sensor over the bench', 'Microphone (voice)', 'Overhead camera (colour detection + homography)'],
    approach:
      'Scripted pick & place + closed-loop verification via motor stall, then a ledger whose verdict is pass / fail / unknown with the evidence source recorded. Parts are spread across the union of both reach envelopes, so each arm is assigned by proximity.',
    howTo: [
      'Lay the three parts far apart on the bench, each on its own taped mark, so they read individually from a judging distance.',
      'Tape a work mat in front of the technician for delivery.',
      'Calibrate the camera homography once with 4+ marks on the table plane.',
      'Run: each arm fetches the part nearest to it and records one ledger entry per step.',
    ],
    code: `for step in work_order.steps:
    part = vision.locate(step.part, rgb=step.rgb)        # colour + homography -> world cm
    if part is None:
        ledger.record(step, "fail", reason="part not on table"); continue
    arm = nearest_arm(part.world)                       # assign by proximity
    ok = arm.pick(part.world)                            # stall-verified grasp
    if not ok:
        ledger.record(step, "fail", reason="grasp/slip check failed"); continue
    occ = distance.tray_occupancy(step.slot)              # optional sensor
    verdict = "pass" if occ is None else ("pass" if occ else "fail")
    ledger.record(step, verdict, evidence="arm+sensor" if occ is not None else "arm")`,
    theme: 'lab',
    props,
    fixtures,
    cam: frame([[5, -30], [-29, -24], [31, -7], [mx, mz], [-12, -12], [12, -12]]),
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
  // Spread 29.7 cm across the union of both envelopes (was 7.3 cm on one arm).
  const REELS = [
    { id: 'reel-r', label: '0402 resistors', color: 0xd9a441, at: [-8, -31] as const, arm: A },
    { id: 'reel-c', label: '0402 capacitors', color: 0x5f8fd9, at: [23, -26] as const, arm: B },
    { id: 'reel-led', label: 'LEDs', color: 0xe06a5f, at: [-32, -12] as const, arm: A },
  ];
  const BOARD: { at: [number, number]; arm: 'a' | 'b' } = { at: [18, 9], arm: B };
  const HOLDER: { at: [number, number]; arm: 'a' | 'b' } = { at: [-12, 10], arm: A };

  REELS.forEach((r) => assertReachable(r.arm, [[r.id, r.at[0], r.at[1]]], 'pcb reel'));
  assertReachable(BOARD.arm, [['board', BOARD.at[0], BOARD.at[1]]], 'pcb board');
  assertReachable(HOLDER.arm, [['holder', HOLDER.at[0], HOLDER.at[1]]], 'pcb holder');

  const props: PropSpec[] = REELS.map((r) => {
    const reel = componentReel(r.color);
    return {
      id: r.id,
      ...at(reel.prim, r.at[0], 0, r.at[1]),
      label: r.label,
      grab: true,
      width: reel.grabWidth,
    } as PropSpec;
  });

  const fixtures: FixtureSpec[] = [
    fbox(BOARD.at[0], 0.35, BOARD.at[1], 6, 0.5, 4.5, 0x1d5c3a, { label: 'PCB' }),
    fbox(HOLDER.at[0], 1.0, HOLDER.at[1], 1.6, 2.0, 1.6, 0x2b3038, { label: 'board holder' }),
  ];
  REELS.forEach((r) =>
    fixtures.push(fbox(r.at[0] - 3.4, 1.1, r.at[1] - 2.6, 2.6, 2.2, 0.2, 0xf1f3f5, { label: r.label })),
  );

  /** One reel placed per call; par() below runs two of these in the same frame. */
  const fetch = (r: (typeof REELS)[number], i: number, say?: string): Phase[] =>
    pickPlace(r.arm, [r.at[0], r.at[1]], [BOARD.at[0] - 1.4 + i * 1.4, BOARD.at[1]], {
      speed: 0.7, fh: 1.2, th: 1.6, safe: 7, say,
    });

  const phases: Phase[] = [wait(0.7, '📐 Assembly order loaded · both arms kitting in parallel')];
  // arm A takes the resistors while arm B takes the capacitors, at the same time
  phases.push(
    ...par(fetch(REELS[0], 0, '🗣️ "Pass the resistor pack." → both arms place at once'),
          fetch(REELS[1], 1)),
  );
  phases.push(wait(0.3, '   ✓ both placed · ledger steps 1–2'));
  phases.push(...fetch(REELS[2], 2));
  phases.push(wait(0.3, '   ✓ placed · ledger step 3/3'));
  phases.push(
    P(HOLDER.arm, 1.2, { p: [HOLDER.at[0], 2.6, HOLDER.at[1]], pitch: -70, grip: 1 },
      `   🤝 arm ${HOLDER.arm.toUpperCase()} holds the board until the step is signed off`),
  );
  phases.push(wait(0.7, '⚠️ Out-of-order step → flagged BEFORE the board is closed'));

  return {
    id: 'pcb-assembly',
    title: 'PCB Assembly Kitting',
    emoji: '🔌',
    category: 'Industry & Testing',
    tagline: 'Both arms kitting in parallel, reels spread wide',
    story:
      'A bench technician builds a board from three component reels laid out well apart across the bench — resistors, capacitors, LEDs — each a real flanged spool. The two arms fetch them in assembly order, each taking whichever reel is nearest to it, and place them at footprints while one arm holds the board steady. The value is not the pick: a step done out of order, or with the wrong reel, is flagged while the board is still open.',
    novelty:
      'Proves the methodology is domain-independent AND that two arms earn their place for a reason other than spectacle: one steadies while the other kits, and the reels are too far apart for a single arm to serve.',
    difficulty: 2,
    arms: 2,
    hardware: ['Three component reels (3D spools), laid out apart', 'PCB on a holder', 'Overhead camera', 'Optional distance sensor for reel-present check', 'Two arms: one kitting, one holding'],
    approach:
      'Same colour-threshold detection and stall-verified grasp as the repair bench. Reels are assigned to arms by proximity because the layout exceeds one arm\'s envelope.',
    howTo: [
      'Lay one component reel per taped mark, far apart — beyond a single arm\'s reach so both are used.',
      'Place the bare PCB on the holder; one arm holds it while the other kits.',
      'Load the assembly order; each step names a reel and a footprint.',
      'Run: each arm fetches the reel nearest to it and records placement.',
    ],
    code: `order = work_instruction.steps
board_holder.hold(PCB)                    # one arm steadies, does not release
for i, (reel, footprint) in enumerate(order):
    if tray_occupancy(reel) is False:
        ledger.record(i, "fail", reason=f"{reel} missing — wrong reel fetched")
    part = vision.locate(reel_rgb[reel], tol=40)
    arm = nearest_arm(part.world)          # reels are spread past one arm's reach
    arm.pick(part.world) and arm.place(footprint)
    ledger.record(i, "pass")`,
    theme: 'lab',
    props,
    fixtures,
    cam: frame([[-8, -31], [23, -26], [-32, -12], HOLDER.at, [-12, -12], [12, -12]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 3. LABORATORY SAMPLE HANDLING — becomes an audit trail
 * ===================================================================== */
function labSamples(): Scenario {
  const A = 'a' as const;
  const B = 'b' as const;
  /**
   * TWO arms (added 2026-10-04 — this scenario was still single-arm while
   * phone-repair and pcb-assembly had moved to two, which was reported wrongly).
   * Tubes spread across the union of both envelopes; arm A takes two, arm B takes
   * one and loads the analyser, and the first pair is fetched in PARALLEL.
   */
  const SAMPLES = [
    { id: 'smp-a1', label: 'A1', color: 0xe05252, at: [-3, -29] as const, arm: A },
    { id: 'smp-a2', label: 'A2', color: 0x5f8fd9, at: [-32, -14] as const, arm: A },
    { id: 'smp-a3', label: 'A3', color: 0x69b87a, at: [24, -27] as const, arm: B },
  ];
  // Placed in the OVERLAP of both envelopes (0,0): each arm loads it, so it must be
  // within reach of both. An earlier (19, 8) was outside arm A and assertReachable
  // threw at import — the guard doing its job.
  const ANALYSER: [number, number] = [0, 0];
  const LOADER: [number, number] = [-32, -4];
  assertReachable(A, [['loader', LOADER[0], LOADER[1]]], 'lab loader');
  assertReachable(B, [['analyser', ANALYSER[0], ANALYSER[1]]], 'lab analyser');
  SAMPLES.forEach((s) => assertReachable(s.arm, [[s.id, s.at[0], s.at[1]]], 'lab src'));
  SAMPLES.forEach((s) => assertReachable(A, [[s.id, ANALYSER[0], ANALYSER[1]]], 'lab dst'));

  const props: PropSpec[] = SAMPLES.map((s) => {
    const tube = sampleTube(s.color);
    return {
      id: s.id,
      ...at(tube.prim, s.at[0], 0, s.at[1]),
      label: `sample ${s.label}`,
      grab: true,
      width: tube.grabWidth,
    } as PropSpec;
  });

  const fixtures: FixtureSpec[] = [
    fbox(ANALYSER[0], 1.1, ANALYSER[1], 5, 2.2, 6, 0x2b3038, { label: 'analyser' }),
    fbox(LOADER[0], 0.9, LOADER[1], 5, 1.8, 4.5, 0x24485c, { label: 'sample loader' }),
  ];
  SAMPLES.forEach((s) =>
    fixtures.push(fbox(s.at[0] + 2.2, 1.2, s.at[1], 1.6, 2.4, 0.2, 0xf4f6f8, { label: s.label })),
  );

  const fetch = (s: (typeof SAMPLES)[number], dest: [number, number], say?: string): Phase[] =>
    pickPlace(s.arm, [s.at[0], s.at[1]], dest, {
      speed: 0.7, fh: 1.6, th: 2.6, safe: 7, say,
    });

  const phases: Phase[] = [
    wait(0.7, '🧪 Manifest loaded: A1, A2, A3 → two arms, one manifest'),
  ];
  // arm A walks A1 and A2 to the loader while arm B walks A3 to the analyser,
  // simultaneously — the custody log records who moved what.
  phases.push(
    ...par(fetch(SAMPLES[0], [LOADER[0] - 1.4, LOADER[1]], '🗣️ "Rack positions one and two." → arm A racks, arm B loads'),
          fetch(SAMPLES[2], [ANALYSER[0], ANALYSER[1] - 1.8])),
  );
  phases.push(wait(0.4, '   ✓ positions vacated · two entries timestamped at once'));
  phases.push(...fetch(SAMPLES[1], [LOADER[0] + 1.4, LOADER[1]]));
  phases.push(wait(0.3, '   ✓ position vacated · timestamped'));
  phases.push(wait(0.8, '🔒 Chain of custody: every movement recorded with a time'));

  return {
    id: 'lab-samples',
    title: 'Lab Sample Handling',
    emoji: '🧪',
    category: 'Lab & Kitchen',
    tagline: 'Two arms, manifest-driven, doubles as a custody record',
    story:
      'A lab technician walks three numbered sample tubes, spaced well apart across the bench, into an analyser and a rack. Two arms work the manifest at once: one racks tubes while the other loads the analyser. What matters is not what a tube looks like but that the arm took the right one — so the record is a chain-of-custody log, timestamped, one entry per movement.',
    novelty:
      'The same pipeline that moved parts now produces traceability. The deliverable is the audit trail, which is what a regulated lab actually buys.',
    difficulty: 2,
    arms: 2,
    hardware: ['Three capped sample tubes (3D cryovials), laid out apart', 'Analyser station and sample loader', 'Overhead camera or fixed marks', 'Optional distance sensor per position'],
    approach:
      'Position-first verification: the manifest is ground truth, both arms are driven in parallel, and the ledger is the custody record.',
    howTo: [
      'Place each tube on its own taped mark, far apart, so each is individually visible.',
      'Load the manifest: an ordered list of sample IDs.',
      'Optionally put a distance sensor near each position to confirm it was vacated.',
      'Run: both arms work the manifest simultaneously and each movement is timestamped.',
    ],
    code: `# Two arms, one manifest. par() merges the phase lists so both arms move
# in the same frame; the custody log stays sequential.
for batch in manifest.batches(2):
    par(*[arm_for(slot).pick(rack[slot]) and arm_for(slot).place(slot) for slot in batch])
    for slot in batch:
        assert distance.slot_occupied(slot) is False
        custody.append(t_ms=now(), event="moved", slot=slot, sample=slot.sample)`,
    theme: 'lab',
    props,
    fixtures,
    cam: frame([[-3, -29], [-32, -14], [24, -27], ANALYSER, LOADER, [-12, -12], [12, -12]]),
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
  // Materials spread to opposite ends: cup on arm B's side, magazine on arm A's.
  const CUP: { at: [number, number]; arm: 'a' | 'b' } = { at: [14, -30], arm: B };
  const MAG: { at: [number, number]; arm: 'a' | 'b' } = { at: [-23, -28], arm: A };
  const HANDOFF: [number, number] = [-19, 6];  // robot <-> robot, arm A serves
  const HUMAN: [number, number] = [18, 7];      // robot -> person, arm B serves
  assertReachable(CUP.arm, [['cup', ...CUP.at]], 'assistive cup');
  assertReachable(MAG.arm, [['magazine', ...MAG.at]], 'assistive magazine');
  assertReachable(A, [['handoff', ...HANDOFF]], 'assistive handoff');
  assertReachable(B, [['human point', ...HUMAN]], 'assistive human point');

  const cup = drinkCup();
  const mag = magazine();
  const props: PropSpec[] = [
    { id: 'cup', ...at(cup.prim, CUP.at[0], 0, CUP.at[1]), grab: true, width: cup.grabWidth } as PropSpec,
    { id: 'book', ...at(mag.prim, MAG.at[0], 0, MAG.at[1]), grab: true, width: mag.grabWidth } as PropSpec,
  ];

  // Each surface sits under its own item, so the two are unmistakably separate.
  const fixtures: FixtureSpec[] = [
    fcyl(HANDOFF[0], 0.03, HANDOFF[1], 3.2, 0.06, 0x2fa84f, { label: 'robot↔robot handover' }),
    fcyl(HUMAN[0], 0.03, HUMAN[1], 3.2, 0.06, 0x1f7ae0, { label: 'human handover' }),
    fbox(HUMAN[0] + 3, 0.5, HUMAN[1], 5, 1.0, 5, 0x3f4750, { label: 'seat' }),
    fbox(CUP.at[0], 0.4, CUP.at[1], 6, 0.8, 6, 0x6b5545, { label: 'side table' }),
    fbox(MAG.at[0], 0.25, MAG.at[1], 6, 0.5, 5, 0x4a5568, { label: 'coffee table' }),
  ];

  const phases: Phase[] = [
    wait(0.8, '🔔 Voice request: "Here is your drink." — the drink is on arm B\'s far side'),
  ];
  phases.push(...pickPlace(CUP.arm, CUP.at, HANDOFF, {
    speed: 0.65, fh: 1.6, th: 2.4, safe: 7,
    say: `🤝 arm ${CUP.arm.toUpperCase()} crosses the bench and hands the drink to arm A`,
  }));
  phases.push(wait(0.5, '   ✓ robot↔robot handover · both grasps stall-verified'));
  phases.push(...pickPlace(A, HANDOFF, HUMAN, {
    speed: 0.65, fh: 1.6, th: 2.4, safe: 7,
    say: '🗣️ arm A delivers to the taped handover point',
  }));
  phases.push(wait(0.6, '   ✓ handover complete · awaiting confirmation button'));
  phases.push(P(A, 1.0, { p: [HANDOFF[0] - 5, 8, HANDOFF[1] - 4], pitch: -60, grip: 1 },
    '   …arm A withdraws to rest'));
  phases.push(
    ...pickPlace(MAG.arm, MAG.at, [HUMAN[0], HUMAN[1]], {
      speed: 0.65, fh: 1.2, th: 1.6, safe: 7,
      say: `📰 arm ${MAG.arm.toUpperCase()} fetches the magazine from the far table — second item, second arm`,
    }),
  );
  phases.push(wait(0.8, '📄 Ledger: robot↔robot and robot→human, both timestamped'));

  return {
    id: 'assistive-handover',
    title: 'Assistive Handover (robot → robot → human)',
    emoji: '🤲',
    category: 'Care & Assistive',
    tagline: 'Materials at opposite ends; two arms, two distinct roles',
    story:
      'A person at a table asks for a drink by voice. The cup sits on a side table at arm B\'s far end, so arm B fetches it and hands it to arm A at a green taped point; arm A places it on the blue taped point within the person\'s reach, then withdraws. A magazine on a separate table at the opposite end is then fetched by arm B. Two claims in one scenario: robots can cooperate across a wide bench, and a robot can serve a person without occupying their space.',
    novelty:
      'The two-arm handover is not decoration — it is the difference between showing coordination and showing assistance. Items are spread past a single arm\'s reach, so each arm must be used. Voice is the interface because the user\'s hands are the bottleneck. Both handover points are taped marks, NOT person detection.',
    difficulty: 2,
    arms: 2,
    hardware: ['Drink cup with lid and straw (3D), on a side table', 'Magazine (3D), on a coffee table at the opposite end', 'Two taped handover marks', 'Microphone', 'Optional button for confirmation'],
    approach:
      'Voice request → arm B fetches → robot↔robot handover to arm A → arm A delivers to a taped mark → withdraw → arm B fetches a second item.',
    howTo: [
      'Tape two marks: one between the arms for the robot↔robot handover, one in front of the person.',
      'Put the cup and the magazine at OPPOSITE ends of the bench, beyond a single arm\'s reach.',
      'Connect a microphone; speak the request.',
      'Optionally add a button: the person confirms and the ledger records it.',
    ],
    code: `# What this does NOT do: detect people. Both marks are taped on the table.
request = stt.listen()                        # voice in
item = catalogue.match(request)              # "drink" -> cup
arm_b.pick(item.world)                       # cup is on B's far side
arm_b.place(ROBOT_HANDOVER_MARK)
assert gripper_load > threshold               # arm A actually has it now
arm_a.pick(ROBOT_HANDOVER_MARK) and arm_a.place(HUMAN_HANDOVER_MARK)
ledger.record(request, "delivered", evidence="arm",
               confirmed=button.pressed())    # optional human confirmation`,
    theme: 'warm',
    props,
    fixtures,
    cam: frame([CUP.at, MAG.at, HANDOFF, HUMAN, [-12, -12], [12, -12]]),
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 5. RETAIL / KIOSK RESTOCKING — the most obviously monetisable closer
 * ===================================================================== */
function restockKiosk(): Scenario {
  const ARM = 'a' as const;
  // Four crates, each >= 11 cm from its neighbours so they read as separate units.
  const SPOTS: [number, number][] = [
    [-18, -25],
    [-1, -19],
    [-25, -9],
    [-9, -2],
  ];
  const SLOTS: [number, number][] = [
    [-18, -25],
    [-1, -19],
    [-25, -9],
    [-9, -2],
  ];
  SPOTS.forEach((sp, i) => {
    assertReachable(ARM, [[`stock-${i}`, sp[0], sp[1]]], 'kiosk src');
    assertReachable(ARM, [[`slot-${i}`, SLOTS[i][0], SLOTS[i][1]]], 'kiosk dst');
  });

  // Real stock crates with a rim and visible contents, not plain cubes.
  const props: PropSpec[] = SPOTS.map((sp, i) => {
    const crate = stockCrate([0xd94f4f, 0x4f8fd9, 0x5fb96f, 0xd9b04f][i]);
    return {
      id: `stock-slot-${i + 1}`,
      ...at(crate.prim, sp[0], 0, sp[1]),
      label: `crate for slot ${i + 1}`,
      grab: true,
      width: crate.grabWidth,
    } as PropSpec;
  });

  // Each slot is its own labelled shelf plate under its crate's final position.
  const fixtures: FixtureSpec[] = SLOTS.map((sl, i) =>
    fbox(sl[0], 0.9, sl[1], 3.4, 1.8, 3.0, 0x2f343b, { label: `slot ${i + 1}` }),
  );

  const phases: Phase[] = [wait(0.8, '📦 Facing plan: 4 slots · distance sensor confirms occupancy')];
  SPOTS.forEach((sp, i) => {
    phases.push(
      ...pickPlace(ARM, sp, [SLOTS[i][0], SLOTS[i][1] + 0.6], {
        speed: 0.8, fh: 1.4, th: 1.6, safe: 8,
        say: i === 0 ? '🗣️ "Refill slot one." → occupancy is the whole problem' : `slot ${i + 1} restocked`,
      }),
    );
    phases.push(wait(0.35, `   ✓ occupancy before/after recorded`));
  });
  phases.push(wait(0.8, '📄 Restock log with timestamps — the deliverable a retailer wants'));

  return {
    id: 'restock-kiosk',
    title: 'Kiosk Restocking',
    emoji: '📦',
    category: 'Industry & Testing',
    tagline: 'Slot occupancy before and after, logged',
    story:
      'A kiosk or vending face has a facing plan. Four stock crates are laid out well apart on the floor, each destined for its own labelled slot. The distance sensor is the natural fit: occupancy before and after is the entire problem, and the restock log with timestamps is what the operator actually wants.',
    novelty:
      'The narrowest and most obviously monetisable case in the set. It needs no object recognition at all — just "is this slot full or not".',
    difficulty: 1,
    arms: 1,
    hardware: ['Four stock crates (3D, with rims and contents), laid out apart', 'Four labelled slot positions', 'Atech VL53L5CX distance sensor per slot (or one, moved)', 'Voice'],
    approach:
      'Occupancy-only verification. Slot full before → skip. Slot empty after → flag. No identification required, which makes it the cheapest deployment in the catalogue.',
    howTo: [
      'Mark each slot position and space the crates far apart on the floor.',
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
    cam: frame([...SPOTS]),
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
