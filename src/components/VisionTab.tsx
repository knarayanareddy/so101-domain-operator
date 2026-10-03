"use client";

import { useEffect, useRef, useState } from "react";
import { simProject } from "@/lib/sim";
import { applyH, ACCURACY_TARGET_CM, type Detection, type Mark } from "@/lib/vision";
import { useRoom } from "./RoomProvider";
import { Badge, Btn, Card, Num } from "./ui";

type ClickMode = "fit" | "probe" | "sample" | "test";

export function VisionTab() {
  const { cameraMode, setCameraMode, grabFrame, data, update, report, perceive, hasBackground, captureBackground, sampleColor, follower, fState, log } = useRoom();
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<ClickMode>("fit");
  const [world, setWorld] = useState({ x: 16, y: 0 });
  const [dets, setDets] = useState<Detection[]>([]);
  const [err, setErr] = useState("");
  const [label, setLabel] = useState("my object");
  const [test, setTest] = useState<{ px: { x: number; y: number }; world: { x: number; y: number } } | null>(null);
  const marksRef = useRef(data.marks);
  marksRef.current = data.marks;
  const detsRef = useRef(dets);
  detsRef.current = dets;
  const testRef = useRef(test);
  const detectorModeRef = useRef(data.detectMode === "detector");
  detectorModeRef.current = data.detectMode === "detector";
  testRef.current = test;

  useEffect(() => {
    const id = setInterval(() => {
      const c = cv.current;
      const f = grabFrame();
      if (!c || !f) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0);
      ctx.lineWidth = 2;
      ctx.font = "12px sans-serif";
      for (const m of marksRef.current) {
        ctx.strokeStyle = m.role === "fit" ? "#22d3ee" : "#fbbf24";
        ctx.beginPath();
        ctx.arc(m.px.x, m.px.y, 7, 0, Math.PI * 2);
        ctx.moveTo(m.px.x - 11, m.px.y);
        ctx.lineTo(m.px.x + 11, m.px.y);
        ctx.moveTo(m.px.x, m.px.y - 11);
        ctx.lineTo(m.px.x, m.px.y + 11);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(`${m.world.x},${m.world.y}`, m.px.x + 9, m.px.y - 9);
      }
      // Colour/diff detections are solid green and calibrated. Detector detections
      // are dashed cyan with a "?" — they are open-vocabulary proposals with no
      // confidence score, and must not read as confirmed the way a colour blob does.
      const fromDetector = marksRef.current.length > 0 && detectorModeRef.current;
      for (const d of detsRef.current) {
        const [x0, y0, x1, y1] = d.bbox;
        const w = x1 - x0;
        const h = y1 - y0;
        if (fromDetector) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = "#22d3ee";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, w, h);
          ctx.restore();
          // crosshair at the centroid: that is the point the arm would target
          ctx.strokeStyle = "#22d3ee";
          ctx.beginPath();
          ctx.moveTo(d.px.x - 6, d.px.y);
          ctx.lineTo(d.px.x + 6, d.px.y);
          ctx.moveTo(d.px.x, d.px.y - 6);
          ctx.lineTo(d.px.x, d.px.y + 6);
          ctx.stroke();
          ctx.fillStyle = "#22d3ee";
          ctx.font = "bold 12px sans-serif";
          ctx.fillText(`? ${d.label}`, x0, Math.max(12, y0 - 4));
          ctx.font = "11px sans-serif";
          ctx.fillText(
            d.world ? `${d.world.x.toFixed(1)}, ${d.world.y.toFixed(1)} cm` : "uncalibrated",
            x0,
            Math.max(24, y0 - 18),
          );
        } else {
          ctx.strokeStyle = "#a3e635";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, w, h);
          ctx.fillStyle = "#a3e635";
          ctx.fillText(`${d.label}${d.world ? ` (${d.world.x.toFixed(1)}, ${d.world.y.toFixed(1)})` : ""}`, x0, y0 - 4);
        }
      }
      const t = testRef.current;
      if (t) {
        ctx.strokeStyle = "#f472b6";
        ctx.beginPath();
        ctx.arc(t.px.x, t.px.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }, 120);
    return () => clearInterval(id);
  }, [grabFrame]);

  useEffect(() => {
    const id = setInterval(() => {
      perceive().then(
        (d) => {
          setDets(d);
          setErr("");
        },
        (e) => {
          setDets([]);
          setErr(e instanceof Error ? e.message : String(e));
        },
      );
    }, 700);
    return () => clearInterval(id);
  }, [perceive]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = { x: ((e.clientX - r.left) / r.width) * 640, y: ((e.clientY - r.top) / r.height) * 480 };
    if (mode === "fit" || mode === "probe") {
      const m: Mark = { id: `${mode}-${Date.now()}`, px, world: { ...world }, role: mode };
      update({ marks: [...data.marks, m] });
    } else if (mode === "sample") {
      const rgb = sampleColor(px);
      if (rgb) {
        update({ palette: [...data.palette.filter((p) => p.label !== label), { label, rgb, tol: 45 }] });
        log(`Sampled colour for "${label}": rgb(${rgb.join(",")})`, "ok");
      }
    } else if (report.H) {
      setTest({ px, world: applyH(report.H, px) });
    }
  };

  const fillFromTip = () => {
    const t = follower?.arm.tip(fState);
    if (t) setWorld({ x: Number(t.tip[0].toFixed(1)), y: Number(t.tip[1].toFixed(1)) });
  };

  const autoCalSim = () => {
    const pts: [number, number, "fit" | "probe"][] = [[12, -10, "fit"], [12, 10, "fit"], [24, -10, "fit"], [24, 10, "fit"], [18, 0, "fit"], [15, 5, "fit"], [14, -3, "probe"], [21, 4, "probe"], [19, -7, "probe"]];
    const n = () => (Math.random() * 2 - 1) * 1.5;
    update({
      marks: pts.map(([x, y, role], i) => {
        const p = simProject(x, y);
        return { id: `sim-${i}`, px: { x: p.u + n(), y: p.v + n() }, world: { x, y }, role };
      }),
    });
    log("Virtual camera calibrated with 6 fit + 3 probe marks (±1.5 px click noise)", "ok");
  };

  const tone = report.status === "ok" ? "green" : report.status === "warn" ? "amber" : report.status === "unvalidated" ? "amber" : "red";

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-3 xl:col-span-2">
        <Card
          title="Camera"
          right={
            <div className="flex items-center gap-2">
              <Btn small kind={cameraMode === "sim" ? "primary" : "ghost"} onClick={() => setCameraMode("sim")}>Virtual camera</Btn>
              <Btn small kind={cameraMode === "webcam" ? "primary" : "ghost"} onClick={() => setCameraMode("webcam")}>USB webcam</Btn>
            </div>
          }
        >
          <canvas ref={cv} width={640} height={480} onClick={onClick} className="w-full cursor-crosshair rounded-lg border border-slate-700 bg-black" />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Click action:</span>
            {([["fit", "Add FIT mark"], ["probe", "Add PROBE mark"], ["sample", "Sample colour"], ["test", "Test point"]] as const).map(([k, t]) => (
              <Btn key={k} small kind={mode === k ? "primary" : "ghost"} onClick={() => setMode(k)}>{t}</Btn>
            ))}
          </div>
          {(mode === "fit" || mode === "probe") && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 p-3">
              <Num label="World X (cm)" step={0.1} value={world.x} onChange={(x) => setWorld({ ...world, x })} />
              <Num label="World Y (cm)" step={0.1} value={world.y} onChange={(y) => setWorld({ ...world, y })} />
              <Btn small disabled={!follower} onClick={fillFromTip} title="Place the fingertip on the mark, then press">Use fingertip position</Btn>
              <p className="basis-full text-xs text-slate-500">
                1) Touch the gripper tip to a mark on the table (or type its measured coordinates). 2) Press “Use fingertip position”. 3) Click that same spot in the image. Repeat for ≥4 FIT marks spread over the whole working area, then add 2–3 PROBE marks at <i>other</i> spots to measure the true error.
              </p>
            </div>
          )}
          {mode === "sample" && (
            <div className="mt-3 flex items-end gap-2 text-xs text-slate-400">
              <label className="flex flex-col gap-1">Label for the clicked object
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100" />
              </label>
              <span>Click on an object. Works for black/dark objects too (sampled colour).</span>
            </div>
          )}
          {mode === "test" && test && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="font-mono text-pink-300">→ ({test.world.x.toFixed(1)}, {test.world.y.toFixed(1)}) cm</span>
              <Btn small disabled={!follower || !fState?.torque} onClick={() => follower?.arm.moveTip([test.world.x, test.world.y, 5], { ms: 1500 }).catch((e) => log(String(e), "error"))}>Hover the fingertip here (verify physically)</Btn>
            </div>
          )}
          {err && <p className="mt-2 text-xs text-amber-300">{err}</p>}
        </Card>
      </div>

      <div className="space-y-3">
        <Card title="Calibration accuracy" right={<Badge tone={tone}>{report.status.toUpperCase()}</Badge>}>
          <p className="text-sm text-slate-300">{report.message}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-slate-950 p-2">
              <div className="text-slate-500">Held-out error ({report.heldOut?.method ?? "n/a"})</div>
              {report.heldOut ? (
                <div className="font-mono text-slate-200">median {report.heldOut.median.toFixed(2)} · p90 {report.heldOut.p90.toFixed(2)} · max {report.heldOut.max.toFixed(2)} cm</div>
              ) : (
                <div className="font-mono text-amber-300">unknown</div>
              )}
            </div>
            <div className="rounded bg-slate-950 p-2 opacity-70">
              <div className="text-slate-500">In-sample fit (NOT accuracy)</div>
              <div className="font-mono text-slate-400">{report.inSampleRmse === null ? "-" : `${report.inSampleRmse.toFixed(3)} cm`}</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Target: median ≤ {ACCURACY_TARGET_CM} cm on spots the fit has never seen. The in-sample number is ~0 by construction, so it is never used for pass/fail.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn small onClick={autoCalSim} disabled={cameraMode !== "sim"}>Auto-calibrate virtual camera</Btn>
            <Btn small onClick={() => update({ marks: [] })}>Clear marks</Btn>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={data.acceptUnvalidated} onChange={(e) => update({ acceptUnvalidated: e.target.checked })} />Allow missions with an unvalidated calibration (not recommended)</label>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
            {data.marks.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded border border-slate-800 px-2 py-1">
                <span><Badge tone={m.role === "fit" ? "cyan" : "amber"}>{m.role}</Badge> <span className="font-mono text-slate-400">({m.world.x}, {m.world.y}) ← ({m.px.x.toFixed(0)}, {m.px.y.toFixed(0)})</span></span>
                <span className="flex gap-1">
                  <Btn small onClick={() => update({ marks: data.marks.map((x) => (x.id === m.id ? { ...x, role: x.role === "fit" ? "probe" : "fit" } : x)) })}>↔</Btn>
                  <Btn small onClick={() => update({ marks: data.marks.filter((x) => x.id !== m.id) })}>✕</Btn>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Detection">
          <div className="flex gap-2 text-xs">
            <Btn small kind={data.detectMode === "color" ? "primary" : "ghost"} onClick={() => update({ detectMode: "color" })}>Colour palette</Btn>
            <Btn small kind={data.detectMode === "diff" ? "primary" : "ghost"} onClick={() => update({ detectMode: "diff" })}>Background subtraction</Btn>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {data.detectMode === "color"
              ? "Matches sampled colours: add any colour (even black) with “Sample colour”. Needs steady lighting and objects unlike the table."
              : "Compares against an empty-table reference frame: colour independent, so dark objects on a dark table work. Do not move the camera after capturing."}
          </p>
          {data.detectMode === "diff" && (
            <div className="mt-2 flex items-center gap-2">
              <Btn small onClick={captureBackground}>Capture empty table</Btn>
              <Badge tone={hasBackground ? "green" : "amber"}>{hasBackground ? "reference set" : "missing"}</Badge>
              <Num label="Threshold" value={data.diffThresh} onChange={(v) => update({ diffThresh: v })} />
            </div>
          )}
          <div className="mt-2"><Num label="Min blob area (px²)" value={data.minArea} step={50} w="w-24" onChange={(v) => update({ minArea: v })} /></div>
          <ul className="mt-2 space-y-1 text-xs">
            {data.palette.map((p) => (
              <li key={p.label} className="flex items-center gap-2">
                <span className="h-4 w-4 rounded border border-slate-600" style={{ background: `rgb(${p.rgb.join(",")})` }} />
                <span className="flex-1">{p.label}</span>
                <input type="number" value={p.tol} className="w-14 rounded border border-slate-700 bg-slate-950 px-1 text-slate-200" onChange={(e) => update({ palette: data.palette.map((x) => (x.label === p.label ? { ...x, tol: Number(e.target.value) } : x)) })} />
                <Btn small onClick={() => update({ palette: data.palette.filter((x) => x.label !== p.label) })}>✕</Btn>
              </li>
            ))}
          </ul>

      {/* ---- Open-vocabulary detector (advisory) ---- */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-slate-200">
            <input
              type="checkbox"
              className="mr-2 accent-lime-400"
              checked={data.detectMode === "detector"}
              onChange={(e) => update({ detectMode: e.target.checked ? "detector" : "color" })}
            />
            Open-vocabulary detector (Florence-2)
          </label>
          <span
            className={`rounded px-2 py-0.5 text-[10px] ${
              data.detector.ready ? "bg-lime-500/20 text-lime-300" : "bg-slate-700 text-slate-400"
            }`}
          >
            {data.detector.ready ? "ready" : "offline"}
          </span>
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          Names the parts actually on your bench. Comma-separated &mdash; the server runs one pass
          per label, because Florence-2 collapses a multi-label prompt to a single box.
        </p>

        <input
          value={data.detectorPrompt}
          onChange={(e) => update({ detectorPrompt: e.target.value })}
          placeholder="a resistor, a capacitor, a phone screen"
          className="mt-1.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-lime-500 focus:outline-none"
        />

        {data.detector.error && (
          <p className="mt-1.5 text-[11px] text-amber-400">
            Detector unavailable: {data.detector.error}. Showing colour detection instead &mdash; no
            boxes are invented.
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-slate-500">
          {data.detector.lastMs != null && <span>{data.detector.lastMs}ms</span>}
          {data.detector.dropped > 0 && (
            <span className="text-amber-400">{data.detector.dropped} dropped as implausible</span>
          )}
          {data.detector.labels.length > 0 && <span>asked: {data.detector.labels.join(", ")}</span>}
        </div>

        <p className="mt-2 border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-500">
          <b className="text-slate-400">Advisory.</b> Florence-2 returns the label you asked for
          whether or not the object exists, and emits no confidence score &mdash; so a box is not
          proof the part is there. Targets outside the arm&apos;s reach are dropped, and motion still
          requires the motor stall check.
        </p>
      </div>
          <div className="mt-2 text-xs text-slate-400">{dets.length} detection(s): {dets.map((d) => d.label).join(", ") || "none"}</div>
        </Card>
      </div>
    </div>
  );
}
