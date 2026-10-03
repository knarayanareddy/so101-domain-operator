#!/usr/bin/env python3
"""
Honest evaluation of the Florence-2 adapter on a REAL photograph.

The synthetic-rectangle selftest is too easy and produced one box covering the
whole frame, which told us almost nothing. This runs the real model against a real
image and reports what it actually found, including the failure cases.

Nothing here is asserted as good. The point is to measure, because a demo that
claims "it maps every object" needs to survive a real photograph.
"""
import base64
import json
import subprocess
import sys
import time

sys.path.insert(0, "/Users/macbookpro/.so101/deck/tools")

IMG = "/Users/macbookpro/.so101/yolo-venv/lib/python3.12/site-packages/ultralytics/assets/bus.jpg"

# COCO-ish nouns Florence-2 should know, plus one it should NOT invent.
PROMPTS = [
    "a bus",
    "a person",
    "a bench",
    "a traffic light",
    "a capacitor",
]


def main() -> int:
    from detector_watch import detect, load_model

    load_model()
    if not _model_ok():
        print(json.dumps({"ok": False, "error": "model failed to load"}))
        return 1

    img_b64 = base64.b64encode(open(IMG, "rb").read()).decode()
    results = []

    for p in PROMPTS:
        t0 = time.time()
        r = detect({"text": p, "image_b64": img_b64})
        dets = r.get("detections", []) if r.get("ok") else []
        results.append(
            {
                "prompt": p,
                "ok": r.get("ok"),
                "ms": round((time.time() - t0) * 1000, 1),
                "count": len(dets),
                "labels": [d["label"] for d in dets],
                "boxes": [d["bbox"] for d in dets],
                "areas": [round(d["area"]) for d in dets],
            }
        )
        print(f"  {p:18s} -> {len(dets)} box(es) {[(d['label'], round(d['area'])) for d in dets]}")

    # A multi-label prompt in ONE call — what the UI would actually send.
    multi = detect({"text": "a bus, a person, a bench", "image_b64": img_b64})
    multi_summary = {
        "ok": multi.get("ok"),
        "ms": multi.get("ms"),
        "count": len(multi.get("detections", [])),
        "labels": [d["label"] for d in multi.get("detections", [])],
        "boxes": [d["bbox"] for d in multi.get("detections", [])],
    }
    print(f"\n  multi-label: {multi_summary['count']} box(es) {multi_summary['labels']} in {multi_summary['ms']}ms")

    print("\n" + json.dumps({"per_prompt": results, "multi_label": multi_summary}, indent=2)[:3000])
    return 0


def _model_ok() -> bool:
    import detector_watch

    return detector_watch._model is not None


if __name__ == "__main__":
    raise SystemExit(main())