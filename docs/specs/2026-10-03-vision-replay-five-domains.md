# Vision Replay + Five-Domain Showcase — Scope

**Status:** draft (scoped, not implemented)
**Owner:** —
**Date:** 2026-10-03
**Applies to:** `~/.so101/deck`
**Companion spec:** `docs/specs/2026-10-03-phone-repair-scene.md` (implemented)

## Problem

The live demo story is: *script → voice → camera finds the part → distance sensor confirms → arm moves → ledger records*. Judges must also see that the **same methodology** transfers to other domains.

Today it does not, for two separate reasons:

1. **Sim Lab cannot show vision.** It runs its own Three.js engine
   (`playground/sim/engine.ts`, 1315 lines) with its own `ik`/`kinematics`, entirely
   separate from the real stack. Its context exposes only `prop(id): V3` — a
   Three.js `Vector3`. There is no image, no detection, no homography. In that engine
   `camera`/`Scene.background` are *viewpoints for the 3D render*, not sensors. Easy
   to misread as "it has vision"; it does not.
2. **Sim Lab also lacks the real arm's grounding.** No `SimWorld`, therefore no
   stall-detected grasps, no telemetry, no ledger. A scenario cannot react to a
   detection because there is no detection to react to.

The result is that breadth reads as vapourware: the same narrative with two-thirds of
the sensors missing. That is the opposite of what this demo needs.

## Non-goals

- **Do not rewrite or unify the two engines.** The Three.js rig stays as the
  visualisation layer. Attempting to merge it with `lib/arm.ts` is a rewrite that
  would consume the entire event and risk the working demo.
- **Do not add a new detection model.** Replay uses the *existing* `vision.ts`
  unchanged. The claim is "one detection implementation, two visualisations" — that
  only holds if it is genuinely the same code.
- **No new dependencies.** `Img` is `{data: Uint8ClampedArray, width, height}` — plain
  data, no canvas or DOM required, so replay works headless and in tests.
- **Not a simulator of camera physics.** Replay plays recorded frames; it does not
  synthesise plausible lighting or occlusion.
- **No claim that Sim Lab runs real hardware.** It does not, and the UI must not imply it.

## Approach

Three additive pieces.

**1. Vision Replay (the new capability).** Extract the frame-source seam that today
lives inline in `RoomProvider.grabFrame` (`RoomProvider.tsx`, `drawImage(video)` →
`getImageData`) into a `FrameSource` interface with two implementations:

| Source | Behaviour |
|---|---|
| `LiveCameraSource` | the existing webcam path, unchanged behaviour |
| `ReplaySource` | steps a folder of JPEG frames at a fixed rate, in sequence |

Both return the identical `Img` struct, so `vision.ts` is untouched and every existing
caller (`perceive()`, `detectByColor`, `detectByDiff`, `localizeAll`) keeps working. The
`/api/state` route gains a `POST` to record frames to disk so a session can be captured
once and replayed for the rest of the event — the demo becomes repeatable rather than
dependent on live lighting.

**2. A perception overlay in the Lab tab.** `LabTab` gains a `perception` sub-tab beside
`playground`/`exploded`/`build`/`overview`. It renders the current frame with the live
`Detection[]` drawn on top — boxes, world coordinates in cm, and the calibrated
homography grid. A scenario can then be driven by `SimWorld` reacting to *real*
detections from a recorded session, which is what makes the generalisation claim honest.

**3. Five domains, one script.** Each domain reuses the same four-stage shape as
phone repair — **Script → Voice → Perception → Verification → Ledger** — so the
methodology is visibly identical while the domain differs. Details below.

## Existing seams this builds on

| Seam | Location | Role |
|---|---|---|
| `Img` = plain data | `vision.ts` | why replay needs no canvas |
| `detectByColor/detectByDiff` | `vision.ts:250,258` | detection, unchanged |
| `fitAndValidate` | `vision.ts:127` | honest held-out calibration gate |
| `localizeAll` | `vision.ts:279` | px → world cm |
| `grabFrame` | `RoomProvider.tsx` | the seam being extracted |
| `SimWorld` | `sim.ts` | grounds the arm in real detections |
| `Playground` / `LabTab` | `components/lab/` | where the overlay lands |
| 32 existing scenarios | `playground/scenarios/*.ts` | domain breadth already authored |

## Acceptance criteria

Each names its verification.

### R. Vision Replay

- [ ] **R1** `ReplaySource` yields frames in filename order at a configurable rate, and `LiveCameraSource` and `ReplaySource` are interchangeable behind one interface.
      *Verify:* unit test with a temp dir of 5 JPEGs; assert order, count, and that both sources satisfy the same `FrameSource` type.
- [ ] **R2** A frame captured from the replay path is byte-identical to one captured from the live path for the same scene.
      *Verify:* test that feeds the same synthetic `Img` through both paths and compares `data`.
- [ ] **R3** Replay reaches `vision.ts` **without any canvas or DOM**: `detectByColor` runs on a replayed frame in a Node test with no DOM globals.
      *Verify:* vitest with `environment: node`; assert a non-empty `Detection[]`.
- [ ] **R4** End of the frame list stops cleanly and reports exhaustion, rather than throwing or looping the last frame forever.
      *Verify:* replay 3 frames, assert an explicit `exhausted` signal.
- [ ] **R5 (negative)** A missing frame directory yields `empty` and a readable error, not a crash.
      *Verify:* point at a nonexistent path; assert no throw and a message naming the path.

### P. Perception overlay (Lab tab)

- [ ] **P1** The Lab tab shows a `perception` sub-tab and renders the current frame plus live `Detection[]` boxes.
      *Verify:* manual check in the browser; automated check that the overlay component receives `Img` + `Detection[]` and emits box geometry.
- [ ] **P2** Each detection is labelled with **world coordinates in cm**, not pixels.
      *Verify:* unit test on the label formatter given a known `world` point.
- [ ] **P3** The overlay shows the calibrated homography grid and the held-out error from `fitAndValidate`.
      *Verify:* unit test asserting the reported max error matches `ACCURACY_MAX_CM` semantics.
- [ ] **P4** The UI states plainly that replay is a **recording**, not live hardware.
      *Verify:* string assertion on the visible label.

### S. Scenario-driven arm

- [ ] **S1** A `SimWorld` arm reacts to a replayed detection — moving toward a detected object's real world coordinates.
      *Verify:* integration test: replay a frame containing one object, assert the commanded target equals the detected world point.
- [ ] **S2** The overlay and the arm read the **same** `Detection[]` instance for a frame.
      *Verify:* test asserting identity of the array passed to both.

### D. Five domains

- [ ] **D-1** Each of the five domains has a scenario file following the existing `Scenario` shape, with `story`, `novelty`, `hardware`, `approach`, and `howTo` populated.
      *Verify:* unit test asserting five registered scenarios, each with non-empty required fields.
- [ ] **D-2** All five declare their sensors explicitly, and any scenario needing perception sets `needsPerception: true`.
      *Verify:* test over the registry.
- [ ] **D-3** A single `showcaseScript` orders the demo: one live hardware segment, then the five domain segments.
      *Verify:* unit test asserting the script's segment count and that exactly one segment is marked `live`.

### E. No regression

- [ ] **E1** `npx tsc --noEmit` is clean.
- [ ] **E2** `npm test` passes — baseline is 63 passed / 25 skipped.
- [ ] **E3** `npm run test:live` still passes 25/25 missions.
- [ ] **E4** `env -u DATABASE_URL npm run build` exits 0.
- [ ] **E5** No change to `lib/feetech.ts`, `lib/arm.ts`, `lib/kinematics.ts`, or `lib/vision.ts` behaviour. Any edit to those files requires a stated reason in the handoff.

## Design notes

**Why replay rather than live-only.** Live camera at an event is fragile: lighting
changes, someone walks past, a judge blocks the light. A recording makes the demo
deterministic and repeatable, which matters more than being live. The trade is
honesty — the UI says "recorded session", and the *live* path remains available and
unchanged for anyone who wants to see it work on real light.

**Why `Img` being plain data is the whole enabler.** `vision.ts` takes
`{data: Uint8ClampedArray, width, height}` and never touches a canvas. That is why
R3 is satisfiable in a Node test. Had detection been written against `CanvasRenderingContext2D`,
replay would have needed a DOM shim and the whole plan would be far riskier.

**Why the perception overlay is in the Lab tab, not the Vision tab.** The Vision tab
already does live capture and calibration. Putting replay there would blur "this is
calibrating my real camera" with "this is a demonstration". A separate sub-tab keeps
the supervised calibration surface clean — which matters, because calibration is the
step most likely to be done under time pressure.

**Cost estimate.** Frame source + overlay + tests is roughly half a day. The five
domain scenarios are data authoring, not engineering — the `Scenario` shape already
exists and 32 scenarios prove it. If time is short, cut D (the domains) before
cutting R (replay): replay is the part that makes the breadth claim *true*.

## The five domains

Same four-stage shape each time: **Script → Voice → Perception → Verification → Ledger.**
Only the domain nouns change. Props use blocks and pens, matching the event's
"basic stationary" constraint.

### 1. Mobile phone repair *(the live hardware demo)*

- **Script:** screen already off, phone flat on the mat. Steps: fetch battery → screen → logic board, in order.
- **Voice:** "Next: battery." Technician advances the script hands-free.
- **Perception:** colour-threshold detection of the labelled block; optional Atech distance over the tray confirms occupancy.
- **Verification:** `Runner.pick` stall check; tray occupancy via the board.
- **Ledger:** one entry per step, verdict `pass`/`fail`/`unknown`, evidence tagged `arm`/`camera`/`sensor`.
- **Proves:** implemented today. 29 tests, 25/25 live missions.

### 2. Electronics bench / PCB assembly *(Sim Lab + replay)*

- **Script:** parts laid out in a kitting tray; step order is the assembly sequence.
- **Voice:** "Pass the 0402 resistor pack."
- **Perception:** replayed session; blocks stand in for component reels. Detection proves *the same code* handles a different layout and scale.
- **Verification:** part-in-tray check via distance sensor; grasp stall.
- **Ledger:** steps out of assembly order are flagged, which is the real-world value — catching a skipped step *before* the board is closed.
- **Proves:** methodology transfers to a different domain with different scale and vocabulary.

### 3. Laboratory sample handling *(Sim Lab + replay)*

- **Script:** tubes in a numbered rack; a manifest states the expected order.
- **Voice:** "Rack position three."
- **Perception:** the manifest is the ground truth — the interesting check is whether the arm fetched the *right* position, not what the object looks like.
- **Verification:** rack-slot occupancy, and the ledger records which slot was taken.
- **Ledger:** every sample movement is recorded with a timestamp, which is exactly the audit trail a lab needs for chain-of-custody.
- **Proves:** the same pipeline becomes a traceability record, not a toy.

### 4. Assistive / care environment *(Sim Lab + replay)*

- **Script:** a request arrives — "here is your drink" — and the arm brings it to a marked handover point.
- **Voice:** the entire interface. This is the domain where voice is not a gimmick.
- **Perception:** the handover point is a taped mark; occupant detection is deliberately **out of scope** — the deck does not claim to detect people.
- **Verification:** stall check plus the technician's confirmation button.
- **Ledger:** who was served, when, and whether the handover succeeded.
- **Proves:** hands-free assistance where the operator's hands are the bottleneck.

### 5. Retail / kiosk restocking *(Sim Lab + replay)*

- **Script:** facing plan states what each slot should hold; empty slots are filled.
- **Voice:** "Refill slot four."
- **Perception:** slot occupancy is the whole problem — the direct, honest use of the distance sensor.
- **Verification:** occupancy before and after, via the same threshold logic as the repair scene.
- **Ledger:** restock events with timestamps — the deliverable a retailer actually wants.
- **Proves:** the narrowest and most obviously monetisable case, which is a good closer for judges.

## Open questions

| Question | Owner | By |
|---|---|---|
| Record the phone-repair session before or during the event? Needs calm lighting and 10 minutes. | user | before demo |
| Should the Lab overlay show YOLO boxes alongside colour detections, or colour only? | user | day 1 |
| Do the five domains need their own `Mission` entries in the Missions tab, or stay Lab-only? | user | day 1 |
| Is a captured session allowed as a demo artefact? | user | with organisers |

## Rollout / rollback

Additive: a new `FrameSource` interface with one new implementation, a new Lab sub-tab,
and five new data-only scenario files. `vision.ts`, `arm.ts`, `feetech.ts`, and
`kinematics.ts` are **not modified**. Rollback is deleting the new files and removing one
sub-tab entry. No migration, no data loss.

If the replay work is cut, the five domain scenarios still stand alone in Sim Lab as
methodology breadth — labelled honestly as simulation.

## Handoff summary

```
Requirements clarified: replay + 5 domains, Sim Lab kept as-is
Stack: unchanged — no new dependencies
Spec: this file, 19 acceptance criteria across R/P/S/D/E
Baseline to protect: tsc clean | 63 passed / 25 skipped | test:live 25/25 | build exit 0
Skills engaged: spec-adr-authoring, project-bootstrap
Risks accepted: replay is a recording not live hardware (labelled in UI);
  occupant detection out of scope; domain scenarios are illustrative not validated
Open: 4 questions above, all need a human decision
```