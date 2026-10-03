"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showcaseItems, SHOWCASE_SCRIPT } from "@/playground/scenarios/showcase";
import { CONTROL_PANEL_NOTE, type PickTarget } from "@/playground/scenarios/individpick";
import {
  resolvePick,
  examplePhrases,
  type PickCommand,
} from "@/playground/scenarios/pick-command";
import { requestPick, clearPick } from "@/playground/scenarios/single-pick";

/**
 * Floating voice dock — a draggable command window pinned above Sim Lab.
 *
 * Why floating: an operator watching the 3D view should be able to say "fetch the
 * resistor" without leaving the view, and without the command UI stealing space
 * from the canvas. It mounts once in LabTab so it survives sub-tab switches.
 *
 * Two rules keep it honest:
 *  - It only ever *requests* motion. `requestPick()` is the same channel the
 *    control panel uses; nothing here writes to a serial port.
 *  - Unresolvable speech returns `unknown` with candidates. It never guesses a
 *    part, because picking the wrong one is worse than asking.
 *
 * Keyboard: hold `V` (or Spacebar) to talk. Release sends. Escape closes.
 */
export default function VoiceDock() {
  const catalogue = useMemo(() => showcaseItems() as PickTarget[], []);
  const phrases = useMemo(() => examplePhrases(catalogue), [catalogue]);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [text, setText] = useState("");
  const [cmd, setCmd] = useState<PickCommand | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "listening" | "working" | "speaking">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [narrate, setNarrate] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const heldKey = useRef(false);

  const push = useCallback((line: string) => {
    setLog((l) => [line, ...l].slice(0, 4));
  }, []);

  /** Narrate via local TTS. Advisory only — a voice failure must never block motion. */
  const say = useCallback(
    async (t: string) => {
      if (!narrate || !t) return;
      setStatus("speaking");
      try {
        await fetch("/api/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: t }),
        });
      } catch {
        /* narration is optional */
      } finally {
        setStatus("idle");
      }
    },
    [narrate],
  );

  const run = useCallback(
    (raw: string) => {
      const u = raw.trim();
      if (!u) return;
      const c = resolvePick(u, catalogue);
      setCmd(c);
      setHeard(u);

      if (c.action === "pick" || c.action === "place") {
        const [sid, pid] = (c.targetId ?? "").split(":");
        if (sid && pid) {
          requestPick(pid, c.action);
          const dom = catalogue.find((i) => i.id === c.targetId)?.domain ?? sid;
          push(`→ ${c.action} ${c.label} (${dom})`);
          void say(`Fetching ${c.label}.`);
        }
      } else if (c.action === "sequence") {
        push(`→ ${SHOWCASE_SCRIPT.length} domains, live first`);
        void say("Running the full work order.");
      } else {
        push(`? ${c.reason}`);
        void say("I could not tell which part you meant.");
      }
    },
    [catalogue, push, say],
  );

  /** Local STT. Returns text only — the route has no actuation path. */
  const listen = useCallback(async () => {
    setStatus("listening");
    try {
      const res = await fetch("/api/voice", { method: "POST" });
      const data = (await res.json()) as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.text) {
        setText(data.text);
        run(data.text);
      } else {
        push("? heard nothing");
      }
    } catch (e) {
      push(`? voice failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setStatus("idle");
    }
  }, [run, push]);

  /* ---- push-to-talk on V or Space ---- */
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape" && open) {
        setOpen(false);
        return;
      }
      if (isTyping(e.target)) return;
      if (k === "v" || k === " ") {
        e.preventDefault();
        heldKey.current = true;
        setOpen(true);
        void listen();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "v" || k === " ") heldKey.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [listen, open]);

  /* ---- dragging ---- */
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragRef.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy)),
      });
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  // default to bottom-right on first open
  useEffect(() => {
    if (open && pos === null) {
      setPos({ x: Math.max(8, window.innerWidth - 380), y: Math.max(8, window.innerHeight - 300) });
    }
  }, [open, pos]);

  const onHeaderDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    dragRef.current = { dx: e.clientX - (pos?.x ?? 0), dy: e.clientY - (pos?.y ?? 0) };
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Voice command (V)"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-2xl text-slate-900 shadow-lg hover:bg-amber-400"
      >
        🎤
      </button>
    );
  }

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 16, bottom: 16 };

  return (
    <div
      style={{ ...style, position: "fixed", zIndex: 60, width: collapsed ? 260 : 340 }}
      className="rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur"
    >
      <div
        onMouseDown={onHeaderDown}
        className="flex cursor-grab items-center gap-2 border-b border-slate-800 px-3 py-2 active:cursor-grabbing"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            status === "listening"
              ? "animate-pulse bg-rose-500"
              : status === "working"
                ? "bg-amber-400"
                : status === "speaking"
                  ? "bg-emerald-400"
                  : "bg-slate-600"
          }`}
          aria-hidden
        />
        <span className="text-xs font-semibold text-slate-200">Voice command</span>
        <span className="ml-auto flex gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
            className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-800"
          >
            {collapsed ? "▣" : "▁"}
          </button>
          <button
            onClick={() => {
              clearPick();
              push("⏹ hold");
            }}
            title="Stop and hold"
            className="rounded px-1.5 text-xs text-rose-300 hover:bg-rose-950/60"
          >
            ⏹
          </button>
          <button
            onClick={() => setNarrate((n) => !n)}
            title={narrate ? "Narration on" : "Narration off"}
            className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-800"
          >
            {narrate ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Close"
            className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-800"
          >
            ✕
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="space-y-2 p-3">
          <p className="text-[11px] text-slate-500">
            Hold <kbd className="rounded bg-slate-800 px-1">V</kbd> or{" "}
            <kbd className="rounded bg-slate-800 px-1">space</kbd> to talk ·{" "}
            <kbd className="rounded bg-slate-800 px-1">esc</kbd> to close
          </p>

          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run(text);
                e.stopPropagation();
              }}
              placeholder="pick up the resistor"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
            />
            <button
              onClick={listen}
              disabled={status === "listening"}
              title="Listen"
              className="rounded border border-slate-700 px-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              {status === "listening" ? "🎙️" : "🎤"}
            </button>
          </div>

          {cmd && (
            <div
              className={`rounded px-2 py-1.5 text-[11px] ${
                cmd.action === "unknown"
                  ? "bg-amber-500/10 text-amber-300"
                  : "bg-emerald-500/10 text-emerald-300"
              }`}
            >
              <strong>{cmd.action}</strong> — {cmd.reason}
              {cmd.candidates.length > 0 && (
                <div className="mt-0.5 text-slate-400">did you mean: {cmd.candidates.join(", ")}?</div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {phrases.slice(0, 4).map((p: string) => (
              <button
                key={p}
                onClick={() => {
                  setText(p);
                  run(p);
                }}
                className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-amber-500 hover:text-amber-300"
              >
                {p}
              </button>
            ))}
          </div>

          {log.length > 0 && (
            <ul className="space-y-0.5 border-t border-slate-800 pt-1.5 text-[10px] text-slate-500">
              {log.map((l, i) => (
                <li key={i} className="truncate">
                  {l}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Re-exported for the panel, which shares the same resolver and channel. */
export const VOICE_DOCK_NOTE = CONTROL_PANEL_NOTE;