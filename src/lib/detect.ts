import type { Detection, Img, Mat3, Pt } from "./vision";
import { localizeAll, applyH } from "./vision";

/**
 * Open-vocabulary detection adapter.
 *
 * The five showcase domains need labels like "resistor", "capacitor", "sample
 * tube", "stock crate" — none of which exist in COCO, which is why the YOLO
 * watcher cannot see them. This adapter talks to `tools/detector_watch.py`
 * (Florence-2, local) and converts its output into the project's own
 * `Detection[]`, so everything downstream is unchanged:
 *
 *     detections -> localizeAll(dets, H) -> .world in cm -> arm.pick()
 *
 * MEASURED LIMITATION — read before trusting a box.
 * Florence-2 emits the PROMPT'S OWN LABEL whether or not the object exists.
 * On a real photograph (ultralytics bus.jpg):
 *     "a person"  -> 3 boxes, all correct
 *     "a bus"     -> 1 box, correct, 47.2% of frame
 *     "a capacitor" -> 1 box, HALLUCINATED, 47.5% of frame
 * The hallucinated capacitor and the real bus differ by 0.3% of frame area, so NO
 * area threshold separates them. The area guard is therefore off by default.
 *
 * The practical consequence: a detection proves the model was ASKED about
 * something, not that the something is there. Two independent signals are required
 * before motion — a class the bench actually contains, and the motor stall/load
 * check at grasp time. Do not treat `detections.length > 0` as "the part exists".
 *
 * Also measured: a comma-separated prompt ("a bus, a person, a bench") collapses
 * to ONE box. The server therefore fans out one forward pass per label, which is
 * why multi-label is ~7s rather than ~2.4s.
 *
 * SAFETY CONTRACT — the detector is ADVISORY and is never on the actuation path.
 *   - It returns evidence, never permission.
 *   - An unreachable or uncalibrated target is DROPPED, not approximated.
 *   - `score` is Florence-2's absence of a per-box confidence: we surface it as
 *     `null` and mark `verified: false`. Nothing downstream may treat an
 *     unverified detection as confirmed. This is the same closed-set discipline as
 *     repair.ts, where an unavailable input yields `unknown` rather than a false
 *     pass.
 *   - The browser remains the only holder of Web Serial; this module cannot reach
 *     a serial port even in principle.
 */

/** Raw shape returned by detector_watch.py. */
export interface RawDetection {
  label: string;
  px: Pt;
  area: number;
  /** xyxy in pixels, matching vision.ts's Detection.bbox convention. */
  bbox: [number, number, number, number];
  score: number | null;
  verified: boolean;
  /** Fraction of the frame this box covers. Large values are a hallucination hint. */
  frame_fraction?: number;
}

export interface DetectResponse {
  ok: boolean;
  detections: RawDetection[];
  ms?: number;
  image?: { width: number; height: number };
  advisory?: boolean;
  error?: string | null;
  /** Boxes discarded as implausible. Non-zero means the model over-reached. */
  dropped_as_implausible?: number;
  /** Per-label box counts when the prompt was comma-separated. */
  per_label?: Record<string, number>;
}

export interface GroundOptions {
  /** Detector base URL. Local-only by design; no cloud fallback exists. */
  baseUrl?: string;
  /** Open-vocabulary prompt, e.g. "a resistor, a capacitor, a phone screen". */
  text: string;
  /** Longer prompts are truncated; Florence-2's context is bounded. */
  maxPromptChars?: number;
  timeoutMs?: number;
  /**
   * Minimum box area in px². Small blobs are usually noise or a fingertip, and
   * grabbing at a 3-pixel centroid is how you miss.
   */
  minArea?: number;
  /** Maximum detections returned, largest first. Keeps the pick order bounded. */
  maxDetections?: number;
}

const DEFAULT_BASE = "http://127.0.0.1:8767";

/** Encode an Img (raw RGBA) as a JPEG data URL for the python side. */
export async function imgToJpegDataUrl(img: Img, quality = 0.85): Promise<string> {
  if (typeof document === "undefined") throw new Error("imgToJpegDataUrl needs a DOM canvas");
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.toDataURL("image/jpeg", quality);
}

/**
 * Call the detector.
 *
 * NEVER throws. Any failure — service down, model not loaded, bad JSON, timeout —
 * comes back as `{ ok: false, detections: [] }`, because a caller that could crash
 * on a missing detector would take the control loop down with it.
 */
export async function detectOpenVocabulary(
  img: Img,
  opts: GroundOptions,
): Promise<DetectResponse> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const prompt = opts.text.trim().slice(0, opts.maxPromptChars ?? 300);
  if (!prompt) return { ok: false, detections: [], error: "empty prompt" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const dataUrl = await imgToJpegDataUrl(img);
    const res = await fetch(`${base}/detect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: prompt, image_b64: dataUrl }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, detections: [], error: `detector HTTP ${res.status}` };
    }
    const j = (await res.json()) as DetectResponse;
    if (!j.ok) return { ok: false, detections: [], error: j.error ?? "detector reported failure" };

    const minArea = opts.minArea ?? 400;
    const kept = j.detections
      .filter((d) => Array.isArray(d.bbox) && d.bbox.length === 4 && d.area >= minArea)
      .sort((a, b) => b.area - a.area)
      .slice(0, opts.maxDetections ?? 12);

    return { ...j, detections: kept };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "detector timeout" : e.message) : String(e);
    return { ok: false, detections: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert detector output into the project's own `Detection[]`, already in world cm.
 *
 * `H` is the calibrated homography. If it is null we still return pixel-space
 * detections but leave `world` undefined — the caller can draw them, but MUST NOT
 * actuate on an uncalibrated target.
 */
export function toDetections(raw: RawDetection[], H: Mat3 | null): Detection[] {
  const dets: Detection[] = raw.map((d) => ({
    label: d.label,
    px: d.px,
    area: d.area,
    bbox: d.bbox,
  }));
  return localizeAll(dets, H);
}

/**
 * The pick plan: detections that are BOTH calibrated AND inside the arm's reach.
 *
 * Anything failing either test is dropped rather than clamped. Approximating an
 * out-of-reach target is how the arm ends up grasping empty table — the exact bug
 * this project already fixed once in Sim Lab, and the one that would matter most on
 * real hardware.
 */
export interface PickPlanEntry extends Detection {
  reachable: true;
}

export interface RejectedEntry {
  label: string;
  px: Pt;
  reason: "uncalibrated" | "out-of-reach" | "degenerate";
  dFromBaseCm?: number;
}

export interface PickPlan {
  picks: PickPlanEntry[];
  rejected: RejectedEntry[];
  ok: boolean;
}

export function planPicks(
  raw: RawDetection[],
  H: Mat3 | null,
  base: Pt,
  reachCm: number,
  marginCm = 1.1,
): PickPlan {
  const picks: PickPlanEntry[] = [];
  const rejected: RejectedEntry[] = [];
  const limit = reachCm - marginCm;

  for (const d of toDetections(raw, H)) {
    if (!d.world) {
      rejected.push({ label: d.label, px: d.px, reason: "uncalibrated" });
      continue;
    }
    const dist = Math.hypot(d.world.x - base.x, d.world.y - base.y);
    if (!(dist <= limit)) {
      rejected.push({ label: d.label, px: d.px, reason: "out-of-reach", dFromBaseCm: Number(dist.toFixed(1)) });
      continue;
    }
    // A world point at the base is a calibration artefact, not a target.
    if (dist < 2) {
      rejected.push({ label: d.label, px: d.px, reason: "degenerate", dFromBaseCm: Number(dist.toFixed(1)) });
      continue;
    }
    picks.push({ ...d, reachable: true });
  }

  picks.sort((a, b) => {
    const da = Math.hypot(a.world!.x - base.x, a.world!.y - base.y);
    const db = Math.hypot(b.world!.x - base.x, b.world!.y - base.y);
    return da - db; // nearest first: least arm travel, and a natural work order
  });

  return { picks, rejected, ok: picks.length > 0 };
}

/** Convenience: pixel point -> world cm, for a single known target. */
export function pixelToWorld(px: Pt, H: Mat3 | null): Pt | null {
  return H ? applyH(H, px) : null;
}