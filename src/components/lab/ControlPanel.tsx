"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { showcaseItems, SHOWCASE_SCRIPT } from "@/playground/scenarios/showcase";
import { CONTROL_PANEL_NOTE, type PickTarget } from "@/playground/scenarios/individpick";
import { resolvePick, examplePhrases, type PickCommand } from "@/playground/scenarios/pick-command";

const Loading = () => <p className="p-6 text-sm text-slate-500">Loading 3D engine…</p>;
const Playground = dynamic(() => import("./Playground"), { ssr: false, loading: Loading });

type Mode = "sequence" | "individual";

/**
 * Control panel — pick a single item, or run a whole work order.
 *
 * Two modes over one catalogue. The item list is derived from the scenarios
 * themselves (`showcaseItems()`), so a part can never be offered here unless a
 * scenario actually places it and it is inside the arm's reach envelope.
 *
 * The 3D view is the same Playground the Sim Lab uses, so what an operator
 * selects here is literally the scene they watch.
 */
export default function ControlPanel() {
  const items = useMemo(() => showcaseItems(), []);
  const [mode, setMode] = useState<Mode>("individual");
  const [selected, setSelected] = useState<string>(items[0]?.id ?? "");
  const [scenario, setScenario] = useState(items[0]?.scenario ?? "");
  const [busy, setBusy] = useState(false);

  // Group by domain so the picker reads like a work order, not a flat dump.
  const byDomain = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const it of items) {
      const list = m.get(it.domain) ?? [];
      list.push(it);
      m.set(it.domain, list);
    }
    return [...m.entries()];
  }, [items]);

  const current = items.find((i) => i.id === selected);

  // --- natural-language / voice command ---
  const [utterance, setUtterance] = useState("");
  const [cmd, setCmd] = useState<PickCommand | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [narrate, setNarrate] = useState(true);
  const [spoken, setSpoken] = useState<string | null>(null);

  /** Narrate via local TTS. Advisory: a failure must never block motion, so it
   *  updates the last-spoken indicator and nothing else. */
  const say = async (text: string) => {
    if (!narrate || !text) return;
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as { ok?: boolean };
      setSpoken(data.ok ? text : null);
    } catch {
      setSpoken(null);
    }
  };

  const catalogue = useMemo(() => items as PickTarget[], [items]);
  const phrases = useMemo(() => examplePhrases(catalogue), [catalogue]);

  const submit = (text: string) => {
    const u = text.trim();
    if (!u) return;
    const c = resolvePick(u, catalogue);
    setUtterance(u);
    setCmd(c);
    if (c.action === "pick" || c.action === "place") {
      if (c.targetId) {
        setSelected(c.targetId);
        setScenario(c.targetId.split(":")[0]);
      }
      void say(`Fetching ${c.label}.`);
    } else if (c.action === "sequence") {
      void say("Running the full work order.");
    } else {
      void say("I could not tell which part you meant.");
    }
  };

  // Voice capture goes through the local STT service; it never drives the arm
  // directly, it only fills the same text box a typed request would.
  const listen = async () => {
    setListening(true);
    setHeard(null);
    try {
      const res = await fetch("/api/voice", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.text) {
        setHeard(data.text);
        submit(data.text);
      }
    } catch (e) {
      setHeard(e instanceof Error ? `voice failed: ${e.message}` : "voice failed");
    } finally {
      setListening(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Control panel</h2>
          <p className="text-sm text-slate-400">{CONTROL_PANEL_NOTE}</p>
        </div>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-sm">
          {(["individual", "sequence"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 ${mode === m ? "bg-amber-500 text-slate-900 font-semibold" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {m === "individual" ? "Pick one item" : "Run work order"}
            </button>
          ))}
        </div>
      </header>

      {mode === "sequence" ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Demo script</h3>
          <ol className="space-y-2">
            {SHOWCASE_SCRIPT.map((s, i) => (
              <li key={s.domain} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                    s.live ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/50 text-slate-400"
                  }`}
                >
                  {s.live ? "LIVE ARM" : "SIM"}
                </span>
                <span className="text-slate-200">{s.domain}</span>
                <span className="text-slate-500">· {s.duration_s}s</span>
                <span className="flex-1 text-slate-400">{s.says}</span>
                <span className="text-slate-600">{i + 1}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-slate-500">
            Only the first segment runs on a physical SO-101. The rest are Sim Lab scenarios and say so.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <label htmlFor="nl-command" className="text-xs uppercase tracking-wide text-slate-500">
                Tell it what to pick up
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="nl-command"
                  value={utterance}
                  onChange={(e) => setUtterance(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit(utterance)}
                  placeholder="pick up the resistor"
                  className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={() => submit(utterance)}
                  className="rounded bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
                >
                  Resolve
                </button>
                <button
                  onClick={listen}
                  disabled={listening}
                  title="Speak a command (local STT, offline)"
                  className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  {listening ? "🎙️ …" : "🎤"}
                </button>
                <button
                  onClick={() => setNarrate((n) => !n)}
                  title={narrate ? "Narration on" : "Narration off"}
                  className={`rounded border px-3 py-2 text-sm ${
                    narrate
                      ? "border-emerald-600 text-emerald-300"
                      : "border-slate-700 text-slate-500"
                  }`}
                >
                  {narrate ? "🔊 on" : "🔇 off"}
                </button>
              </div>

              {cmd && (
                <div
                  className={`mt-2 rounded px-3 py-2 text-xs ${
                    cmd.action === "unknown"
                      ? "bg-amber-500/10 text-amber-300"
                      : "bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  <strong>{cmd.action}</strong> — {cmd.reason}
                  {cmd.candidates.length > 0 && (
                    <div className="mt-1 text-slate-400">
                      Did you mean: {cmd.candidates.join(", ")}?
                    </div>
                  )}
                </div>
              )}
              {heard && <p className="mt-1 text-xs text-slate-500">heard: "{heard}"</p>}
              {spoken && <p className="mt-1 text-xs text-emerald-500/80">narrated: "{spoken}"</p>}

              <div className="mt-2 flex flex-wrap gap-1">
                {phrases.map((p) => (
                  <button
                    key={p}
                    onClick={() => submit(p)}
                    className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:border-amber-500 hover:text-amber-300"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 max-h-[52vh] overflow-auto">
            {byDomain.map(([domain, list]) => (
              <div key={domain} className="mb-4 last:mb-0">
                <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">{domain}</h3>
                <ul className="space-y-1">
                  {list.map((it) => (
                    <li key={it.id}>
                      <button
                        onClick={() => {
                          setSelected(it.id);
                          setScenario(it.scenario);
                        }}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                          selected === it.id
                            ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                            : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: it.label.includes("board") ? "#1d5c3a" : undefined }}
                          aria-hidden
                        />
                        <span className="flex-1">{it.label}</span>
                        <span className="text-[11px] text-slate-500">arm {it.arm.toUpperCase()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm">
              {current ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-slate-100 font-medium">Target: {current.label}</span>
                  <span className="text-slate-500">
                    {current.scenario} · x {current.pos[0].toFixed(0)} cm, z {current.pos[2].toFixed(0)} cm
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      // The Playground reads the request via the scenario program;
                      // this only reflects that a request is in flight.
                      void say(`Fetching ${current.label}.`);
                      setTimeout(() => setBusy(false), 1200);
                    }}
                    className="ml-auto rounded bg-amber-500 px-3 py-1.5 font-semibold text-slate-900 disabled:opacity-50"
                  >
                    {busy ? "Fetching…" : "Fetch this item"}
                  </button>
                </div>
              ) : (
                <span className="text-slate-500">Select an item.</span>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-800">
              <Playground key={scenario} initial={scenario} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}