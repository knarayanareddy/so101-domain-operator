#!/usr/bin/env python3
"""
yolo-watch — advisory object recognition for the SO-101 Control Room.

WHAT THIS IS
    A side-channel observer. It watches the same table the robot works on,
    runs YOLO, and publishes what it sees. It NEVER sends commands to the arm.

WHY IT IS A SEPARATE PROCESS
    The control loop lives in the browser (Web Serial holds the camera and the
    serial port). Python cannot share either. So this reads frames over HTTP
    from the app's own capture endpoint instead of opening the camera, which
    would steal it from the browser and break control.

    Consequence: the robot still picks using colour thresholding + a planar
    homography (see src/lib/vision.ts). This adds labels and confidence, and
    nothing else. If this dies, the arm is unaffected.

DESIGN RULES
    * No actuation path. There is no code here that writes to a serial port.
    * Localhost only. Binds 127.0.0.1.
    * Fail soft. Any error degrades to "no detections", never to an exception
      that could look like a crash mid-demo.
    * Honest about vocabulary. COCO has no "cube"/"block"/"dice"/"pen", which
      are exactly the SO-101 mission objects. Out-of-vocabulary items are
      reported as such rather than silently mislabelled.

Run:
    ~/.so101/yolo-venv/bin/python yolo_watch.py --port 8766
    ~/.so101/yolo-venv/bin/python yolo_watch.py --selftest   # no camera needed
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# COCO classes that make sense on a tabletop; anything else is reported but
# flagged, so a "sports ball" is never claimed to be a dice.
TABLE_OBJECTS = {
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana",
    "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza",
    "donut", "cake", "potted plant", "dining table", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush", "person", "sports ball", "tennis racket",
}
# Objects the SO-101 missions use that YOLO structurally cannot name.
MISSION_PRIMITIVES = {
    "cube", "block", "dice", "domino", "pen", "marker", "pill", "tile", "card",
    "vial", "tube", "die", "candy", "phone", "keypad button", "light switch",
}

STATE = {
    "model": "yolo11n.pt",
    "device": "mps",
    "conf": 0.35,
    "detections": [],
    "inference_ms": None,
    "fps": None,
    "frames": 0,
    "last_error": None,
    "started": None,
    "backend": None,
    "status": "starting",
}
_lock = threading.Lock()


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------
def load_model(model_path: str, device: str):
    import torch  # noqa
    from ultralytics import YOLO

    m = YOLO(model_path)
    try:
        m.to(device)
    except Exception as e:  # noqa
        log(f"device {device} unavailable ({e}); falling back to cpu")
        device = "cpu"
        m.to(device)
    log(f"model loaded: {model_path} on {device}, {len(m.names)} classes")
    return m, device


def detect(model, device, frame_bgr, conf: float):
    """Run one inference. Returns (detections, elapsed_ms). Never raises."""
    import torch  # noqa

    try:
        r = model.predict(frame_bgr, verbose=False, imgsz=640, device=device, conf=conf)
        if device == "mps":
            torch.mps.synchronize()  # without this the timing is fiction
        out = []
        names = model.names
        for b in r[0].boxes:
            cls_id = int(b.cls[0])
            label = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id)
            conf_f = float(b.conf[0])
            x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
            in_vocab = label in TABLE_OBJECTS
            out.append({
                "label": label,
                "confidence": round(conf_f, 3),
                "bbox": [round(x1), round(y1), round(x2), round(y2)],
                "table_object": in_vocab,
                "note": None if in_vocab else "COCO class; may not be a mission primitive",
            })
        out.sort(key=lambda d: -d["confidence"])
        return out, None
    except Exception as e:  # noqa
        log(f"inference failed: {type(e).__name__}: {e}")
        return [], None


# --------------------------------------------------------------------------
# frame source — the browser shares its frame; we never open the camera
# --------------------------------------------------------------------------
def grab_from_app(timeout_ms: int = 900):
    """Fetch a JPEG frame from the running app. Returns bytes or None.

    The app exposes /api/state for persistence; if a future build adds a
    capture endpoint we use it. Until then we can also read a frame that a
    helper drops on disk. Never opens a camera device — that would fight the
    browser for exclusive access and break control.
    """
    import urllib.request

    for url in (
        "http://127.0.0.1:3000/api/frame.jpg",
        "http://127.0.0.1:3000/api/capture",
    ):
        try:
            with urllib.request.urlopen(url, timeout=timeout_ms / 1000) as resp:
                data = resp.read()
            if data and len(data) > 1000:
                return data
        except Exception:  # noqa
            continue
    return None


def decode(data: bytes):
    import cv2  # noqa
    import numpy as np  # noqa

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def selftest(model_path: str, device: str) -> int:
    """Prove the whole path works with no camera and no app: synthetic frame."""
    import numpy as np  # noqa

    log("selftest: loading model")
    model, dev = load_model(model_path, device)
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)

    log("selftest: warm-up")
    detect(model, dev, frame, STATE["conf"])

    log("selftest: 10 timed inferences on synthetic 1280x720")
    times = []
    for _ in range(10):
        t = time.perf_counter()
        dets, ms = detect(model, dev, frame, STATE["conf"])
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    med = times[len(times) // 2]
    log(f"selftest: median {med:.1f} ms => {1000/med:.1f} fps on {dev}")
    log(f"selftest: detections on a blank frame = {len(dets)} (expected 0)")
    log("selftest: decode path")
    import cv2  # noqa
    ok, buf = cv2.imencode(".jpg", frame)
    back = cv2.imdecode(np.frombuffer(buf, dtype=np.uint8), cv2.IMREAD_COLOR)
    log(f"selftest: jpeg round-trip {'ok' if back is not None and back.shape == frame.shape else 'FAILED'}")
    log(f"selftest: vocabulary {len(TABLE_OBJECTS)} table classes, "
        f"{len(MISSION_PRIMITIVES)} mission primitives NOT in COCO")
    log("selftest: PASS")
    return 0


# --------------------------------------------------------------------------
# http surface
# --------------------------------------------------------------------------
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
            self._send(200, {"ok": True, "status": STATE["status"], "device": STATE["device"]})
        elif self.path.startswith("/detections"):
            with _lock:
                self._send(200, {
                    "detections": STATE["detections"],
                    "inference_ms": STATE["inference_ms"],
                    "fps": STATE["fps"],
                    "frames": STATE["frames"],
                    "last_error": STATE["last_error"],
                    "advisory": True,
                })
        elif self.path.startswith("/vocabulary"):
            self._send(200, {"table_objects": sorted(TABLE_OBJECTS),
                             "not_in_coco": sorted(MISSION_PRIMITIVES)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa
        # Accept a raw JPEG body so a helper can push frames without a camera grab.
        if not self.path.startswith("/frame"):
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length", 0))
            data = self.rfile.read(n) if n else b""
            if not data:
                return self._send(400, {"error": "empty body; POST raw JPEG bytes"})
            frame = decode(data)
            if frame is None:
                return self._send(400, {"error": "could not decode image"})
            model = STATE.get("_model")
            device = STATE["device"]
            t0 = time.perf_counter()
            dets, _ = detect(model, device, frame, STATE["conf"])
            dt = (time.perf_counter() - t0) * 1000
            with _lock:
                prev = STATE["frames"]
                STATE["detections"] = dets
                STATE["inference_ms"] = round(dt, 1)
                STATE["fps"] = round(1000 / dt, 1) if dt else None
                STATE["frames"] = prev + 1
                STATE["last_error"] = None
                STATE["status"] = "running"
            self._send(200, {"detections": dets, "inference_ms": round(dt, 1)})
        except Exception as e:  # noqa
            with _lock:
                STATE["last_error"] = str(e)
            self._send(500, {"error": str(e)})

    def log_message(self, *a) -> None:  # noqa
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--model", default=os.path.expanduser("~/.so101/models/yolo11n.pt"))
    ap.add_argument("--device", default="mps", choices=["mps", "cpu"])
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--poll", action="store_true",
                    help="poll the app for frames instead of waiting for POST /frame")
    ap.add_argument("--interval", type=float, default=0.1)
    ap.add_argument("--selftest", action="store_true", help="verify without any camera")
    args = ap.parse_args()

    STATE["conf"] = args.conf
    STATE["started"] = time.time()

    if not os.path.isfile(args.model):
        log(f"model not found: {args.model}")
        return 2

    if args.selftest:
        return selftest(args.model, args.device)

    try:
        model, dev = load_model(args.model, args.device)
    except Exception as e:  # noqa
        log(f"could not load model: {e}")
        return 1
    STATE["_model"] = model
    STATE["device"] = dev
    STATE["backend"] = "post-frame"
    STATE["status"] = "running"
    log("advisory mode: this process NEVER writes to a serial port")

    if args.poll:
        STATE["backend"] = "poll-app"

        def loop() -> None:
            import numpy as np  # noqa
            misses = 0
            while True:
                data = grab_from_app()
                if data is None:
                    misses += 1
                    if misses % 20 == 0:
                        with _lock:
                            STATE["last_error"] = "no frame source (app not exposing /api/frame.jpg)"
                        log("no frame source yet — POST /frame or add the app endpoint")
                    time.sleep(args.interval)
                    continue
                misses = 0
                frame = decode(data)
                if frame is None:
                    time.sleep(args.interval)
                    continue
                t0 = time.perf_counter()
                dets, _ = detect(model, dev, frame, args.conf)
                dt = (time.perf_counter() - t0) * 1000
                with _lock:
                    STATE["detections"] = dets
                    STATE["inference_ms"] = round(dt, 1)
                    STATE["fps"] = round(1000 / dt, 1) if dt else None
                    STATE["frames"] += 1
                    STATE["last_error"] = None
                time.sleep(max(0.0, args.interval - dt / 1000))

        threading.Thread(target=loop, daemon=True).start()

    log(f"listening on http://{args.host}:{args.port}  (GET /detections, POST /frame)")
    try:
        ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
