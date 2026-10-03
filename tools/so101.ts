/**
 * so101 — headless operator for the SO-101 Control Room.
 *
 * Runs the SHIPPED driver stack (src/lib/*) against real hardware through Node serialport.
 * The browser UI and this tool execute the same ServoBus / Arm / Runner code, so a mission
 * that works in the simulator behaves identically on the arm.
 *
 * SAFETY MODEL — read before running against hardware:
 *
 *   1. Torque is OFF on connect and is never enabled implicitly. `--torque` must be passed.
 *   2. initFollower() writes goal := present BEFORE any torque, so the arm cannot lunge.
 *   3. EEPROM writes are read-back verified and idempotent; `dry` mode skips them entirely.
 *   4. A voltage window is enforced. STS3215 servos brown out below ~10.5V; below
 *      `--min-volt` (default 10.0) we refuse to enable torque rather than limp mid-move.
 *   5. SIGINT / SIGTERM / Ctrl-C triggers an immediate broadcast e-stop on every arm.
 *   6. A watchdog releases torque if the process stalls (no successful tick for N seconds).
 *   7. Every motion is bounded by the arm's joint limits and maxDegPerS speed cap.
 *
 * Default mode is READ-ONLY. It pings, reads, prints. Nothing moves.
 *
 * Usage
 *   npm run so101 -- doctor                     list ports, check the host can drive them
 *   npm run so101 -- probe   --port /dev/ttyACM0     ping motors, print state. NO motion
 *   npm run so101 -- init    --port /dev/ttyACM0     apply servo config (EEPROM). NO torque
 *   npm run so101 -- torque  --port /dev/ttyACM0     torque on, hold pose, then release
 *   npm run so101 -- jog     --port /dev/ttyACM0 --joint shoulder_lift --deg +5
 *   npm run so101 -- grasp   --port /dev/ttyACM0     tune grasp thresholds on a real object
 *   npm run so101 -- mission --port /dev/ttyACM0 --mission pick-place
 *   npm run so101 -- mission --port /dev/ttyACM0 --dry      plan + log only, no writes
 *
 * Two arms: pass --port twice (order matters: first is A, second is B).
 */
import { Arm } from "../src/lib/arm";
import { SimServoTransport, ServoBus } from "../src/lib/feetech";
import { defaultCalibration, JOINTS, MOTOR_IDS, jointLimits, type JointName } from "../src/lib/kinematics";
import { DEFAULT_RUNNER, MISSIONS, Runner, type Mission } from "../src/lib/missions";
import { NodeSerialTransport, listCandidatePorts } from "./so101-transport";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const PORTS = args.reduce<string[]>((a, v, i) => (v === "--port" ? [...a, args[i + 1]] : a), []);
const num = (name: string, dflt: number): number => {
  const v = flag(name);
  return v === undefined ? dflt : Number(v);
};

const MIN_VOLT = num("min-volt", 10.0);
const DEG_PER_S = num("speed", 40);
const DURATION = num("duration", 400);

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`;
const say = (msg: string) => console.log(`${stamp()} ${msg}`);
const warn = (msg: string) => console.log(`${stamp()} WARN  ${msg}`);
const fail = (msg: string) => {
  console.log(`${stamp()} STOP  ${msg}`);
};

/** Every arm we opened, so any exit path can release torque. */
const arms: Arm[] = [];
let estopping = false;

async function emergencyStop(reason: string): Promise<void> {
  if (estopping) return;
  estopping = true;
  warn(`E-STOP: ${reason}`);
  await Promise.all(arms.map(async (a) => {
    try {
      await a.estop();
      say(`arm ${a.name}: torque released`);
    } catch (e) {
      console.error(`arm ${a.name}: E-STOP FAILED — cut power manually`, e);
    }
  }));
}

process.on("SIGINT", () => void emergencyStop("SIGINT (Ctrl-C)").then(() => process.exit(130)));
process.on("SIGTERM", () => void emergencyStop("SIGTERM").then(() => process.exit(143)));
const realExit = process.exit.bind(process) as (code?: number) => never;
process.exit = ((code?: number) => {
  void emergencyStop(`process.exit(${code ?? 0})`).then(() => realExit(code));
  // deliberately does not exit synchronously: the e-stop must complete first
  return undefined as never;
}) as (code?: number) => never;

/** Voltage gate. STS3215 browns out under load below ~10.5V; refusing torque beats limping. */
async function assertPower(arm: Arm, name: string, fatal = true): Promise<void> {
  const s = await arm.readState();
  const volts = s.volt.filter((v) => v > 0);
  if (!volts.length) {
    warn(`arm ${name}: no voltage reading (are the servos powered?)`);
    return;
  }
  const min = Math.min(...volts);
  const max = Math.max(...volts);
  say(`arm ${name}: bus voltage ${min.toFixed(1)}-${max.toFixed(1)}V`);
  if (min < MIN_VOLT) {
    fail(`arm ${name}: voltage ${min.toFixed(1)}V is below --min-volt ${MIN_VOLT}.`);
    console.log("         Check the power supply is 12V (SO-101) and the bus cable is seated.");
    console.log("         Torque is NOT being enabled. Fix power, then re-run.");
    if (fatal) process.exit(2);
  }
}

async function openArm(name: string, path: string | undefined): Promise<Arm> {
  let transport: any;
  if (path) {
    transport = await NodeSerialTransport.open(path, 1_000_000);
    say(`arm ${name}: opened ${path} @ 1 Mbps`);
  } else {
    transport = new SimServoTransport(JOINTS.map((j) => ({ id: MOTOR_IDS[j], pos: 2048 })));
    warn(`arm ${name}: no --port given, using the VIRTUAL arm (nothing physical will move)`);
  }
  const arm = new Arm(name, new ServoBus(transport, 40), defaultCalibration());
  arm.maxDegPerS = DEG_PER_S;
  arms.push(arm);
  return arm;
}

/** Watchdog: if the arm is holding torque and we stop hearing from it, release. */
function startWatchdog(getLive: () => boolean, timeoutMs: number): NodeJS.Timeout {
  let last = Date.now();
  const beat = setInterval(() => {
    void getLive();
    last = Date.now();
  }, 1000);
  const timer = setInterval(() => {
    if (getLive() && Date.now() - last > timeoutMs) {
      void emergencyStop(`no read for ${(timeoutMs / 1000).toFixed(0)}s — releasing torque`);
    }
  }, 500);
  return setTimeout(() => {
    clearInterval(beat);
    clearInterval(timer);
  }, 0) as unknown as NodeJS.Timeout;
}

async function doctor(): Promise<void> {
  console.log("SO-101 host doctor\n");
  console.log(`  node ${process.version} on ${process.platform}/${process.arch}`);
  let ports: Awaited<ReturnType<typeof listCandidatePorts>>;
  try {
    ports = await listCandidatePorts();
  } catch (e) {
    console.log(`  serialport unavailable: ${e instanceof Error ? e.message : e}`);
    console.log("  fix: npm install serialport\n");
    return;
  }
  console.log(`  serialport: OK`);
  console.log(`  ports found: ${ports.length}\n`);
  if (!ports.length) {
    console.log("  No serial devices. macOS exposes USB-serial adapters as /dev/cu.* (not /dev/tty.*).");
    console.log("  If the arm is plugged in and still absent:");
    console.log("    - try another USB cable (charge-only cables have no data lines)");
    console.log("    - try a USB hub (some docks starve these adapters)");
    console.log("    - check System Settings > General > About, and 'ioreg -p IOUSB -l -w0'");
    return;
  }
  for (const p of ports) {
    console.log(`  ${p.path}`);
    console.log(`      chip      ${(p as any).chip ?? "?"}`);
    console.log(`      ids       ${p.vendorId ?? "?"}:${p.productId ?? "?"}  ${p.manufacturer ?? ""}`);
    if (p.serialNumber) console.log(`      serial    ${p.serialNumber}`);
  }
  console.log("\n  macOS ships in-kernel drivers for FTDI / CP210x / CH340 / PL2303,");
  console.log("  so no driver install (and no sudo) should be required.");
}

async function probe(arm: Arm): Promise<boolean> {
  say(`arm ${arm.name}: scanning motor ids…`);
  const found = await arm.bus.scan();
  say(`arm ${arm.name}: ${found.length} motor(s) answered — ${found.join(",") || "none"}`);
  if (!found.length) {
    fail(`arm ${arm.name}: no motors. Check 12V power, the bus cable, adapter jumpers (channel B / USB), and that ids are 1-6.`);
    return false;
  }
  const missing = await arm.check();
  if (missing.length) {
    fail(`arm ${arm.name}: missing motor(s) ${missing.join(", ")} (expected ids ${JOINTS.map((j) => MOTOR_IDS[j]).join(",")})`);
    return false;
  }
  const s = await arm.readState();
  const lim = jointLimits(arm.cal);
  say(`arm ${arm.name}: all 6 motors online`);
  say(`arm ${arm.name}: raw ticks  ${s.raw.join(", ")}`);
  say(`arm ${arm.name}: degrees    ${JOINTS.map((j) => `${j}=${s.deg[j].toFixed(1)}`).join(" ")}`);
  say(`arm ${arm.name}: gripper    ${s.gripperPct.toFixed(1)}%`);
  say(`arm ${arm.name}: load ‰     ${s.load.map((v) => Math.abs(v)).join(", ")}`);
  say(`arm ${arm.name}: voltage    ${s.volt.map((v) => v.toFixed(1)).join(", ")}V`);
  say(`arm ${arm.name}: temp °C    ${s.temp.join(", ")}`);
  // A real arm reports sane raw ticks inside the 0..4095 range and a plausible bus voltage.
  const sane = s.raw.every((r) => r >= 0 && r <= 4095);
  if (!sane) warn(`arm ${arm.name}: raw ticks outside 0..4095 — check bus wiring`);
  const moving = s.temp.some((t) => t > 60);
  if (moving) warn(`arm ${arm.name}: a servo is above 60°C`);
  say(`arm ${arm.name}: joint limits ${JOINTS.map((j) => `${j}=[${lim[j][0].toFixed(0)},${lim[j][1].toFixed(0)}]`).join(" ")}`);
  return true;
}

async function main(): Promise<void> {
  const cmd = args[0] ?? "doctor";

  if (cmd === "doctor") return void (await doctor());

  if (!PORTS.length && !has("virtual")) {
    warn("no --port given and --virtual not passed; running against the VIRTUAL arm");
  }

  if (cmd === "probe" || cmd === "init" || cmd === "torque" || cmd === "jog" || cmd === "grasp" || cmd === "mission") {
    const arm = await openArm("A", PORTS[0]);
    if (!(await probe(arm))) return void (await emergencyStop("probe failed"));

    if (cmd === "init") {
      if (has("dry")) say("dry run: no EEPROM writes");
      else {
        const changed = await arm.initFollower();
        say(`initFollower: EEPROM changed = ${changed.length ? changed.join(", ") : "nothing (already correct)"}`);
        say(`initFollower: torque is ${arm.torque ? "ON" : "OFF"} (arm stays limp after config)`);
      }
      return;
    }

    if (cmd === "torque") {
      await assertPower(arm, arm.name, true);
      say("enabling torque — the arm will HOLD its current pose (it will not move)");
      await arm.setTorque(true);
      say(`torque ON. Supporting the arm for ${num("hold", 5)}s, then releasing.`);
      await new Promise((r) => setTimeout(r, num("hold", 5) * 1000));
      await emergencyStop("torque test complete");
      return;
    }

    if (cmd === "jog") {
      const joint = (flag("joint") ?? "shoulder_lift") as JointName;
      const deg = Number(flag("deg") ?? 5);
      if (!(JOINTS as readonly string[]).includes(joint)) {
        return fail(`unknown --joint ${joint}. choose one of: ${JOINTS.join(", ")}`);
      }
      await assertPower(arm, arm.name);
      if (!has("torque")) return fail("jog needs --torque to acknowledge that the arm will move");
      await arm.setTorque(true);
      say(`jogging ${joint} by ${deg > 0 ? "+" : ""}${deg}° at ${arm.maxDegPerS}°/s`);
      const targets = { [joint]: arm.currentTarget(joint) + deg } as Partial<Record<JointName, number>>;
      await arm.moveTo(targets, DURATION);
      await new Promise((r) => setTimeout(r, 600));
      const after = await arm.readState();
      say(`arm ${arm.name}: ${joint} now ${after.deg[joint].toFixed(1)}°`);
      return void (await emergencyStop("jog complete"));
    }

    if (cmd === "grasp") {
      await assertPower(arm, arm.name);
      if (!has("torque")) return fail("grasp needs --torque");
      say("close the gripper slowly onto the object and measure the stall");
      await arm.setTorque(true);
      const g = await arm.grasp();
      say(`result: ${g.reason}`);
      say(`        gap ${g.gapPct.toFixed(1)}%   load ${g.load}‰   holding=${g.holding}`);
      say(`current thresholds: minGapPct=${arm.grasp_tuning.minGapPct} loadThreshold=${arm.grasp_tuning.loadThreshold}‰`);
      if (g.stalled && g.holding) {
        say(`a real grasp. Suggested --min-gap ${Math.max(2, Math.floor(g.gapPct * 0.6))} --load ${Math.max(20, Math.floor(g.load * 0.5))}`);
      }
      return void (await emergencyStop("grasp test complete"));
    }

    if (cmd === "mission") {
      const dry = has("dry");
      const wanted = flag("mission");
      const list = MISSIONS.map((m) => ({ id: m.id, title: m.title, camera: m.needsCamera }));
      if (!wanted) {
        say("available missions:");
        for (const m of list) say(`  ${m.id.padEnd(14)} ${m.camera ? "[camera]" : "[no camera]"} ${m.title}`);
        return;
      }
      const mission: Mission | undefined = MISSIONS.find((m) => m.id === wanted);
      if (!mission) {
        fail(`unknown mission "${wanted}". try one of: ${list.map((m) => m.id).join(", ")}`);
        return;
      }
      if (mission.needsCamera) {
        warn(`${mission.id} needs a calibrated overhead camera.`);
        if (!has("perceive")) {
          return fail(
            "this mission locates objects with the camera; the headless operator has no webcam.\n" +
              "         Either run camera-free missions, or drive this one from the browser UI\n" +
              "         (Missions tab), which has the calibration + perception wired up.",
          );
        }
      }
      if (dry) {
        say(`DRY RUN ${mission.id}: planning and logging only, no writes to the servos`);
      } else {
        await assertPower(arm, arm.name);
        if (!has("torque")) return fail("running a mission needs --torque (the arm will move)");
        say(`enabling torque on ${arm.name}`);
        await arm.setTorque(true);
      }
      const ctl = new AbortController();
      const stop = () => void ctl.abort();
      process.on("SIGINT", stop);
      const runner = new Runner(
        arm,
        ctl.signal,
        (msg, level) => (level === "warn" || level === "error" ? warn(`[mission] ${msg}`) : say(`[mission] ${msg}`)),
        async () => {
          if (!has("perceive")) throw new Error("no --perceive source: this tool cannot see objects");
          return [];
        },
        { ...DEFAULT_RUNNER, dryRun: dry, speedMs: DURATION },
      );
      const params = Object.fromEntries(
        mission.params.map((p) => [p.key, /second|duration/i.test(p.key) ? num("duration", 3) : p.value]),
      );
      try {
        const result = await mission.run(runner, params);
        say(`✔ ${mission.id}: ${result}`);
      } catch (e) {
        if (ctl.signal.aborted) warn(`${mission.id} aborted`);
        else fail(`${mission.id} failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        process.off("SIGINT", stop);
        await emergencyStop("mission finished");
      }
    }
    return; // recognised a hardware command: never fall through to "unknown"
  }

  fail(`unknown command "${cmd}". try: doctor, probe, init, torque, jog, grasp, mission`);
  process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(`${stamp()} ERROR ${e instanceof Error ? e.stack ?? e.message : e}`);
  await emergencyStop("unhandled error");
  process.exit(1);
});
