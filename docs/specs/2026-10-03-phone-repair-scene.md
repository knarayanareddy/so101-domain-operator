# Phone-Repair Assist Scene — Spec

**Status:** implemented (groups A–F met; physical arm still unverified)
**Owner:** —
**Date:** 2026-10-03
**Applies to:** `~/.so101/deck` (pinned copy of `~/Downloads/so-101-robotic-arm-development`)

## Problem

The startup pitch is "a robot that performs *your* task, trained, for a fraction of the
price." The demo must prove that claim on one narrow, real workflow rather than a
grab-bag of party tricks.

The existing deck has 24 generic missions and a proven control stack, but **nothing
modelled on a technician's workflow**: no parts bins, no step order, no checklist, no
record of what was done. There is also **no ledger/event-record concept anywhere** in
`src/` (verified by grep: only `missions.ts` and `GuideTab.tsx` mention the words, and
neither implements one).

Evidence the underlying stack is ready: 34 tests pass, all 24 missions execute live on
the virtual arm, `verifyGrasp`/`slipCheck` give real stall-detected grasps, and
`fitAndValidate` reports honest held-out camera error. The gap is domain modelling, not
robotics.

## Non-goals

These prevent the scope creep that killed the original two-product pitch.

- **Not a second arm.** One follower + one camera. The two-arm QA arm is roadmap, not v1.
  Each arm adds a bus adapter, a calibration, and a failure surface.
- **Not "detects craftsmanship".** We do not judge whether a solder joint is good. We
  verify **discrete, checkable events**: right part, right step, present/absent.
  COCO has no `capacitor`/`connector`/`PCB`; YOLO11n cannot see them. Claiming it would
  be false.
- **Not real defect prediction.** No model is asked to find a fault nobody labelled.
- **No new dependencies.** Everything below builds on the shipped code.
- **No audio hardware.** Voice is a thin layer; the scene must be fully demoable muted.
- **Not trained learning.** Scripted, deterministic, verifiable — the pitch is that
  per-domain behaviour is *authored against your procedure*, not learned from scratch.
- **Optional inputs are strictly additive.** The scene must run, and pass every criterion
  in groups B/C/D, with **no** external sensor board attached. A missing board degrades a
  verdict from `pass` to `unknown`; it must never fail the run, and must never be
  required to produce a ledger.

## Optional inputs (additive only)

The base scene needs nothing beyond the arm and a table. Two side-channels may enrich it.
Both are **optional** and both are **advisory** — neither can move a robot.

| Input | Service | Adds | Degrades to |
|---|---|---|---|
| Overhead webcam | built into the deck | part **identity** via `perceive()` | `needsCamera: false` path — position-only |
| Atech ESP32-S3 board | `tools/atech_watch.py` | tray **occupancy** + technician step-confirm | verdict `unknown` for that step only |

**Atech board specifics** (`atech.dev/docs`, read 2026-10-03; service verified 17/17 offline):

- Transport: USB-C, **115200 baud, one JSON object per line**. WiFi mode
  (`wss://gateway.atech.dev`) is **not** used — it needs the cloud relay and a project id.
- Modules worth taking: `vl53l5cx_distance` (64-zone, mm) for tray occupancy;
  `button_module` for step-confirm; `neopixel_grid` for tray indicator lights.
- `robot_arm` module is **explicitly rejected** — it is a toy arm that happens to speak the
  same 0–4095 tick protocol as STS3215. We have two real SO-101s; a third is a distraction.
- The **Load Cell is sold on their shop page but absent from their published module
  reference.** Its payload is unknown and must not be guessed. `atech_watch.py` counts
  unknown keys and surfaces them via `GET /events` → `unknown_keys`, so it is *discovered*
  on the day rather than assumed.
- **Safety:** the board exposes `set_torque`, `move_all`, `move_joint`. `atech_watch.py`
  whitelists LED/display actions only; those three are rejected with HTTP 403. This service
  can light LEDs and cannot command a robot. Verified over the wire.

## Approach

Add one mission, `phone-repair`, plus a small `RepairLedger` type. Reuse the existing
`SCENES`/`SETUPS` registries (`missions.ts:697` and `:713`, attached in the post-pass at
`:730-736`) — that is the established pattern for scene data and set-up notes, and
`hanoi` already proves it works on both virtual and real tables.

The workflow is a **parts-tray fetch-and-place sequence**: the technician asks by voice for
a part, the arm verifies the tray it is about to take from actually contains it, moves,
and records the event. Parts are represented as coloured blocks of distinct size so the
existing HSV detector and stall-detecting grasp work unchanged.

The ledger is the product artefact: an ordered, timestamped record with a
pass/fail/unknown verdict per step, exportable as JSON.

## Existing seams this builds on

| Seam | Location | Used for |
|---|---|---|
| `Mission.scene(p) => SimObject[]` | `missions.ts:697` `SCENES` | virtual-table layout |
| `Mission.setup?: string[]` | `missions.ts:713` `SETUPS` | physical set-up notes |
| `Runner.pick/place/targets` | `missions.ts` | motion primitives |
| `Arm.grasp()/slipCheck()` | `arm.ts:269,299` | real stall-verified grasp |
| `Runner.failStreak` / `MAX_FAIL_STREAK` | `missions.ts:66` | give up rather than loop |
| `vision.detectByColor/detectByDiff` | `vision.ts:250,258` | part presence |
| `fitAndValidate` | `vision.ts:127` | honest camera accuracy gate |
| `atech_watch.py` | `tools/` | **optional** tray-occupancy / step-confirm events (localhost HTTP) |
| verdict `"unknown"` | spec-defined | how an unavailable optional input is represented |

## Acceptance criteria

Each names its verification. None is aspirational.

### A. Scene and set-up

- [ ] **A1** `phone-repair` appears in `MISSIONS` and `MISSIONS.some(m => m.id === "phone-repair")` is `true`.
      *Verify:* new unit test in `src/lib/__tests__/repair.test.ts`.
- [ ] **A2** `phone-repair.scene` is a function and returns one `SimObject` per `PART_TABLE` entry (≥ 3) with unique `id`s, each with a distinct `rgb`.
      *Verify:* unit test asserting `objs.length === PART_TABLE.length`, unique ids, and no two objects share an `rgb`. *(Corrected from "≥ 6": that number was arbitrary and the three-part tray is the actual design.)*
- [ ] **A3** `phone_repair.setup` is a non-empty string array naming the physical props.
      *Verify:* unit test, `expect(m.setup.length).toBeGreaterThan(0)`.
- [ ] **A4** Every part in `scene()` lies within the arm's reachable workspace and outside the bin.
      *Verify:* unit test calling `inverse()` from `kinematics.ts` on each object's `(x, y, z)`; assert it is non-null, and `inBin()` is false.
- [ ] **A5 (negative)** A scene with an unreachable coordinate fails its own reachability test.
      *Verify:* a fixture part at x = 200 cm makes A4's assertion throw. This proves the test can fail.

### B. Deterministic behaviour

- [ ] **B1** Running the scene on the **virtual arm** completes and returns a string matching `/step \d+\/N complete/`.
      *Verify:* live test mirroring `src/lib/__tests__/hanoi.test.ts` — real `Arm` over `SimServoTransport`, `setTorque(true)`, then `mission.run(...)`.
- [ ] **B2** The run places every fetched part in its designated tray zone.
      *Verify:* after the run, `world.objects.filter(o => o.kind === "zone" && o.id.startsWith("tray-"))` each contain the expected part id, via a new `world.contentsOf(zoneId)` helper or direct coordinate assertion.
- [ ] **B3** A part that is **not on the table** is reported, not silently skipped.
      *Verify:* remove one part from `scene()`; assert the returned string contains `missing` and names the part.
- [ ] **B4 (negative)** A repeated failed grasp aborts rather than looping.
      *Verify:* run with an empty table; assert the thrown message matches `/failed in a row/` (existing `MAX_FAIL_STREAK` behaviour).
- [ ] **B5** The mission is **camera-free** (`needsCamera === false`), so it is runnable headless with no webcam.
      *Verify:* unit test asserting `m.needsCamera === false`.
- [ ] **B6** Dry-run writes nothing to the servos and still produces the full step plan.
      *Verify:* `{...DEFAULT_RUNNER, dryRun: true}`; assert one `pick at` and one `place at` log line per part, and that `arm.cmd` is unchanged. *(Note: dry-run returns before any `goto`, so `pick`/`place` lines are the plan evidence — not `goto`.)*

### C. Ledger — the product artefact

- [ ] **C1** `RepairLedger` records one entry per step with `step`, `part`, `verdict`, `t_ms`.
      *Verify:* unit test on the type + a `record()` call; assert entry count equals step count.
- [ ] **C2** Verdicts are exactly `"pass" | "fail" | "unknown"` — no free-form strings.
      *Verify:* type-level test plus a runtime guard throwing on any other value.
- [ ] **C3** A missing part yields `"fail"`, never a silent pass and never a throw.
      *Verify:* fixture with a removed part; assert exactly one `fail` and that `run()` still returns normally.
- [ ] **C4** The ledger serialises to valid JSON and round-trips.
      *Verify:* `JSON.parse(JSON.stringify(ledger))` deep-equals the original.
- [ ] **C5** The ledger is returned from `run()`'s result string or a companion accessor, so a caller can obtain it without scraping logs.
      *Verify:* unit test asserting a typed accessor exists and returns ≥ 1 entry after a run.

### D. Safety invariants (must hold on real hardware)

- [ ] **D1** The scene **never** calls `setTorque(true)` itself; torque is the caller's decision.
      *Verify:* grep the mission body for `setTorque` → expect zero matches; unit test asserting `arm.torque === false` after a dry run.
- [ ] **D2** Every pick goes through `Runner.pick`, which is stall-verified — no direct `arm.grasp()` shortcut bypassing `verifyGrasp`.
      *Verify:* grep the mission body for `arm.grasp` → zero matches.
- [ ] **D3** Preconditions (camera calibration for camera variants, arm connected) are enforced by `preflight`, not by the mission body.
      *Verify:* `preflight` currently lives inside the `RoomProvider` React hook (`RoomProvider.tsx:484`), so it is not callable from a unit test as-is. Either (a) extract `preflight` to a pure exported function taking `{mission, follower, cal, report, hasBackground}` and test that directly, or (b) mark this criterion as satisfied by the existing hook and add a manual check in the Missions tab: with no follower connected, the Run button is disabled and a blocker is listed. **Prefer (a)** — a testable gate is the point of this criterion.
- [ ] **D4** Aborting mid-run leaves torque off.
      *Verify:* abort test — start `run()`, abort the signal after the first step, assert `arm.torque === false` after the runner unwinds.

### E. No regression

- [ ] **E1** `npm test` passes with the new tests added.
      *Verify:* `cd ~/.so101/deck && npm test`.
- [ ] **E2** `npm run test:live` still passes all missions including the new one.
      *Verify:* `cd ~/.so101/deck && npm run test:live`.
- [ ] **E3** `npx tsc --noEmit` is clean.
      *Verify:* same.
- [ ] **E4** `next build` succeeds with no `DATABASE_URL`.
      *Verify:* `env -u DATABASE_URL npm run build`.

### F. Optional Atech board input (additive — must be skippable)

Service: `tools/atech_watch.py` (built and verified 17/17 offline; run via
`so101-atech start <port>`). Advisory only — it cannot command a robot.

- [ ] **F1** The scene runs and produces a complete ledger with **no** Atech board present, and no criterion in B/C/D changes.
      *Verify:* integration test with no board running; assert ledger entry count equals step count and no verdict is `unknown` solely from absence.
- [ ] **F2 (negative)** When `atech_watch` is unreachable, affected step verdicts are `unknown` and the run **still completes** — it does not throw and does not mark `fail`.
      *Verify:* point the client at a closed port; assert the run returns normally and at least one entry has `verdict === "unknown"` with a reason naming the unavailable input.
- [ ] **F3** An injected `distance` event crossing a configured threshold yields `verdict: "pass"` for tray occupancy; not crossing yields `unknown`, never `fail`.
      *Verify:* `POST /event` a distance above and below the threshold to `atech_watch.py`, then assert the ledger verdict for each.
- [ ] **F4** An injected `button_1` press is recorded as the step-confirm signal for the current step.
      *Verify:* `POST /event` `{"type":"event","payload":{"type":"button","key":"button_1","value":1}}`; assert the next ledger entry carries the confirm field.
- [ ] **F5** The mission body contains no direct HTTP or serial access to the board — it reads only through the ledger/verdict interface.
      *Verify:* grep the mission body for `atech|8767|fetch(` → zero matches.
- [ ] **F6 (safety)** `atech_watch.py` rejects `set_torque`, `move_all`, `move_joint` with HTTP 403, and allows `set_color`.
      *Verify:* `so101-atech test` runs the whitelist assertions, plus the recorded wire-level check — `set_color` returns 409 (whitelist passed, board not connected) while the three robot actions return 403.

## Design notes

**Why blocks, not realistic parts.** The detector is HSV colour thresholding and the
grasp is stall-based on jaw opening. Both are indifferent to what the object represents.
Distinct-size blocks exercise identical code paths while staying buildable from pens and
paper in 2.5 days. The *mapping* from block colour to part name lives in one table, so a
customer's real parts tray is a data change, not a code change.

**Zone representation.** Existing `SimObject` has `kind: "object" | "zone"`. Use zones for
the trays, which `SimWorld.inBin()` already reasons about. Do not invent a new concept.

**Why the ledger is not a database.** It is an exportable record, not queryable state. A
local JSON structure keeps it dependency-free and demoable offline. If retention becomes
real, the Postgres backup path (`src/app/api/state`) already exists.

**Escalation hook, deliberately deferred.** Jev is live at ~0.24 s/call and fits a
supervisory loop. When a step's verdict is `"unknown"`, that is the natural escalation
point. This spec does **not** implement it — a deterministic ledger must stand alone
first, and an advisory model must never gate motion.

## Open questions

| Question | Owner | By |
|---|---|---|
| Does the demo show one arm or two? Spec assumes one. | user | day 1 |
| Are part names fixed, or loaded from a customer YAML at runtime? | user | day 1 |
| Does the ledger need to be signed/exportable as CSV for a real QA claim? | user | post-event |
| Is "voice request" in scope for the demo, or only the checklist? | user | day 1 |

## Rollout / rollback

Rollback is trivial and total: delete `phone-repair` from `MISSIONS` and its entries from
`SCENES`/`SETUPS`, delete the new test file. No existing code path is modified — the scene
is additive data plus one mission entry. **No migration, no data loss, no rollback risk.**

## Handoff summary

```
Requirements clarified: 4 open questions listed; 1 arm and camera-free assumed
Stack: unchanged — no new dependencies (per spec-adr-authoring: no ADR needed)
Implemented: src/lib/repair.ts, repair-inputs.ts, repair-mission.ts, mission+SCENES+SETUPS in missions.ts,
  src/lib/__tests__/repair.test.ts (29 tests)
Verified: tsc clean | npm test 63 passed / 25 skipped | test:live 25/25 | next build exit 0
Spec: this file, 30 acceptance criteria across A–F (F = optional Atech board, additive)
Gates: L2 -> npm test && npm run test:live && npx tsc --noEmit && npm run build
Skills engaged: spec-adr-authoring, stack-selection, project-bootstrap, repository-audit-review
Skills deliberately skipped: tech-debt-audit (new code, no debt to audit);
  stack-selection (no new technology choice — explicitly rejected new deps)
Risks accepted: blocks-not-real-parts (documented above); real-hardware unverified
```