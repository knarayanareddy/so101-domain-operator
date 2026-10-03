import type { Scenario, Phase, PropSpec, FixtureSpec } from '../sim/types';
import { P, wait, pickPlace, fbox, fcyl } from './dsl';

/**
 * Five-domain showcase.
 *
 * Every scenario here follows the SAME four-stage shape the live phone-repair demo
 * uses:  Script -> Voice -> Perception -> Verification -> Ledger.
 *
 * Only the domain nouns change. That is the point: the methodology transfers, and the
 * way to show that to a judge is to run five visibly different jobs through the
 * identical motion/verify/record pipeline.
 *
 * Honesty notes carried in the copy below, deliberately:
 *  - These run in Sim Lab (a Three.js rig), NOT on the SO-101 and NOT on real hardware.
 *  - No occupant/person detection is claimed anywhere. The deck does not detect people.
 *  - YOLO/COCO has no class for a component reel, a sample tube or a bottle, so these
 *    scenarios use colour + occupancy, which is what the vision code actually does well.
 *  - The ledger shown is a timestamped record, the artefact a customer would buy.
 */

/** Shelf/tray geometry shared by the kitted domains. */
const BENCH_X = 24;

/* ========================================================================
 * 1. MOBILE PHONE REPAIR — the live-hardware anchor domain
 * ===================================================================== */
function phoneRepair(): Scenario {
  const props: PropSpec[] = [];
  const fixtures: FixtureSpec[] = [];
  const phases: Phase[] = [];

  const PARTS = [
    { id: 'part-battery', label: 'battery', color: 0x4a7fe0, x: BENCH_X + 2, z: -6 },
    { id: 'part-screen', label: 'screen', color: 0x4dab5f, x: BENCH_X + 2, z: -2 },
    { id: 'part-board', label: 'logic board', color: 0xe05252, x: BENCH_X + 2, z: 2 },
  ];
  const MAT = [12, 0] as [number, number];

  fixtures.push(fbox(MAT[0], 0.2, MAT[1], 12, 0.4, 10, 0x2b2f36, { label: 'work mat' }));
  // technician's phone on the mat
  fixtures.push(fbox(MAT[0], 0.7, MAT[1], 3.2, 0.5, 6.4, 0x111318));

  for (const p of PARTS) {
    props.push({
      id: p.id, shape: 'box', size: [2.2, 1.2, 1.6], pos: [p.x, 0.6, p.z],
      color: p.color, rough: 0.5, label: p.label, grab: true, width: 2.2,
    });
    // tray label card beside each part
    fixtures.push(fbox(p.x + 3.2, 0.9, p.z, 1.6, 1.8, 0.2, 0xf1f3f5, { label: p.label }));
  }

  phases.push(wait(0.6, '📋 Work order open: screen replacement, 3 parts'));
  PARTS.forEach((p, i) => {
    phases.push(
      ...pickPlace('a', [p.x, p.z], MAT, {
        speed: 0.85, fh: 1.4, th: 2.0, safe: 7,
        say: i === 0 ? '🗣️ "Next: battery." → arm fetches from tray 1' : `step ${i + 1}/3 · ${p.label} · ledger: pass`,
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
      'A technician works a repair order at the bench. Three parts sit in labelled trays. The arm fetches each one in checklist order, verifies the grasp by motor load, and writes one ledger entry per step recording what was done and which input proved it.',
    novelty:
      'The deliverable is not the pick — it is the record. Every verdict names its evidence, and an input that could not be checked yields "unknown", never a false pass.',
    difficulty: 2,
    arms: 1,
    hardware: [
      '3 colour-coded parts on taped tray marks',
      'Optional Atech VL53L5CX distance sensor over a tray (occupancy confirmation)',
      'Microphone (voice)',
      'Overhead camera (colour detection + homography)',
    ],
    approach:
      'Scripted pick & place + closed-loop verification via motor stall, then a ledger whose verdict is pass / fail / unknown with the evidence source recorded.',
    howTo: [
      'Tape three tray marks in a column at the bench X, and a work mat in front of the technician.',
      'Place one distinct-coloured part per tray row, centred on its mark.',
      'Calibrate the camera homography once with 4+ marks on the table plane.',
      'Run: the arm picks each part in order and writes one ledger entry per step.',
      'Add the distance sensor if you want tray occupancy as a second, independent confirmation.',
    ],
    code: `# One pass per checklist step. Two independent verifications, three verdicts.
for step in work_order.steps:
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
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 2. ELECTRONICS BENCH / PCB ASSEMBLY — different scale, same code
 * ===================================================================== */
function pcbAssembly(): Scenario {
  const props: PropSpec[] = [];
  const fixtures: FixtureSpec[] = [];
  const phases: Phase[] = [];

  const REELS = [
    { id: 'reel-r', label: '0402 resistors', color: 0xd9a441 },
    { id: 'reel-c', label: '0402 capacitors', color: 0x5f8fd9 },
    { id: 'reel-led', label: 'LEDs', color: 0xe06a5f },
  ];
  const PCB = [11, 0] as [number, number];

  // workbench surface
  fixtures.push(fbox(20, -0.1, 0, 22, 0.3, 16, 0x3a3f47, { label: 'assembly bench' }));
  // the board under assembly
  fixtures.push(fbox(PCB[0], 0.35, PCB[1], 7, 0.5, 5, 0x1d5c3a, { label: 'PCB' }));
  // kitting tray with three labelled wells
  fixtures.push(fbox(BENCH_X + 2, 0.3, -5, 8, 0.6, 12, 0x545a63));
  REELS.forEach((r, i) => {
    fixtures.push(fbox(BENCH_X + 2, 0.7, -9 + i * 4, 6, 0.3, 3, 0x2f343b, { label: r.label }));
  });

  for (const r of REELS) {
    const z = BENCH_X > 0 ? -4 : 0;
    props.push({
      id: r.id, shape: 'cyl', size: [1.1, 0.9], pos: [BENCH_X + 2, 1.0, -8 + REELS.findIndex((x) => x.id === r.id) * 4],
      color: r.color, rough: 0.35, label: r.label, grab: true, width: 2.2,
    });
    void z;
  }

  phases.push(wait(0.6, '📐 Assembly order loaded from the work instruction'));
  REELS.forEach((r, i) => {
    phases.push(
      ...pickPlace('a', [BENCH_X + 2, -8 + i * 4], [PCB[0] - 1.6 + i * 1.6, PCB[1]], {
        speed: 0.7, fh: 1.2, th: 1.6, safe: 7,
        say: i === 0 ? '🗣️ "Pass the resistor pack." → same vision, same grasp' : `place ${r.label} at footprint ${i + 1}`,
      }),
    );
    phases.push(wait(0.3, `   ✓ placed · ledger step ${i + 1}/3`));
  });
  phases.push(wait(0.7, '⚠️ Out-of-order step → flagged BEFORE the board is closed'));

  return {
    id: 'pcb-assembly',
    title: 'PCB Assembly Kitting',
    emoji: '🔌',
    category: 'Industry & Testing',
    tagline: 'Same pipeline, smaller parts and a different vocabulary',
    story:
      'A bench technician builds a board from a kitting tray. Component reels are fetched in assembly order and placed at footprints. The value is not the pick: it is that a step done out of order, or with the wrong reel, is flagged while the board is still open.',
    novelty:
      'Proves the methodology is domain-independent. Different object scale, different names, different failure modes — identical detect → verify → record pipeline.',
    difficulty: 2,
    arms: 1,
    hardware: ['3 labelled component reels (or blocks standing in)', 'Overhead camera', 'Optional distance sensor for reel-present check'],
    approach:
      'Same colour-threshold detection and stall-verified grasp as the repair bench. The work instruction supplies the order; the ledger flags deviation.',
    howTo: [
      'Lay out the kitting tray with one labelled well per component type.',
      'Place the bare PCB on the mat in front of the technician.',
      'Load the assembly order; each step names a well and a footprint.',
      'Run: the arm fetches each reel in order and records placement.',
    ],
    code: `# Identical pipeline. Only the data changes.
order = work_instruction.steps        # [(reel_well, footprint), ...]
seen = set()
for i, (well, footprint) in enumerate(order):
    if well not in seen and tray_occupancy(well) is False:
        ledger.record(i, "fail", reason=f"well {well} empty — wrong reel fetched")
    part = vision.locate(reel_rgb[well], tol=40)
    arm.pick(part.world) and arm.place(footprint)
    seen.add(well)
    ledger.record(i, "pass")`,
    theme: 'lab',
    props,
    fixtures,
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 3. LABORATORY SAMPLE HANDLING — becomes an audit trail
 * ===================================================================== */
function labSamples(): Scenario {
  const props: PropSpec[] = [];
  const fixtures: FixtureSpec[] = [];
  const phases: Phase[] = [];

  const SAMPLES = [
    { id: 'smp-a1', label: 'A1', color: 0xe05252 },
    { id: 'smp-a2', label: 'A2', color: 0x5f8fd9 },
    { id: 'smp-a3', label: 'A3', color: 0x69b87a },
  ];
  const RACK_X = BENCH_X + 2;

  // numbered rack: 4 slots
  fixtures.push(fbox(RACK_X, 0.3, 0, 10, 0.6, 16, 0x545a63, { label: 'sample rack' }));
  for (let i = 0; i < 4; i++) {
    fixtures.push(fbox(RACK_X, 0.65, -6 + i * 4, 8, 0.2, 3, 0x2f343b, { label: `slot ${i + 1}` }));
  }
  // analyser station the samples go to
  fixtures.push(fbox(11, 1.0, 0, 5, 2.0, 6, 0x2b3038, { label: 'analyser' }));

  SAMPLES.forEach((s, i) => {
    props.push({
      id: s.id, shape: 'cyl', size: [0.7, 3.0], pos: [RACK_X - 3.5, 1.6, -6 + i * 4],
      color: s.color, opacity: 0.85, rough: 0.15, label: s.label, grab: true, width: 1.4,
    });
  });

  phases.push(wait(0.6, '🧪 Manifest loaded: A1, A2, A3 → analyser'));
  SAMPLES.forEach((s, i) => {
    phases.push(
      ...pickPlace('a', [RACK_X - 3.5, -6 + i * 4], [11, -1.6 + i * 1.6], {
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
    code: `# Position is the invariant. Appearance is irrelevant.
for slot in manifest.order:
    if distance.slot_occupied(slot):
        continue                                  # already in place
    tube = rack.pick(slot)
    assert tube.slot == slot                     # wrong slot -> abort
    analyser.place(tube)
    custody.append(t_ms=now(), event="moved", slot=slot, sample=tube.id)`,
    theme: 'lab',
    props,
    fixtures,
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 4. ASSISTIVE / CARE — hands-free, and honest about what it does not do
 * ===================================================================== */
function assistiveServe(): Scenario {
  const props: PropSpec[] = [];
  const fixtures: FixtureSpec[] = [];
  const phases: Phase[] = [];

  const ITEMS = [
    { id: 'cup', label: 'drink', color: 0x8fd0e8, shape: 'cyl' as const, size: [1.4, 2.4] },
    { id: 'book', label: 'magazine', color: 0xd9784a, shape: 'box' as const, size: [3.0, 0.5, 2.2] },
  ];
  const HAND = [14, 0] as [number, number];

  // side table the items sit on
  fixtures.push(fbox(BENCH_X + 2, 0.4, 0, 8, 0.8, 10, 0x6b5545, { label: 'side table' }));
  // taped handover point in front of the person
  fixtures.push(fcyl(HAND[0], 0.03, HAND[1], 3.0, 0.06, 0x2fa84f, { label: 'handover point' }));
  // the person's side of the table (a seat, deliberately NOT a person detector)
  fixtures.push(fbox(6, 0.5, 0, 5, 1.0, 5, 0x3f4750, { label: 'seat' }));

  ITEMS.forEach((it, i) => {
    props.push({
      id: it.id, shape: it.shape, size: it.size, pos: [BENCH_X + 2, 1.6 + (it.shape === 'cyl' ? 0 : 0), -3 + i * 6],
      color: it.color, rough: 0.3, label: it.label, grab: true, width: it.shape === 'cyl' ? 2.8 : 3.0,
    });
  });

  phases.push(wait(0.7, '🔔 Request received: voice only — hands are the bottleneck'));
  ITEMS.forEach((it, i) => {
    phases.push(
      ...pickPlace('a', [BENCH_X + 2, -3 + i * 6], HAND, {
        speed: 0.65, fh: 1.6, th: 2.6, safe: 7,
        say: i === 0 ? '🗣️ "Here is your drink." → placed at the taped handover point' : '🗣️ "Here is your magazine."',
      }),
    );
    phases.push(wait(0.5, '   ✓ handover complete · awaiting confirmation button'));
    // arm withdraws to a polite resting pose rather than hovering over the person
    phases.push(P('a', 1.0, { p: [18, 9, 0], pitch: -60, grip: 1 }, '   …arm withdraws to rest'));
  });
  phases.push(wait(0.8, '📄 Ledger: who was served, when, and whether handover succeeded'));

  return {
    id: 'assistive-serve',
    title: 'Assistive Handover',
    emoji: '🤲',
    category: 'Care & Assistive',
    tagline: 'Hands-free delivery to a taped handover point',
    story:
      'A person at a table asks for a drink or a magazine by voice. The arm fetches it from the side table and places it on a taped handover point, then withdraws to rest. Every handover is recorded: what, when, and whether it succeeded.',
    novelty:
      'Voice is not a gimmick here — it is the interface, because the user\'s hands are the bottleneck. The handover point is a taped mark, not a person-detection claim.',
    difficulty: 1,
    arms: 1,
    hardware: ['Side table', 'Taped handover mark', 'Microphone', 'Optional button for confirmation'],
    approach:
      'Voice request → fetch → place at a fixed mark → withdraw. Verification is stall check plus an optional operator confirmation.',
    howTo: [
      'Tape a handover point where the person can reach it comfortably.',
      'Put the items on a side table within reach.',
      'Connect a microphone; speak the request.',
      'Optionally add a button: the person confirms and the ledger records it.',
    ],
    code: `# What this does NOT do: detect people. The handover point is a taped mark.
request = stt.listen()                       # voice in
item = catalogue.match(request)             # "drink" -> cup
arm.pick(item.world) and arm.place(HANDOVER_MARK)
ledger.record(request, "delivered", evidence="arm",
               confirmed=button.pressed())   # optional human confirmation`,
    theme: 'warm',
    props,
    fixtures,
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ========================================================================
 * 5. RETAIL / KIOSK RESTOCKING — the most obviously monetisable closer
 * ===================================================================== */
function restockKiosk(): Scenario {
  const props: PropSpec[] = [];
  const fixtures: FixtureSpec[] = [];
  const phases: Phase[] = [];

  const FACING = [
    { id: 'slot-1', label: 'slot 1', color: 0xd94f4f },
    { id: 'slot-2', label: 'slot 2', color: 0x4f8fd9 },
    { id: 'slot-3', label: 'slot 3', color: 0x5fb96f },
    { id: 'slot-4', label: 'slot 4', color: 0xd9b04f },
  ];
  const SHELF = 22;

  // shelving unit: 4 slots, front lip so it reads as a facing plan
  fixtures.push(fbox(SHELF, 1.6, 0, 4, 3.2, 20, 0x4a5058, { label: 'shelf' }));
  FACING.forEach((f, i) => {
    fixtures.push(fbox(SHELF - 2.1, 0.9 + Math.floor(i / 2) * 1.6, -4.5 + (i % 2) * 9,
      0.3, 1.2, 8, 0x2f343b, { label: f.label }));
  });
  // restock crates on the floor beside the shelf
  FACING.forEach((f, i) => {
    props.push({
      id: `stock-${f.id}`, shape: 'box', size: [2.4, 2.0, 2.4], pos: [SHELF - 7, 1.0, -6 + i * 4],
      color: f.color, rough: 0.6, label: f.label, grab: true, width: 2.4,
    });
  });

  phases.push(wait(0.7, '📦 Facing plan: 4 slots · 2 are empty'));
  FACING.forEach((f, i) => {
    const slotZ = -4.5 + (i % 2) * 9;
    const slotY = 0.9 + Math.floor(i / 2) * 1.6;
    phases.push(
      ...pickPlace('a', [SHELF - 7, -6 + i * 4], [SHELF - 1.6, slotZ], {
        speed: 0.8, fh: 1.4, th: slotY + 0.8, safe: 8,
        say: i === 0 ? '🗣️ "Refill slot one." → distance sensor confirms occupancy' : `slot ${i + 1} restocked`,
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
      'A kiosk or vending face has a facing plan. Empty slots are refilled from crates. The distance sensor is the natural fit here: occupancy before and after is the entire problem, and the restock log with timestamps is what the operator actually wants.',
    novelty:
      'The narrowest and most obviously monetisable case in the set. It needs no object recognition at all — just "is this slot full or not".',
    difficulty: 1,
    arms: 1,
    hardware: ['Shelf with 4 slots', '4 stock crates', 'Atech VL53L5CX distance sensor per slot (or one, moved)', 'Voice'],
    approach:
      'Occupancy-only verification. Slot full before → skip. Slot empty after → flag. No identification required, which makes it the cheapest deployment in the catalogue.',
    howTo: [
      'Mark each slot position and fix the shelf.',
      'Place one crate per slot within reach.',
      'Mount a distance sensor per slot, or one sensor and a per-slot threshold table.',
      'Run: empty slots are refilled and each before/after reading is logged.',
    ],
    code: `# No identification needed. Occupancy is the whole problem.
for slot in facing_plan:
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
    program: { kind: 'phases', phases, loop: true },
  };
}

/* ------------------------------------------------------------------ */
export function showcaseScenarios(): Scenario[] {
  return [phoneRepair(), pcbAssembly(), labSamples(), assistiveServe(), restockKiosk()];
}

/** Ordered demo script: the live hardware segment runs first, then breadth. */
export const SHOWCASE_SCRIPT: {
  domain: string;
  live: boolean;
  duration_s: number;
  says: string;
}[] = [
  { domain: 'Mobile Phone Repair', live: true, duration_s: 90, says: 'This one is running on the real arm in front of you.' },
  { domain: 'PCB Assembly Kitting', live: false, duration_s: 40, says: 'Same pipeline — smaller parts, different vocabulary.' },
  { domain: 'Lab Sample Handling', live: false, duration_s: 40, says: 'Same pipeline — and now it produces a custody record.' },
  { domain: 'Assistive Handover', live: false, duration_s: 40, says: 'Same pipeline — voice only, because hands are the bottleneck.' },
  { domain: 'Kiosk Restocking', live: false, duration_s: 40, says: 'Same pipeline — occupancy only. Cheapest thing we deploy.' },
];
