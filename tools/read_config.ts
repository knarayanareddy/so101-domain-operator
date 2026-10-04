/**
 * read_config.ts — READ-ONLY. Reports what is already configured on each servo.
 *
 * Writes nothing. Torque is never touched. This exists so we can answer one
 * question before `init`: is this arm already configured, or would init change
 * values a sponsor shipped?
 *
 *   node --experimental-strip-types tools/read_config.ts <port>
 */
import { Arm } from "../src/lib/arm";
import { MOTOR_IDS, JOINTS, defaultCalibration } from "../src/lib/kinematics";
import { ServoBus } from "../src/lib/feetech";
import { NodeSerialTransport } from "./so101-transport";

const REG = {
  LOCK: 55,
  OPERATING_MODE: 33,
  RETURN_DELAY: 34,
  P_COEF: 41,
  I_COEF: 42,
  D_COEF: 43,
  MAX_TORQUE_LIMIT: 38,
  PROTECTION_CURRENT: 28,
  OVERLOAD_TORQUE: 41,
  HOMING_OFFSET: 31,
};

const WANT = [
  ["Return_Delay_Time", REG.RETURN_DELAY, 1, 0],
  ["Operating_Mode", REG.OPERATING_MODE, 1, 0],
  ["P_Coefficient", REG.P_COEF, 1, 16],
  ["I_Coefficient", REG.I_COEF, 1, 0],
  ["D_Coefficient", REG.D_COEF, 1, 32],
  ["Max_Torque_Limit", REG.MAX_TORQUE_LIMIT, 2, 500],
  ["Protection_Current", REG.PROTECTION_CURRENT, 2, 250],
  ["Overload_Torque", REG.OVERLOAD_TORQUE, 1, 25],
  ["Homing_Offset", REG.HOMING_OFFSET, 2, null],
] as const;

const port = process.argv[2];
if (!port) {
  console.error("usage: read_config.ts <port>");
  process.exit(2);
}

const transport = await NodeSerialTransport.open(port, 1_000_000);
const bus = new ServoBus(transport);
const arm = new Arm("A", bus, defaultCalibration());
try {
  const s = await arm.readState();
  console.log(`\nREAD-ONLY config dump — ${port}`);
  console.log(`torque is ${arm.torque ? "ON" : "OFF"} (untouched)\n`);

  let diffs = 0;
  for (const j of JOINTS) {
    const id = MOTOR_IDS[j];
    const grip = j === "gripper";
    const rows: string[] = [];
    for (const [name, addr, bytes, want] of WANT) {
      if (grip === false && (name === "Max_Torque_Limit" || name === "Protection_Current" || name === "Overload_Torque")) {
        continue;
      }
      let have: number;
      try {
        have = bytes === 1 ? await arm.bus.read8(id, addr) : await arm.bus.read16(id, addr);
      } catch (e) {
        rows.push(`  ${name.padEnd(20)} READ FAILED: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (want === null) {
        rows.push(`  ${name.padEnd(20)} = ${have}`);
      } else {
        const ok = have === want;
        if (!ok) diffs++;
        rows.push(`  ${name.padEnd(20)} = ${String(have).padStart(5)}   want ${String(want).padStart(5)}  ${ok ? "ok" : "DIFFERS"}`);
      }
    }
    console.log(`${j} (id ${id})`);
    console.log(rows.join("\n"));
  }
  console.log(`\n${diffs} register(s) differ from the values init would write.`);
  console.log(diffs === 0 ? "Arm is already configured; init would be a no-op." : "init would change these.");
  console.log(`raw ticks: ${s.raw.join(", ")}`);
  process.exitCode = 0;
} catch (e) {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  // Arm has no disconnect(); close the transport we opened.
  try {
    (transport as unknown as { close?: () => void }).close?.();
  } catch {
    /* already closed */
  }
}