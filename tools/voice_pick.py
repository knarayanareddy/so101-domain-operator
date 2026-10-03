#!/usr/bin/env python3
"""
voice-pick — speak a part name, get a resolved pick command.

STT and TTS both run locally on Apple Silicon (mlx-whisper / kokoro), so this works
offline. It does NOT drive the arm: it resolves speech to a pick command and prints
JSON. The browser (or the headless operator) executes it. Same separation rule as
atech_watch.py and yolo_watch.py — advisory, no actuation path here.

Why a separate process: the browser owns Web Serial and the camera. A Python
process must not contend for either. This one only touches the microphone.

Run:
    voice-pick --list "resistor,capacitor,battery,board,screen"
    voice-pick --text "pick up the resistor"
    voice-pick --record 4 --list "resistor,capacitor"
    voice-pick --selftest
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys

STT = shutil.which("voice-transcribe")
TTS = shutil.which("voice-speak")


def run(cmd: list[str], timeout: int) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except Exception as e:  # noqa
        return 1, f"{type(e).__name__}: {e}"


def transcribe(seconds: int, model: str, from_file: str | None) -> dict:
    """Run local STT. Returns {ok, text, error} — never raises."""
    if not STT:
        return {"ok": False, "error": "voice-transcribe not on PATH"}
    cmd = [STT, "--model", model]
    if from_file:
        cmd.append(from_file)
    else:
        cmd += ["--record", str(seconds)]
    rc, out = run(cmd, timeout=600)
    # BUG FIXED 2026-10-03: this took the LAST line of stdout, which is the
    # huggingface download progress bar on a cold cache, not the transcript. The
    # pipeline appeared to work while returning "Fetching 4 files: 100%...".
    # Take the last line that is not a progress bar / download artefact.
    lines = [l.strip() for l in out.strip().splitlines() if l.strip()]
    transcript = ""
    for line in reversed(lines):
        low = line.lower()
        if any(m in low for m in (
            "fetching", "it/s]", "b/s]", "files:", "|", "warning:", "error:",
            "huggingface", "repository not found", "invalid username",
        )):
            continue
        transcript = line
        break
    if rc != 0 or not transcript:
        return {"ok": False,
                "error": (lines[-1] if lines else "no speech")[:200]}
    return {"ok": True, "text": transcript}


def speak(text: str, mode: str = "kokoro") -> dict:
    """Run local TTS. Advisory: a TTS failure must not fail the command."""
    if not TTS:
        return {"ok": False, "error": "voice-speak not on PATH"}
    rc, out = run([TTS, "--mode", mode, "--no-play", text], timeout=180)
    return {"ok": rc == 0, "error": None if rc == 0 else out.strip()[-200:]}


def selftest() -> int:
    """Exercise the plumbing without a microphone."""
    print("[selftest] binaries:", "STT" if STT else "STT MISSING",
          "|", "TTS" if TTS else "TTS MISSING")
    if not STT or not TTS:
        print("[selftest] FAIL — required binaries missing")
        return 1

    print("[selftest] TTS round trip (no microphone needed)")
    tmp = "/tmp/voice_pick_selftest.wav"
    rc, out = run([TTS, "--mode", "kokoro", "-o", tmp, "--no-play",
                   "Resistor capacitor."], timeout=300)
    print(f"  tts rc={rc} {out.strip()[:120]}")
    if rc != 0 or not __import__("os").path.isfile(tmp):
        print("  tts produced no file — FAIL")
        return 1

    r = transcribe(0, "base", tmp)
    print(f"  stt -> {r}")
    if not r["ok"]:
        print("  stt failed — FAIL")
        return 1
    # Guard the exact bug this script already had once: a progress bar parsed as
    # a transcript would sail through an ok/no-ok check.
    t = r["text"].lower()
    for bad in ("fetching", "it/s]", "files:", "warning", "huggingface", "|"):
        if bad in t:
            print(f"  transcript looks like tooling output, not speech: {r['text'][:120]}")
            print("  stt returned a non-transcript — FAIL")
            return 1
    if len(t) < 3:
        print("  transcript too short to be speech — FAIL")
        return 1

    payload = {
        "action": "pick",
        "speech": r["text"],
        "catalogue": ["resistor", "capacitor", "battery", "logic board", "screen"],
        "source": "selftest",
    }
    print("[selftest] emitting:", json.dumps(payload))
    print("[selftest] PASS — voice pipeline can produce a pick command offline")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--record", type=int, default=0, help="record N seconds from mic")
    ap.add_argument("--text", help="skip STT, use this text")
    ap.add_argument("--file", help="transcribe this audio file instead of the mic")
    ap.add_argument("--model", default="base", choices=["tiny", "base", "small", "medium", "turbo"])
    ap.add_argument("--list", help="comma-separated item names the operator can ask for")
    ap.add_argument("--speak", action="store_true", help="speak the resolved command back")
    ap.add_argument("--json", action="store_true", help="machine-readable output only")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    catalogue = [s.strip() for s in (args.list or "").split(",") if s.strip()]

    if args.text:
        heard = args.text
    else:
        r = transcribe(args.record or 5, args.model, args.file)
        if not r["ok"]:
            if args.json:
                print(json.dumps({"ok": False, "error": r["error"]}))
            else:
                print(f"[voice-pick] STT failed: {r['error']}", file=sys.stderr)
            return 1
        heard = r["text"]

    payload = {
        "ok": True,
        "speech": heard,
        "catalogue": catalogue,
        "action": "pick" if catalogue else "unknown",
        "source": "text" if args.text else ("file" if args.file else "microphone"),
    }

    if args.speak:
        spoken = speak(f"Fetching {catalogue[0]}." if catalogue else heard)
        payload["tts"] = spoken

    print(json.dumps(payload) if args.json else
          f'heard: "{heard}"\naction: {payload["action"]}\ncatalogue: {", ".join(catalogue) or "(none)"}')
    return 0


if __name__ == "__main__":
    sys.exit(main())