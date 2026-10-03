# SO-101 Domain Operator

A domain-scoped robot operator built on Hugging Face **SO-101 / LeRobot** arms.

The pitch this implements: *we sell you a robot that performs the task you want,
in your domain, trained and working — instead of €10k+ of capital equipment.*

## What is here

| Piece | What it is |
|---|---|
| **Control deck** | Next.js app: live arm control, camera calibration with held-out validation, 25 missions, three.js Sim Lab with 31 use cases |
| **Headless operator** | `tools/so101.ts` — runs missions with no browser, safety interlocks baked in |
| **Phone-repair scene** | The anchor domain: parts-tray fetch in checklist order, with a verified ledger |
| **Five-domain showcase** | Sim Lab scenarios proving the methodology transfers: PCB kitting, lab samples, assistive handover, kiosk restocking |
| **Advisory vision** | `tools/yolo_watch.py` — YOLO11n on Apple Silicon, 78 fps, never touches the robot |
| **Advisory sensors** | `tools/atech_watch.py` — ESP32-S3 module bridge, cannot command a robot |

## The methodology

Every domain runs the identical five stages:

```
Script → Voice → Perception → Verification → Ledger
```

Only the nouns change. That is the whole claim, and it is what the five-domain
showcase exists to demonstrate.

### Verification is three-valued, on purpose

A ledger verdict is exactly one of `pass` / `fail` / `unknown`.

- `unknown` means **we did not check** — an input was unavailable.
- It is never rounded up to a pass, and never down to a failure.

Collapsing those two states is how a QA record stops being trustworthy, so
`summarise()` reports `complete: false` whenever anything is unknown.

## Quick start

```bash
npm install
npm run dev                      # http://localhost:3000

npm test                         # 72 passed / 25 skipped
npm run test:live                # 25/25 missions on the virtual arm
npx tsc --noEmit                 # clean
```

### Headless (no browser required)

```bash
npm run so101 -- doctor              # list serial ports + chip verdict
npm run so101 -- probe --port <dev>  # ping motors, no motion
npm run so101 -- mission --mission wave --dry
npm run so101 -- mission --mission phone-repair --port <dev> --torque
```

Torque is **never** implicit. `Ctrl-C` mid-motion routes to e-stop and releases.

### Optional side-channels

Both are advisory and both are skippable — the scene runs and produces a full
ledger with neither attached.

```bash
so101-yolo start                     # YOLO overlay, localhost:8766
so101-atech start /dev/cu.usbmodem…   # ESP32-S3 sensor bridge, localhost:8767
```

## Honest limits

Read these before trusting any claim:

- **Nothing here has run on a physical SO-101.** All tests are virtual-arm or pure
  function. Grasp thresholds are uncalibrated defaults.
- **Sim Lab does not drive hardware.** It is a three.js rig with its own IK. The
  live claim rests on the headless operator and the missions.
- **The perception path is colour thresholding + planar homography.** YOLO11n's COCO
  vocabulary contains no `capacitor`, `connector`, or `PCB` — and no `cube`. It is
  advisory only and never in the motion path.
- **No person detection.** The assistive scenario uses a taped handover mark.
- **The vision-replay work is scoped but not built.** See
  `docs/specs/2026-10-03-vision-replay-five-domains.md`.

## Docs

- `docs/specs/2026-10-03-phone-repair-scene.md` — implemented, 30 criteria
- `docs/specs/2026-10-03-vision-replay-five-domains.md` — scoped, not implemented
- `tools/README.md` — headless operator commands and interlocks

## Stack

Next.js + TypeScript + three.js (deck) · Feetech STS3215 over Web Serial / Node
serialport (control) · Python + ultralytics (advisory vision) · ESP32-S3 JSON-lines
(optional sensors)