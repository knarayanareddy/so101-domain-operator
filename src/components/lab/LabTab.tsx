"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

/**
 * "Sim Lab": the three.js playground, exploded 3D view and illustrated build guide that
 * used to live in the separate so-101-robot-assembly-and-simulation project.
 *
 * Everything here is client-only (WebGL) and completely independent of the control stack:
 * it never touches the serial port, the Arm driver or persisted calibration, so it cannot
 * interfere with a connected robot. Each sub-view is code-split and mounted only while visible
 * so its WebGL context and animation loop are released when you leave it.
 */
const Loading = () => <p className="p-6 text-sm text-slate-500">Loading 3D engine…</p>;
const Overview = dynamic(() => import("./Overview"), { ssr: false, loading: Loading });
const ExplodedView = dynamic(() => import("./ExplodedView"), { ssr: false, loading: Loading });
const BuildGuide = dynamic(() => import("./BuildGuide"), { ssr: false, loading: Loading });
const Playground = dynamic(() => import("./Playground"), { ssr: false, loading: Loading });
const ControlPanel = dynamic(() => import("./ControlPanel"), { ssr: false, loading: Loading });
const VoiceDock = dynamic(() => import("./VoiceDock"), { ssr: false, loading: () => null });

type Sub = "playground" | "panel" | "exploded" | "build" | "overview";

const SUBS: { id: Sub; label: string; icon: string }[] = [
  { id: "playground", label: "Simulation playground", icon: "🕹️" },
  { id: "panel", label: "Control panel", icon: "🎛️" },
  { id: "exploded", label: "Exploded 3D view", icon: "🔩" },
  { id: "build", label: "Illustrated build guide", icon: "🛠️" },
  { id: "overview", label: "Scenario catalogue", icon: "🏠" },
];

export function LabTab() {
  const [sub, setSub] = useState<Sub>("playground");
  const [scenario, setScenario] = useState<string | undefined>(undefined);
  const [buildStep, setBuildStep] = useState(0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
        <b className="text-slate-200">Sim Lab</b> is a stand-alone 3D simulator: it rehearses behaviours visually and does{" "}
        <b>not</b> move a connected arm. To drive the real arm (or the virtual one that runs the real driver), use{" "}
        <b>Missions</b> and <b>Manual</b>.
      </div>
      <nav className="flex flex-wrap gap-1">
        {SUBS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${sub === s.id ? "bg-amber-400 text-slate-900" : "text-slate-300 hover:bg-white/10"}`}
          >
            <span className="mr-1.5">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </nav>
      {/* Floating voice dock: mounted once here so it stays put and reachable
          from every sub-tab, including the 3D playground. */}
      <VoiceDock />
      <div className="-mx-4 rounded-lg">
        {sub === "playground" && <Playground key={scenario ?? "default"} initial={scenario} />}
        {sub === "panel" && <ControlPanel />}
        {sub === "exploded" && (
          <ExplodedView
            onGoBuild={(step) => {
              setBuildStep(step);
              setSub("build");
            }}
          />
        )}
        {sub === "build" && <BuildGuide initialStep={buildStep} />}
        {sub === "overview" && (
          <Overview
            go={(t, s) => {
              if (s) setScenario(s);
              setSub(t);
            }}
          />
        )}
      </div>
    </div>
  );
}
