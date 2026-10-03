"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRoom } from "./RoomProvider";
import { Badge, Btn, Card, Code } from "./ui";

const KEY = "so101-runbook-v1";

type Go = (tab: "connect" | "manual" | "vision" | "missions" | "models" | "guide" | "lab") => void;

interface Item {
  id: string;
  text: ReactNode;
  code?: string;
  tip?: string;
}
interface Phase {
  id: string;
  title: string;
  minutes: string;
  goal: string;
  items: Item[];
  go?: { tab: Parameters<Go>[0]; label: string };
}

const PHASES: Phase[] = [
  {
    id: "p0",
    title: "0 · Unbox, safety and tools",
    minutes: "10 min",
    goal: "Know what you have and make the first power-up safe.",
    items: [
      { id: "p0a", text: "Check the kit against the bill of materials (SO-ARM100 repo): 6 STS3215 servos per arm, bus-servo driver board (Waveshare / Feetech USB adapter), 3-pin cables, power supply, USB-C cable, table clamps, horns and screws (M2x6 and M3x6)." },
      { id: "p0b", text: "Read the label on each servo: 7.4 V servos run from the 5 V supply that ships with the kit; 12 V servos need the 12 V supply. Never connect the wrong supply: it destroys servos instantly.", tip: "Leader and follower can use different voltages. Keep each supply with its arm and label them." },
      { id: "p0c", text: "Two arms need TWO USB driver boards and two power supplies. Each board shows up as its own serial port. Label the boards \"follower\" and \"leader\" with tape now." },
      { id: "p0d", text: "Put a hardware switch (or a power strip you can reach instantly) on each arm's power supply. The in-app E-STOP only releases torque: a falling arm can still hit things, so support it." },
      { id: "p0e", text: "Tools: small Phillips screwdriver, side cutters / hobby knife to remove print supports, a marker to label servos, calipers or a ruler, masking tape." },
    ],
  },
  {
    id: "p1",
    title: "1 · Install the software",
    minutes: "15 min",
    goal: "Control Room running in desktop Chrome/Edge; LeRobot optional but useful.",
    go: { tab: "connect", label: "Open Connect & Calibrate" },
    items: [
      { id: "p1a", text: "Install Node 20+ and run the Control Room on the laptop the arm is plugged into (Web Serial only works on http://localhost or https, in desktop Chrome or Edge, not Firefox or Safari).", code: "npm install\nnpm run build && npm start\n# open http://localhost:3000" },
      { id: "p1b", text: "Install LeRobot (needed only for setting motor IDs, LeRobot's own calibration, recording datasets and running learned policies). Check the official installation guide for the Python version it currently requires.", code: "git clone https://github.com/huggingface/lerobot.git\ncd lerobot\npip install -e \".[feetech]\"" },
      { id: "p1c", text: "Linux: let your user open serial ports (log out and in afterwards). Windows: install the CH340/CH343 driver if no COM port appears when you plug in the board.", code: "sudo usermod -aG dialout $USER" },
      { id: "p1d", text: "Find each board's port. Run it once per arm and unplug that board's USB when asked.", code: "lerobot-find-port" },
    ],
  },
  {
    id: "p2",
    title: "2 · Set motor IDs (before assembling!)",
    minutes: "15 min per arm",
    goal: "Every servo has a unique ID 1-6 and 1 Mbps baud. Done once, stored in EEPROM.",
    items: [
      { id: "p2a", text: "Connect ONLY the board (USB + power) and ONE servo at a time. Waveshare boards: both jumpers on channel B (USB)." },
      { id: "p2b", text: "Run the follower script and follow the prompts. It asks for the gripper first, then wrist_roll, wrist_flex, elbow_flex, shoulder_lift, shoulder_pan. Write the ID on each servo with a marker as you go.", code: "lerobot-setup-motors --robot.type=so101_follower --robot.port=/dev/ttyACM0", tip: "ID map used by this app: 1 shoulder_pan, 2 shoulder_lift, 3 elbow_flex, 4 wrist_flex, 5 wrist_roll, 6 gripper." },
      { id: "p2c", text: "Leader arm (if you have one): the leader uses three different gear ratios (1/191 pan and elbow, 1/345 shoulder lift, 1/147 wrist and gripper). Pick the right servo for each joint before you set IDs.", code: "lerobot-setup-motors --teleop.type=so101_leader --teleop.port=/dev/ttyACM1" },
    ],
  },
  {
    id: "p3",
    title: "3 · Assemble the arm",
    minutes: "60-90 min per arm",
    goal: "A rigid arm with every horn centred and every cable free.",
    go: { tab: "lab", label: "Open the 3D exploded view & illustrated guide" },
    items: [
      { id: "p3a", text: "Remove all support material from the printed parts with a small screwdriver. Dry-fit each part first." },
      { id: "p3b", text: "Before you start, move each servo to the middle of its travel (about tick 2047) and seat horns so the arm's neutral pose is the middle of every joint. This matters because the calibration later asks you to hold the middle." },
      { id: "p3c", text: <span><b>Joint 1 (shoulder pan):</b> fit both horns (M3x6 on the top one, none on the bottom), seat motor 1 in the base with 4 x M2x6 (2 top, 2 bottom), slide on the motor holder (2 x M2x6), attach the shoulder part (4 x M3x6 top, 4 x M3x6 bottom), add the shoulder motor holder.</span> },
      { id: "p3d", text: <span><b>Joint 2 (shoulder lift):</b> horns on, slide motor 2 in from the top (4 x M2x6), attach the upper arm with 4 x M3x6 each side.</span> },
      { id: "p3e", text: <span><b>Joint 3 (elbow):</b> horns on, insert motor 3 (4 x M2x6), connect the forearm with 4 x M3x6 each side.</span> },
      { id: "p3f", text: <span><b>Joint 4 (wrist flex):</b> horns on, slide over motor holder 4, slide in motor 4 (4 x M2x6).</span> },
      { id: "p3g", text: <span><b>Joint 5 (wrist roll):</b> motor 5 into the wrist holder (2 x M2x6 front screws), ONE horn only with an M3x6 horn screw, secure the wrist to motor 4 with 4 x M3x6 on both sides.</span> },
      { id: "p3h", text: <span><b>Gripper (follower):</b> attach the gripper body to motor 5's horn (4 x M3x6), insert the gripper motor (2 x M2x6 each side), horns on (M3x6 top), fit the moving jaw (4 x M3x6 each side). Stick TPU or rubber pads on both jaws: bare PLA slips on smooth cubes.</span> },
      { id: "p3i", text: "Plug one 3-pin cable into each servo as you place it. Daisy-chain board → ID1 → ID2 → ID3 → ID4 → ID5 → ID6. Leave slack at moving joints and check no cable can pinch at the shoulder or elbow." },
      { id: "p3j", text: "Clamp the base to the table with two C-clamps and mark its footprint with tape. A base that slides invalidates every calibration." },
      { id: "p3k", text: "Tighten every horn screw. Gently move each joint through its range by hand with the power OFF: no scraping, no cable tension." },
    ],
  },
  {
    id: "p4",
    title: "4 · Smoke test (first power-up)",
    minutes: "10 min",
    goal: "All six motors answer, and you can move each joint a few degrees safely.",
    go: { tab: "connect", label: "Go to Connect" },
    items: [
      { id: "p4a", text: "Support the arm with one hand or rest it in a folded pose. Switch the power supply ON first, then plug in USB (USB alone only powers the board, not the servos)." },
      { id: "p4b", text: "Connect tab → Follower → Connect real arm (USB). Choose the arm's port in the browser dialog. Motors are NOT energised on connect." },
      { id: "p4c", text: "All six rows show a green dot, voltage 5-12 V as per your supply, temperature ~25-40 °C. If fewer answer, see Troubleshooting below." },
      { id: "p4d", text: "Press Torque ON while holding the arm: it holds its current pose and will not snap anywhere. Manual tab → joint sliders: move each joint 5-10° and confirm the physical joint moves the way the on-screen arm does." },
      { id: "p4e", text: "Press E-STOP once to prove it releases torque. Then Torque ON again." },
    ],
  },
  {
    id: "p5",
    title: "5 · Calibrate (so IK and missions are accurate)",
    minutes: "20 min",
    goal: "The app knows your joint ranges, the L-pose zero, rotation directions, table height and grasp strength.",
    go: { tab: "connect", label: "Open the calibration wizard" },
    items: [
      { id: "p5a", text: "Homing (optional): only if the ticks wrap around 0/4095 in your pose, or you have not run lerobot-calibrate. Arm in the MIDDLE of every joint, torque OFF. This invalidates the other steps, so do it first." },
      { id: "p5b", text: "Range of motion: Start recording, move EVERY joint slowly through its full travel by hand (torque off), then Save. Do not force the joint against the end stop." },
      { id: "p5c", text: "Gripper: record the closed and the fully open positions." },
      { id: "p5d", text: "L-pose reference: hold the arm with the upper arm vertical, the forearm pointing straight forward, the gripper pointing forward and the pan facing straight ahead, then capture. This defines the zero the kinematics use. Missions are blocked on the real arm until it is done." },
      { id: "p5e", text: "Direction check: jog each joint + and - with torque on. Tick 'confirm' only if the real arm moved the way the diagram says (pan + = counter-clockwise from above, lift + = leans forward, wrist + = tips the gripper down). If one is reversed, flip its sign in the wizard." },
      { id: "p5f", text: "Link lengths: measure with calipers if your parts differ (defaults: upper arm 11.6 cm, forearm 13.5 cm, tool 10 cm, shoulder height 11 cm)." },
      { id: "p5g", text: "Touch table: lower the fingertip until it just touches the table and store that as table height. Fit the pen first if you will use the plotter missions." },
      { id: "p5h", text: "Tune grasp: put the real object between the jaws and run Tune grasp. It measures the stall gap and load for that object. The defaults (gap 8 %, load 90 ‰) are untuned." },
    ],
  },
  {
    id: "p6",
    title: "6 · Camera (only for camera missions)",
    minutes: "15 min",
    goal: "Pixel clicks on the camera image convert to robot centimetres within about 1 cm.",
    go: { tab: "vision", label: "Open Vision" },
    items: [
      { id: "p6a", text: "Mount a USB webcam rigidly above the table (lamp arm or tripod) so it sees the whole reachable area. Fix the focus and exposure. Steady, even lighting. Do not move it afterwards." },
      { id: "p6b", text: "Vision tab → webcam on. Place the fingertip on a table spot, click that spot in the image and enter its X/Y in cm (robot frame: X forward from the base axis, Y to the left). Do at least 4 FIT marks spread across the table." },
      { id: "p6c", text: "Add 2-3 PROBE marks (extra spots NOT used for the fit). The error shown is measured on these held-out points, so it is honest. Aim for under about 0.8 cm; add more marks if it is worse." },
      { id: "p6d", text: "Objects: distinct saturated colours on a plain table work out of the box. For dark or white objects use 'sample colour' (click the object) or switch to background subtraction (capture the empty table first)." },
    ],
  },
  {
    id: "p7",
    title: "7 · Run missions (scripted) and drive manually",
    minutes: "5 min",
    goal: "Select a mission and the arm does it by itself; take over manually any time.",
    go: { tab: "missions", label: "Open Missions" },
    items: [
      { id: "p7a", text: "First run, ALWAYS: low Move time cap, hand on the power switch, area clear. Start with a no-camera mission (Greeter wave, Button Presser), then Pick & Place, then Hanoi." },
      { id: "p7b", text: "Missions tab: click a mission (or type an instruction such as \"stack 3 blocks\"). With Auto-run on, a countdown starts (minimum 3 s on the real arm; Cancel or Start now). Torque is enabled automatically and the mission runs. Pre-flight blockers (uncalibrated, camera not ready) are listed and stop the run." },
      { id: "p7c", text: "Read the 'Set-up before you run' box of each mission: where blocks, pen, keypad or the Hanoi marks must be. Use Dry run to see targets without moving." },
      { id: "p7d", text: "Tower of Hanoi: tape three marks at X=16 cm, Y=-7, 0, +7 cm, stack three 3 cm blocks on the Y=-7 mark, press Run. It solves in 7 moves and ends with the stack on Y=+7." },
      { id: "p7e", text: "Manual tab: joint sliders, Cartesian jog (arrow keys, W/S, O/C) and leader-follower teleop. Manual controls lock while a mission runs (E-STOP and Stop always work)." },
      { id: "p7f", text: "Learned policies (Models tab) run through the LeRobot bridge: disconnect the arm in the browser first, because only one program can own a serial port." },
    ],
  },
];

const TROUBLE: [string, string][] = [
  ["No serial port in the browser dialog", "Use desktop Chrome/Edge on localhost. Check the USB cable carries data (not charge-only). Windows: install the CH340/CH343 driver. Linux: join the dialout group."],
  ["\"No motors answered at 1 Mbps\"", "Power supply off or wrong; USB plugged into the wrong board; IDs not set (run lerobot-setup-motors); Waveshare jumpers not on channel B; another program (LeRobot, a second tab) holds the port."],
  ["Only some motors answer", "A loose 3-pin cable in the chain: the first motor that does not answer is after the break. Re-seat that cable. Two servos with the same ID also cause this."],
  ["A joint moves the wrong way", "Direction check in the calibration wizard: flip that joint's sign. Then redo the L-pose reference."],
  ["Arm sags or jitters when torque is on", "Power supply too weak (arm brownout) or wrong voltage. Use the supply that came with the kit; do not share it between two arms."],
  ["Gripper never detects an object", "Run Tune grasp with the actual object. Add rubber pads. Lower the Hover/Grab heights if the jaws close above the object."],
  ["Picks land 1-2 cm off", "Add more FIT marks and probe marks in Vision; redo Touch table; make sure the camera did not move; check link lengths."],
  ["Motor shows hot (> 60 °C)", "Stop and let it rest. Lower the speed cap. The shoulder-lift and elbow carry the most load."],
  ["\"Unreachable or outside joint limits\"", "The target is outside the arm's 25 cm reach or the calibrated ranges. Move the object or the mission coordinates closer to the base."],
];

function useChecks() {
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(done));
    } catch {
      /* quota */
    }
  }, [done]);
  return [done, setDone] as const;
}

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={ok ? "text-emerald-400" : "text-slate-600"}>{ok ? "●" : "○"}</span>
      <span className={ok ? "text-slate-200" : "text-slate-400"}>
        {label}
        {!ok && hint && <span className="block text-xs text-amber-300/80">{hint}</span>}
      </span>
    </li>
  );
}

export function RunbookTab({ go }: { go: Go }) {
  const { follower, leader, fState, data, report } = useRoom();
  const [done, setDone] = useChecks();
  const real = follower?.kind === "serial";
  const online = fState ? fState.online.filter(Boolean).length : 0;
  const cal = data.calFollower;
  const total = PHASES.reduce((n, p) => n + p.items.length, 0);
  const count = PHASES.reduce((n, p) => n + p.items.filter((i) => done[i.id]).length, 0);
  const gripperTuned = !(data.grasp.minGapPct === 8 && data.grasp.loadThreshold === 90);
  const camOk = report.status === "ok" || report.status === "warn" || (report.status === "unvalidated" && data.acceptUnvalidated);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card title="Hackathon runbook: from box to missions" right={<Badge tone={count === total ? "green" : "cyan"}>{count}/{total} done</Badge>}>
          <p className="text-sm text-slate-300">
            Follow the phases in order. Each phase has a goal, exact steps and a button that opens the matching tab. Ticks are saved in this browser. The panel on the right reads the <i>live</i> state of your arm, so it
            shows what is really ready instead of what you ticked.
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-cyan-500 transition-all" style={{ width: `${(count / total) * 100}%` }} /></div>
        </Card>

        {PHASES.map((p) => {
          const n = p.items.filter((i) => done[i.id]).length;
          return (
            <Card key={p.id} title={p.title} right={<div className="flex items-center gap-2"><Badge>{p.minutes}</Badge><Badge tone={n === p.items.length ? "green" : "slate"}>{n}/{p.items.length}</Badge></div>}>
              <p className="mb-3 text-xs italic text-violet-300">Goal: {p.goal}</p>
              <ul className="space-y-3">
                {p.items.map((it) => (
                  <li key={it.id} className="flex gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-cyan-400" checked={!!done[it.id]} onChange={(e) => setDone({ ...done, [it.id]: e.target.checked })} aria-label="done" />
                    <div className={`min-w-0 flex-1 text-sm ${done[it.id] ? "text-slate-500" : "text-slate-300"}`}>
                      <div>{it.text}</div>
                      {it.code && <div className="mt-2"><Code>{it.code}</Code></div>}
                      {it.tip && <p className="mt-2 rounded bg-slate-950 p-2 text-xs text-amber-200">💡 {it.tip}</p>}
                    </div>
                  </li>
                ))}
              </ul>
              {p.go && <div className="mt-3"><Btn small kind="primary" onClick={() => go(p.go!.tab)}>{p.go.label} →</Btn></div>}
            </Card>
          );
        })}

        <Card title="Troubleshooting">
          <dl className="space-y-3 text-sm">
            {TROUBLE.map(([q, a]) => (
              <div key={q}><dt className="font-medium text-slate-100">{q}</dt><dd className="text-xs text-slate-400">{a}</dd></div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="sticky top-16 space-y-4">
          <Card title="Live readiness (from the actual arm)">
            <ul className="space-y-2">
              <Check ok={typeof navigator !== "undefined" && "serial" in navigator} label="Web Serial available (Chrome / Edge)" hint="Open this page in desktop Chrome or Edge on localhost." />
              <Check ok={!!follower} label={follower ? `Follower connected (${real ? "real" : "virtual"})` : "Follower connected"} hint="Connect tab → Connect real arm." />
              <Check ok={online === 6} label={`All 6 motors answering (${online}/6)`} hint="Check power, cables and IDs." />
              <Check ok={!!fState?.torque} label="Torque on (missions enable it automatically)" />
              <Check ok={cal.referenceCaptured} label="L-pose reference captured" hint="Calibration step: L-pose." />
              <Check ok={cal.directionsConfirmed} label="Joint directions confirmed" hint="Calibration step: direction check." />
              <Check ok={data.tableZ !== 0} label="Table height set" hint="Calibration step: Touch table." />
              <Check ok={gripperTuned} label="Grasp tuned on a real object" hint="Calibration step: Tune grasp." />
              <Check ok={camOk} label={`Camera calibrated (${report.status})`} hint="Vision tab: 4+ FIT marks and 2-3 PROBE marks. Only needed for camera missions." />
              <Check ok={!!leader} label="Leader arm connected (optional)" />
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn small onClick={() => go("connect")}>Connect</Btn>
              <Btn small onClick={() => go("missions")}>Missions</Btn>
            </div>
          </Card>
          <Card title="Two arms at the hackathon">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
              <li><b className="text-slate-200">Follower + leader</b>: plug both boards in; connect one as Follower and one as Leader; Manual → Teleop. The follower mirrors the leader, and you can record demos for training.</li>
              <li><b className="text-slate-200">Two independent followers</b>: one session drives one follower (plus an optional leader). Calibration is stored per browser profile, so run the second arm in a separate Chrome profile (or on a second laptop) with its own calibration. Do not open two tabs of the same profile.</li>
              <li>Never share one power supply between two arms.</li>
            </ul>
          </Card>
          <Card title="Honest limits">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
              <li>Not yet run on a physical SO-101 by the authors: first run with a low speed cap, E-STOP in reach.</li>
              <li>Single table plane for vision; objects are assumed to lie on the table.</li>
              <li>Camera needs good lighting; dark objects need background subtraction or sampled colours.</li>
              <li>Grasp thresholds must be tuned per object.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
