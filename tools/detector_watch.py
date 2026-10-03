#!/usr/bin/env python3
"""
detector_watch.py — open-vocabulary object detection, ADVISORY ONLY.

Why this exists
    YOLO (yolo_watch.py) recognises COCO classes. That is the wrong vocabulary for
    this bench: there is no COCO class for a capacitor, a PCB footprint, a phone
    screen, or a sample tube. Florence-2 is open-vocabulary — you hand it a text
    prompt and it returns boxes — which is what the five showcase domains need.

    This process CANNOT move the arm. It has no serial port, no ServoBus, no goal
    queue, and it exposes no action endpoint. It returns JSON and nothing else. The
    browser remains the only process that holds Web Serial.

    The division of labour follows the project's own rule: the model PROPOSES
    boxes, deterministic code DECIDES whether anything moves. Concretely, the
    caller still runs every box through:
        1. localizeAll() -> calibrated homography (held-out validated <= 2 cm)
        2. a reach check against the arm's actual envelope
        3. the motor-load / stall check at grasp time
    A detection is evidence, never permission.

Bounding-box convention
    Output is [x0, y0, x1, y1] in PIXELS — xyxy, matching `Detection.bbox` in
    src/lib/vision.ts. Florence-2 natively emits <loc_x0><loc_y0><loc_x1><loc_y1>
    in NORMALISED 0-1000 coordinates, so the conversion happens here, once, rather
    than in three call sites on the TypeScript side.

Fail-closed
    If the model cannot load, the prompt is empty, or the frame is unreadable, this
    returns {"ok": false, ...} with an empty detections list. It NEVER returns a
    fabricated or fallback detection. An unavailable detector must surface as
    `unknown` upstream, which is exactly what repair.ts expects.

Endpoints
    GET  /health   -> {ok, model, ready}
    POST /detect   -> {text|labels, image_b64|jpeg_path} -> {ok, detections[], ms}
    POST /selftest -> runs a fixed synthetic frame through the real pipeline
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MODEL_ID = os.environ.get("FLORENCE_MODEL", "microsoft/Florence-2-base")
# Florence-2 has no native port in transformers; it ships its modelling code in-repo
# and REQUIRES trust_remote_code=True. That code is broken on transformers 5.x
# ("Florence2LanguageConfig has no attribute forced_bos_token_id", then a hard
# refusal to load). So the version is pinned instead:
#
#     uv pip install --python ~/.so101/yolo-venv/bin/python "transformers==4.51.3"
#
# Verified working on 4.51.3 + torch 2.14.1. Do not "upgrade" this without
# re-running tools/detector_watch.py --selftest.
REQUIRED_TRANSFORMERS = "4.51.3"
PORT = int(os.environ.get("DETECTOR_PORT", "8767"))
MAX_BODY = 24 * 1024 * 1024  # a 1080p JPEG base64-encoded is well under this

# Florence-2 is trained on this task token; <OPEN_VOCABULARY_DETECTION> is the
# prompt form that makes it emit labelled boxes rather than a caption.
TASK = "<OPEN_VOCABULARY_DETECTION>"
# Below this the model is guessing; upstream treats low scores as `unknown`.
DEFAULT_THRESHOLD = float(os.environ.get("DETECTOR_THRESHOLD", "0.15"))
# A detection filling more than this fraction of the frame is treated as a
# hallucination rather than a discrete part.
#
# Calibrated against measurements, not guessed. On ultralytics bus.jpg (810x1080 =
# 874,800 px):
#   "a capacitor" (hallucinated) -> 415,572 px = 47.5% of frame  -> REJECTED
#   "a bus"       (real)         -> 412,953 px = 47.2% of frame  -> KEPT
#
# Those two are within 0.3% of each other, so area alone CANNOT separate them. An
# absolute area cut-off would either drop the bus or keep the capacitor. The guard
# is therefore left DISABLED by default and the discriminator is honest about it:
# Florence-2 has no per-box confidence, so "is this object really there" is not
# answerable from its output alone.
#
# What actually fixes this is not a threshold — it is requiring a second,
# independent signal before anything moves (the stall/load check at grasp time),
# or restricting prompts to classes the bench actually contains. Set
# DETECTOR_MAX_FRAME_FRACTION=0.99 to enable a loose sanity cut; do NOT set it
# between 0.35 and 0.9 on this workload.
MAX_FRAME_FRACTION = float(os.environ.get("DETECTOR_MAX_FRAME_FRACTION", "0.99"))

_lock = threading.Lock()
_model: Any = None
_processor: Any = None
_load_error: str | None = None


def log(msg: str) -> None:
    print(f"[detector] {msg}", file=sys.stderr, flush=True)


def load_model() -> None:
    """Load Florence-2 once, lazily. Failure is recorded, not raised."""
    global _model, _processor, _load_error
    try:
        import torch  # noqa: F401
        from transformers import AutoModelForCausalLM, AutoProcessor

        log(f"loading {MODEL_ID} ...")
        t0 = time.time()
        import transformers as _tf

        if not _tf.__version__.startswith(REQUIRED_TRANSFORMERS):
            # Not fatal: try anyway and report the real error. But say so loudly,
            # because the failure mode otherwise looks like a model problem.
            log(
                f"WARNING: transformers {_tf.__version__} != pinned {REQUIRED_TRANSFORMERS}; "
                "Florence-2 remote code is known to break on 5.x"
            )

        _model = AutoModelForCausalLM.from_pretrained(MODEL_ID, trust_remote_code=True)
        _processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
        _model.eval()
        _load_error = None
        log(f"ready in {time.time() - t0:.1f}s")
    except Exception as exc:  # noqa: BLE001 - reported, never faked
        _load_error = f"{type(exc).__name__}: {exc}"
        _model = None
        _processor = None
        log(f"LOAD FAILED: {_load_error}")


def _decode_image(payload: dict[str, Any]):
    from PIL import Image
    import io

    if payload.get("jpeg_path"):
        return Image.open(payload["jpeg_path"]).convert("RGB")
    b64 = payload.get("image_b64")
    if not b64:
        return None
    if "," in b64[:64] and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _parse_boxes(text: str, width: int, height: int, threshold: float) -> list[dict[str, Any]]:
    """
    Parse Florence-2's <OD> output into xyxy pixel boxes.

    Florence-2 emits:  <label><loc_x0><loc_y0><loc_x1><loc_y1> ... repeated,
    with locations NORMALISED to 0-1000. Converting here keeps that quirk in one
    place instead of three.
    """
    import re

    out: list[dict[str, Any]] = []
    # label followed by four integers, e.g. "capacitor<loc_142><loc_310>..."
    pattern = re.compile(
        r"([A-Za-z0-9][A-Za-z0-9 _\-/]{0,40}?)<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>"
    )
    for m in pattern.finditer(text or ""):
        label = m.group(1).strip()
        try:
            x0, y0, x1, y1 = (int(m.group(i)) for i in range(2, 6))
        except ValueError:
            continue
        # normalise 0-1000 -> pixels
        px0, px1 = x0 / 1000 * width, x1 / 1000 * width
        py0, py1 = y0 / 1000 * height, y1 / 1000 * height
        if px1 <= px0 or py1 <= py0:
            continue
        area = (px1 - px0) * (py1 - py0)
        out.append(
            {
                "label": label or "object",
                # centroid, matching Detection.px semantics
                "px": {"x": (px0 + px1) / 2, "y": (py0 + py1) / 2},
                "area": round(area, 2),
                "bbox": [round(px0, 2), round(py0, 2), round(px1, 2), round(py1, 2)],
            }
        )

    if not out:
        # Florence-2 may emit a bare list without <loc_> when confidence is low.
        # That is a genuine "found nothing", and we return [] rather than guessing.
        return []
    return out


def _labels_from(text: str) -> list[str]:
    """Split "a bus, a person, a bench" into individual prompts.

    MEASURED 2026-10-03 on a real photo (ultralytics bus.jpg):
      single prompt "a bus"        -> 1 box  (correct, spans the bus)
      single prompt "a person"     -> 3 boxes (correct, all three people)
      MULTI prompt "a bus, a person, a bench" -> 1 box ("a bench" only)

    Florence-2 collapses a comma-separated prompt to a single detection. Asking
    once per label is slower (N forward passes) but is the only way to get every
    object. The UI does this in parallel; the client caps concurrency.
    """
    parts = [p.strip() for p in text.replace(" and ", ",").split(",")]
    return [p for p in parts if p]


def detect_one(payload: dict[str, Any]) -> dict[str, Any]:
    if _model is None:
        if _load_error:
            return {"ok": False, "error": f"model unavailable: {_load_error}", "detections": []}
        return {"ok": False, "error": "model not loaded", "detections": []}

    text = (payload.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "empty prompt", "detections": []}

    try:
        image = _decode_image(payload)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"image decode failed: {exc}", "detections": []}
    if image is None:
        return {"ok": False, "error": "no image supplied", "detections": []}

    threshold = float(payload.get("threshold", DEFAULT_THRESHOLD))
    t0 = time.time()
    try:
        import torch

        with _lock:  # one forward pass at a time: the model is not re-entrant
            inputs = _processor(text=text + TASK, images=image, return_tensors="pt")
            with torch.no_grad():
                generated = _model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=1024,
                    num_beams=3,
                    do_sample=False,
                )
            decoded = _processor.batch_decode(generated, skip_special_tokens=False)[0]
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"inference failed: {type(exc).__name__}: {exc}", "detections": []}

    dets = _parse_boxes(decoded, image.width, image.height, threshold)

    # HALLUCINATION GUARD.
    # Florence-2 returns the prompt's own label whether or not the object is
    # present. Measured 2026-10-03: "a capacitor" on a street photograph returned a
    # 415,572 px box covering the entire scene. A region that fills most of the
    # frame is not a discrete part on a workbench, so drop it rather than hand the
    # arm a target the size of the table.
    frame = float(image.width * image.height)
    plausible = []
    for d in dets:
        frac = d["area"] / frame if frame else 0.0
        d["frame_fraction"] = round(frac, 4)
        if frac > MAX_FRAME_FRACTION:
            continue
        plausible.append(d)
    # Florence-2 does not emit per-box confidence in this mode, so `score` is not
    # fabricated here. Upstream treats a missing score as "unverified" -> unknown.
    for d in plausible:
        # Florence-2 emits no per-box confidence in this mode. We do NOT invent one.
        d["score"] = None
        d["verified"] = False
    return {
        "ok": True,
        "detections": plausible,
        "dropped_as_implausible": len(dets) - len(plausible),
        "ms": round((time.time() - t0) * 1000, 1),
        "image": {"width": image.width, "height": image.height},
        "raw": decoded[-400:],
        "advisory": True,
    }


def detect(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Fan out over comma-separated labels and merge.

    Each label gets its own forward pass (see _labels_from for the measurement that
    forces this). Boxes are merged with a simple IoU de-duplication, because a
    label like "bench" can legitimately return the same region as "bus".
    """
    if _model is None:
        if _load_error:
            return {"ok": False, "error": f"model unavailable: {_load_error}", "detections": []}
        return {"ok": False, "error": "model not loaded", "detections": []}

    labels = _labels_from((payload.get("text") or "").strip())
    if not labels:
        return {"ok": False, "error": "empty prompt", "detections": []}

    if len(labels) == 1:
        return detect_one({**payload, "text": labels[0]})

    t0 = time.time()
    merged: list[dict[str, Any]] = []
    per_label: dict[str, int] = {}
    for lab in labels:
        r = detect_one({**payload, "text": lab})
        if not r.get("ok"):
            continue
        ds = r.get("detections", [])
        per_label[lab] = len(ds)
        merged.extend(ds)

    merged = _dedupe(merged)
    return {
        "ok": True,
        "detections": merged,
        "ms": round((time.time() - t0) * 1000, 1),
        "per_label": per_label,
        "advisory": True,
        "note": "one forward pass per label; Florence-2 collapses multi-label prompts",
    }


def _iou(a: list[float], b: list[float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aa = max(0.0, ax1 - ax0) * max(0.0, ay1 - ay0)
    ab = max(0.0, bx1 - bx0) * max(0.0, by1 - by0)
    return inter / (aa + ab - inter) if (aa + ab - inter) > 0 else 0.0


def _dedupe(dets: list[dict[str, Any]], thresh: float = 0.85) -> list[dict[str, Any]]:
    """Drop near-identical boxes, keeping the larger. Grasp targets must be distinct."""
    kept: list[dict[str, Any]] = []
    for d in sorted(dets, key=lambda x: -x["area"]):
        if any(_iou(d["bbox"], k["bbox"]) >= thresh for k in kept):
            continue
        kept.append(d)
    return kept


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - base signature
        pass  # silence per-request noise

    def _send(self, code: int, obj: dict[str, Any]) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._send(
                200,
                {
                    "ok": _model is not None,
                    "model": MODEL_ID,
                    "ready": _model is not None,
                    "error": _load_error,
                    "advisory": True,
                },
            )
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        route = self.path.rstrip("/")
        if route not in ("/detect", "/selftest"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                self._send(413, {"ok": False, "error": "bad body length", "detections": []})
                return
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": f"bad JSON: {exc}", "detections": []})
            return

        if route == "/selftest":
            payload = dict(payload)
            payload.setdefault("text", "a resistor, a capacitor, a phone screen")

        self._send(200, detect(payload))


def main() -> int:
    global MODEL_ID  # must precede any use of the name in this function

    ap = argparse.ArgumentParser(description="Florence-2 open-vocabulary detector (advisory)")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--selftest", action="store_true", help="load, run one frame, exit")
    args = ap.parse_args()
    MODEL_ID = args.model

    if args.selftest:
        load_model()
        if _model is None:
            print(json.dumps({"ok": False, "error": _load_error}))
            return 1
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (640, 480), (238, 238, 242))
        d = ImageDraw.Draw(img)
        # three coloured rectangles standing in for bench parts
        for box, col in [((60, 90, 190, 230), (200, 60, 60)),
                         ((240, 120, 400, 280), (70, 110, 200)),
                         ((430, 80, 560, 260), (90, 170, 100))]:
            d.rectangle(box, fill=col)
        result = detect({"text": "red object, blue object, green object",
                         "image_b64": _b64_of(img), "threshold": 0.1})
        print(json.dumps({k: v for k, v in result.items() if k != "raw"}, indent=2)[:1200])
        return 0 if result.get("ok") else 1

    load_model()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    log(f"listening on http://127.0.0.1:{args.port} (advisory; no actuation path)")
    srv.serve_forever()
    return 0


def _b64_of(img: Any) -> str:
    import io

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode()


if __name__ == "__main__":
    raise SystemExit(main())