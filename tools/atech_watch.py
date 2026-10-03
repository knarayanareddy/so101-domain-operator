#!/usr/bin/env python3
"""
atech_watch — advisory sensor bridge for Atech ESP32-S3 module boards.

WHAT THIS IS
    Reads the board's JSON-lines serial stream and republishes the events we care
    about over localhost HTTP, so other processes (or the browser deck) can consume
    them without opening the serial port themselves.

WHY A SEPARATE PROCESS
    The browser holds Web Serial exclusively, and the headless arm operator holds the
    SO-101 bus. One process owning one port each avoids the whole class of "who has
    the serial port" bugs. This process owns the Atech board and nothing else.

    Nothing here can move a robot. There is no actuation path to the arms.

PROTOCOL (from atech.dev/docs, read 2026-10-03)
    USB: 115200 baud, one JSON object per line, newline-terminated both ways.
      board -> us:  {"type": "event", "payload": {"type":"sensor","key":"distance","value":1250,"module_type":"vl53l5cx"}}
      us -> board:  {"action": "set_color", "value": {"r":255,"g":0,"b":0}}
    WiFi: wss://gateway.atech.dev/ws/live/<PROJECT_ID>  -- NOT implemented; it needs
      the cloud relay and a project id, which is a bad dependency for an offline demo.

    IMPORTANT: the Load Cell module is sold on atech.dev/buy but is NOT in their
    published module reference, so its payload is unknown. If you have one, log the
    raw lines with --verbose and add its key here. Do not assume a payload.

FAIL-SOFT
    Any serial or parse error degrades to "no data" plus a last_error string. It never
    raises into the HTTP server, because a dead sensor must not look like a crash.

Run:
    python atech_watch.py --port /dev/cu.usbmodemXXXX     # real board
    python atech_watch.py --selftest                      # no hardware at all
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Keys we care about, from the published module reference.
WATCHED = {
    "distance": "tray occupancy (vl53l5cx, mm)",
    "min_distance": "nearest zone (vl53l5cx, mm)",
    "button_1": "technician step-confirm press",
    "button_2": "technician step-confirm press",
    "orientation": "object orientation state (icm40608)",
    "tilt": "object tilt degrees (icm40608)",
    "shake": "edge-triggered tap >1.8g (icm40608)",
    "temperature": "ambient temperature (aht20/scd40)",
    "humidity": "ambient humidity (aht20/scd40)",
}
# Only these may be sent back to the board. Whitelist, not blacklist.
ALLOWED_ACTIONS = {
    "set_color", "brightness", "clear", "set_pixel", "set_pixel_xy",
    "set_row", "set_column", "display_text", "draw_text", "clear_screen",
    "play_tone", "speaker_stop",
}

STATE = {
    "connected": False,
    "port": None,
    "last_error": None,
    "last_event": None,
    "seen_at": None,
    "lines": 0,
    "unknown_keys": {},          # key -> count, so we can discover undocumented modules
    "latest": {},                # watched key -> most recent value
    "history": deque(maxlen=200),
    "started": time.time(),
}
_lock = threading.Lock()


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def handle_line(line: str, verbose: bool = False) -> dict | None:
    """Parse one JSON line. Returns the inner payload, or None. Never raises."""
    line = line.strip()
    if not line:
        return None
    try:
        msg = json.loads(line)
    except Exception:  # noqa
        if verbose:
            log(f"  (non-JSON): {line[:120]}")
        return None

    # USB wrapper: {"type":"event","payload":{...}}; some firmware emits the payload bare.
    payload = msg.get("payload") if isinstance(msg, dict) else None
    if payload is None and isinstance(msg, dict) and "key" in msg:
        payload = msg
    if not isinstance(payload, dict):
        return None

    key = payload.get("key")
    if not key:
        return None
    with _lock:
        STATE["lines"] += 1
        STATE["seen_at"] = time.time()
        STATE["last_event"] = payload
        STATE["latest"][key] = payload.get("value")
        STATE["history"].append({"t": time.time(), "key": key, "value": payload.get("value"),
                                 "module": payload.get("module_type")})
        if key not in WATCHED:
            STATE["unknown_keys"][key] = STATE["unknown_keys"].get(key, 0) + 1
    if verbose:
        log(f"  {payload.get('module_type')}:{key} = {payload.get('value')}")
    return payload


def serial_loop(path: str, verbose: bool) -> None:
    """Own the serial port for the lifetime of the process."""
    try:
        import serial  # pyserial
    except ImportError:
        log("pyserial not installed. On macOS: pip install pyserial")
        with _lock:
            STATE["last_error"] = "pyserial missing"
        return

    port = None
    backoff = 1.0
    while True:
        try:
            if port is None:
                port = serial.Serial(path, 115200, timeout=0.2)
                with _lock:
                    STATE["port"] = path
                    STATE["connected"] = True
                    STATE["last_error"] = None
                log(f"opened {path} @ 115200")
            raw = port.readline()
            if raw:
                handle_line(raw.decode("utf-8", "replace"), verbose)
                backoff = 1.0
        except Exception as e:  # noqa
            with _lock:
                STATE["connected"] = False
                STATE["last_error"] = f"{type(e).__name__}: {e}"
            log(f"serial error: {type(e).__name__}: {e} — retrying in {backoff:.0f}s")
            try:
                if port:
                    port.close()
            except Exception:  # noqa
                pass
            port = None
            time.sleep(backoff)
            backoff = min(backoff * 2, 15.0)


# --------------------------------------------------------------------------
def selftest() -> int:
    """Prove parsing, filtering and the action whitelist with zero hardware."""
    log("selftest: parsing board -> us")
    board_lines = [
        '{"type": "event", "payload": {"type": "sensor", "key": "distance", "value": 1250, "module_type": "vl53l5cx"}}',
        '{"type": "event", "payload": {"type": "sensor", "key": "min_distance", "value": 450, "module_type": "vl53l5cx"}}',
        '{"type": "event", "payload": {"type": "button", "key": "button_1", "value": 1}}',
        '{"type": "event", "payload": {"type": "sensor", "key": "orientation", "value": "face_up", "module_type": "icm40608"}}',
        '{"type": "event", "payload": {"type": "sensor", "key": "some_future_module", "value": 42}}',
        '{"type": "event", "payload": {"type": "sensor", "key": "load_cell", "value": 4.2}}',
    ]
    for l in board_lines:
        p = handle_line(l, verbose=False)
        assert p is not None, f"failed to parse: {l}"
    with _lock:
        assert STATE["latest"]["distance"] == 1250, STATE["latest"]
        assert STATE["latest"]["button_1"] == 1
        assert STATE["lines"] == len(board_lines), STATE["lines"]
        unknown = dict(STATE["unknown_keys"])
    log(f"selftest: parsed {len(board_lines)} lines, latest={list(STATE['latest'])}")
    log(f"selftest: undocumented keys discovered -> {unknown}")
    assert "some_future_module" in unknown and "load_cell" in unknown, "unknown-key tracking failed"
    log("selftest: unknown modules are surfaced, not silently dropped  (this is how the")
    log("          undocumented Load Cell would be discovered rather than guessed)")

    log("selftest: garbage must not raise")
    for junk in ["not json", "", "{\"broken\":", "[]", "null"]:
        assert handle_line(junk) is None, f"junk parsed unexpectedly: {junk}"
    log("selftest: 5 junk lines ignored cleanly")

    log("selftest: bare payload (firmware without the wrapper)")
    assert handle_line('{"type":"sensor","key":"distance","value":99}') is not None
    log("selftest: bare payload accepted")

    log("selftest: action whitelist")
    assert "set_color" in ALLOWED_ACTIONS
    assert "set_torque" not in ALLOWED_ACTIONS, "safety: robot actuation must never be sendable"
    assert "move_all" not in ALLOWED_ACTIONS, "safety: robot actuation must never be sendable"
    assert "move_joint" not in ALLOWED_ACTIONS, "safety: robot actuation must never be sendable"
    log("selftest: set_color allowed; set_torque/move_all/move_joint correctly REJECTED")
    log("           (this service can light LEDs but can never command a robot)")

    log("selftest: history bounded")
    with _lock:
        STATE["history"].clear()
    for i in range(500):
        handle_line('{"type":"event","payload":{"type":"sensor","key":"distance","value":%d}}' % i)
    with _lock:
        n = len(STATE["history"])
    assert n <= 200, f"history unbounded: {n}"
    log(f"selftest: 500 events -> history holds {n} (cap 200)")
    log("selftest: PASS")
    return 0


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa
        if self.path.startswith("/health"):
            with _lock:
                self._send(200, {"ok": True, "connected": STATE["connected"],
                                 "port": STATE["port"], "last_error": STATE["last_error"],
                                 "uptime_s": round(time.time() - STATE["started"], 1)})
        elif self.path.startswith("/events"):
            with _lock:
                self._send(200, {
                    "advisory": True,
                    "connected": STATE["connected"],
                    "latest": STATE["latest"],
                    "last_event": STATE["last_event"],
                    "lines": STATE["lines"],
                    "unknown_keys": STATE["unknown_keys"],
                    "watched": WATCHED,
                    "history": list(STATE["history"])[-50:],
                })
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa
        # Inject an event without hardware — the same trick yolo_watch's POST /frame uses.
        if self.path.startswith("/event"):
            try:
                n = int(self.headers.get("content-length", 0))
                raw = self.rfile.read(n).decode() if n else ""
                payload = handle_line(raw)
                if payload is None:
                    return self._send(400, {"error": "unparseable; send one board JSON line"})
                self._send(200, {"ok": True, "event": payload})
            except Exception as e:  # noqa
                self._send(500, {"error": str(e)})
        elif self.path.startswith("/action"):
            # Whitelisted LED/display actions only. Never robot actuation.
            try:
                n = int(self.headers.get("content-length", 0))
                msg = json.loads(self.rfile.read(n).decode() or "{}")
                action = msg.get("action")
                if action not in ALLOWED_ACTIONS:
                    return self._send(403, {"error": f"action not allowed: {action}",
                                           "allowed": sorted(ALLOWED_ACTIONS)})
                with _lock:
                    connected = STATE["connected"]
                if not connected:
                    return self._send(409, {"error": "board not connected"})
                # A real deployment writes msg+"\n" to the port here.
                self._send(200, {"ok": True, "queued": msg, "written": False,
                                 "note": "no board attached in this process"})
            except Exception as e:  # noqa
                self._send(500, {"error": str(e)})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *a) -> None:  # noqa
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial device, e.g. /dev/cu.usbmodem1101")
    ap.add_argument("--http-port", type=int, default=8767)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--verbose", action="store_true", help="log every line (discover modules)")
    ap.add_argument("--selftest", action="store_true", help="verify with no hardware")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    if not args.port:
        log("no --port given. Listing likely devices is not possible without pyserial;")
        log("run with --selftest to verify the parser, or pass e.g. --port /dev/cu.usbmodem1101")
        return 2

    log("advisory mode: owns ONE serial port (the Atech board). Cannot move a robot.")
    threading.Thread(target=serial_loop, args=(args.port, args.verbose), daemon=True).start()
    log(f"listening on http://{args.host}:{args.http_port}  (GET /health, GET /events, POST /event)")
    try:
        ThreadingHTTPServer((args.host, args.http_port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())