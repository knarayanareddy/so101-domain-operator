# Headless operator (`tools/so101.ts`)

The browser UI is not required to run missions. This tool drives the **same** shipped code
(`src/lib/feetech.ts`, `kinematics.ts`, `arm.ts`, `missions.ts`) against real hardware through
Node `serialport` instead of Web Serial.

Both transports satisfy the same 4-method seam in `src/lib/feetech.ts`:

```ts
interface Transport {
  write(data: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<number[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
```

`src/lib/serial.ts` implements it with Web Serial. `tools/so101-transport.ts` implements it with
`serialport`. Nothing below the transport is different — a mission behaves identically.

The driver stack has no DOM dependencies (no `window` / `document` / `localStorage`), which is
what makes headless operation possible at all.

## Setup

```bash
npm install          # adds serialport
npm run typecheck
```

## First contact — read-only, moves nothing

```bash
npm run so101 -- doctor                  # is this Mac able to drive the adapter?
npm run so101 -- probe --port /dev/cu.usbserial-FT1ABCD
```

`doctor` lists every serial device with the chip it uses and a verdict. On macOS the port name
starts with `/dev/cu.` (not `/dev/tty.` — that is the blocking-style device).

## Bring-up sequence

Each step is independently safe. Torque stays off until you pass `--torque`.

```bash
P=/dev/cu.usbserial-FT1ABCD      # from `doctor`

npm run so101 -- probe  --port $P              # ping ids, print state. no motion
npm run so101 -- init   --port $P              # apply servo config. EEPROM, no torque
npm run so101 -- torque --port $P --torque     # hold current pose 5s, then release
npm run so101 -- jog    --port $P --torque --joint shoulder_lift --deg 5 --speed 25
npm run so101 -- grasp  --port $P --torque     # measure stall, print suggested thresholds
npm run so101 -- mission --port $P --mission wave --dry     # plan only, no writes
npm run so101 -- mission --port $P --mission wave --torque  # actually move
```

`--speed` is degrees/second (default 40). Start low (15–25) for the first powered run.

### Calibrating before missions

Two steps still need a human, because they need eyes and a ruler:

1. **L-pose reference** — pose the arm in the L-shape and capture it (Connect & Calibrate tab,
   or `arm.captureReference()`).
2. **Camera → table homography** — tap 4–6 marks, enter their cm positions, solve.

After that, `gripGap` / `gripLoad` should be tuned from a real object using `grasp`, not left at
defaults.

## Safety interlocks

Enforced in code, not by convention:

| Interlock | Behaviour |
|---|---|
| Torque never implicit | `--torque` is required for any motion. `probe` / `init` / `--dry` never enable it. |
| No lunge | `initFollower()` writes goal := present **before** torque. `setTorque(true)` re-writes it every time. |
| EEPROM safety | Writes are read-back verified, unlock→write→relock, and idempotent (a second connect writes nothing). Throws if a value will not stick. |
| Voltage gate | Refuses to enable torque below `--min-volt` (default 10.0V). STS3215 browns out under load near 10.5V. |
| E-stop | `SIGINT` / `SIGTERM` / `process.exit` all route through a broadcast e-stop on every arm. Verified: Ctrl-C mid-mission → `E-STOP: SIGINT` → `torque released`. |
| Bounded motion | Every target clamped to calibrated joint limits; speed capped at `--speed`. |
| Bus integrity | RX buffer bounded at 8 KB so a wedged bus cannot grow memory without limit. |

If the tool ever needs to stop, **Ctrl-C is always safe**, and cutting power is always safe.

## Two arms

Pass `--port` twice; first is A, second is B.

```bash
npm run so101 -- mission --port $A --port $B --mission hanoi --torque
```

Two arms require two independent USB adapters. Bus ids 1–6 collide otherwise.

## Camera-dependent missions

Missions flagged `[camera]` locate objects with the overhead webcam, which is a browser API. The
headless tool has no webcam, so it refuses them with a clear message rather than reaching into
empty air:

```
STOP  this mission locates objects with the camera; the headless operator has no webcam.
```

Run those from the browser **Missions** tab, which has calibration and perception wired up.
Camera-free missions (`wave`, `draw`, `signature`, `button`, `lightswitch`, `keypad`, `phone-tap`,
`pour`, `pet-teaser`, `page-turn`, `hanoi`) work headless.

## What was verified, and what was not

**Verified here:** typecheck clean; `doctor` runs on this Mac; `probe` reaches all 6 virtual motors
and prints state; `init` / `torque` / `jog` / `grasp` / `mission` paths execute; dry-run planning
produces correct motion plans; `--torque` refusal works; camera-mission refusal works;
SIGINT → e-stop → torque released mid-mission.

**Not verified:** anything against a physical SO-101. No arm was attached while this tool was
written. Motor-side behaviour — real stall loads, EEPROM lock behaviour on actual servos, bus
timing at 1 Mbps — is unproven. Treat the first powered run as a supervised bring-up.
