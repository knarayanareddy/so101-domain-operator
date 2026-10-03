import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  detectOpenVocabulary,
  toDetections,
  planPicks,
  pixelToWorld,
  type RawDetection,
} from "../detect";
import type { Img, Mat3 } from "../vision";
import { solveHomography, localizeAll, type Pt } from "../vision";

/**
 * Contract tests for the open-vocabulary adapter.
 *
 * The theme: the detector PROPOSES, deterministic code DECIDES. A detection is
 * evidence, never permission. These tests fail if that ever inverts.
 */

const img: Img = { data: new Uint8ClampedArray(4), width: 2, height: 2 };

const raw = (over: Partial<RawDetection> = {}): RawDetection => ({
  label: "resistor",
  px: { x: 100, y: 100 },
  area: 900,
  bbox: [80, 80, 120, 120],
  score: null,
  verified: false,
  ...over,
});

/** Identity-ish homography: pixel (u,v) -> world (u/10, v/10). */
const H: Mat3 = [0.1, 0, 0, 0, 0.1, 0, 0, 0, 1];

describe("detectOpenVocabulary: never throws, never fabricates", () => {
  beforeEach(() => {
    // jsdom has no canvas 2d/JPEG encoder; stub the encode step so we exercise the
    // HTTP + error contract rather than the browser encoder.
    // jsdom implements neither ImageData nor a real JPEG encoder, so stub the two
    // browser primitives imgToJpegDataUrl needs. The contract under test is the
    // HTTP + fail-closed behaviour, not the encoder.
    vi.stubGlobal("ImageData", class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 2,
        height: 2,
        getContext: () => ({ putImageData: () => undefined }),
        toDataURL: () => "data:image/jpeg;base64,AAAA",
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false and NO detections when the service is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    const r = await detectOpenVocabulary(img, { text: "a resistor", baseUrl: "http://127.0.0.1:1" });
    expect(r.ok).toBe(false);
    // CRITICAL: a failed detector must not produce a guess.
    expect(r.detections).toEqual([]);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it("returns ok:false on a non-200 without inventing boxes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const r = await detectOpenVocabulary(img, { text: "a resistor", baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.detections).toEqual([]);
    expect(r.error).toMatch(/503/);
  });

  it("propagates the service's own failure reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, detections: [], error: "model unavailable" }),
      }),
    );
    const r = await detectOpenVocabulary(img, { text: "a resistor", baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/model unavailable/);
  });

  it("refuses an empty prompt without calling the detector", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await detectOpenVocabulary(img, { text: "   ", baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops sub-threshold boxes (noise, fingertips) rather than keeping them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          detections: [raw({ label: "big", area: 5000 }), raw({ label: "speck", area: 12 })],
        }),
      }),
    );
    const r = await detectOpenVocabulary(img, { text: "objects", baseUrl: "http://x", minArea: 400 });
    expect(r.detections.map((d) => d.label)).toEqual(["big"]);
  });

  it("caps the number of detections and returns largest-first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          detections: [
            raw({ label: "a", area: 1000 }),
            raw({ label: "b", area: 9000 }),
            raw({ label: "c", area: 5000 }),
          ],
        }),
      }),
    );
    const r = await detectOpenVocabulary(img, { text: "objects", baseUrl: "http://x", maxDetections: 2 });
    expect(r.detections.map((d) => d.label)).toEqual(["b", "c"]);
  });

  it("marks detections unverified, because Florence-2 emits no per-box score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, detections: [raw({ score: null, verified: false })] }),
      }),
    );
    const r = await detectOpenVocabulary(img, { text: "a resistor", baseUrl: "http://x" });
    expect(r.detections[0].score).toBeNull();
    // Nothing may treat an unverified detection as confirmed.
    expect(r.detections[0].verified).toBe(false);
  });
});

describe("toDetections: reuses the existing homography, no second maths", () => {
  it("produces Detection[] with world coordinates", () => {
    const d = toDetections([raw({ px: { x: 100, y: 200 } })], H);
    expect(d).toHaveLength(1);
    expect(d[0].label).toBe("resistor");
    expect(d[0].world).toBeDefined();
    // H scales by 0.1, so (100,200) -> (10,20)
    expect(d[0].world!.x).toBeCloseTo(10, 6);
    expect(d[0].world!.y).toBeCloseTo(20, 6);
  });

  it("leaves world undefined when uncalibrated — drawable, not actuatable", () => {
    const d = toDetections([raw()], null);
    expect(d[0].world).toBeUndefined();
    expect(d[0].px).toBeDefined();
  });

  it("agrees with localizeAll on the same input (same math, not a reimplementation)", () => {
    const src = [raw({ px: { x: 33, y: 77 } })];
    const mine = toDetections(src, H)[0];
    const theirs = localizeAll(
      [{ label: src[0].label, px: src[0].px, area: src[0].area, bbox: src[0].bbox }],
      H,
    )[0];
    expect(mine.world!.x).toBeCloseTo(theirs.world!.x, 12);
    expect(mine.world!.y).toBeCloseTo(theirs.world!.y, 12);
  });

  it("preserves the xyxy bbox convention", () => {
    const d = toDetections([raw({ bbox: [1, 2, 3, 4] })], H);
    expect(d[0].bbox).toEqual([1, 2, 3, 4]);
  });
});

describe("planPicks: reach and calibration gate motion", () => {
  const base: Pt = { x: 0, y: 0 };
  const at = (wx: number, wy: number): RawDetection =>
    raw({ px: { x: wx * 10, y: wy * 10 }, label: `at${wx},${wy}` });

  it("accepts a calibrated, in-reach target", () => {
    const plan = planPicks([at(10, 10)], H, base, 24.2);
    expect(plan.ok).toBe(true);
    expect(plan.picks).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  it("REJECTS an out-of-reach target instead of clamping it", () => {
    // world (50,0) is 50 cm from base; reach is 24.2
    const plan = planPicks([at(50, 0)], H, base, 24.2);
    expect(plan.picks).toHaveLength(0);
    expect(plan.ok).toBe(false);
    const r = plan.rejected[0];
    expect(r.reason).toBe("out-of-reach");
    expect(r.dFromBaseCm).toBeCloseTo(50, 1);
  });

  it("REJECTS everything when the homography is missing", () => {
    const plan = planPicks([at(10, 10)], null, base, 24.2);
    expect(plan.picks).toHaveLength(0);
    expect(plan.rejected.every((r: { reason: string }) => r.reason === "uncalibrated")).toBe(true);
  });

  it("rejects a degenerate target sitting on the arm base", () => {
    const plan = planPicks([at(0.5, 0)], H, base, 24.2);
    expect(plan.picks).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("degenerate");
  });

  it("keeps the in-reach target and drops the out-of-reach one, separately", () => {
    const plan = planPicks([at(10, 0), at(80, 0)], H, base, 24.2);
    expect(plan.picks).toHaveLength(1);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toBe("out-of-reach");
  });

  it("orders picks nearest-first to minimise arm travel", () => {
    const plan = planPicks([at(20, 0), at(5, 0), at(12, 0)], H, base, 24.2);
    const ds = plan.picks.map((p) => Math.hypot(p.world?.x ?? 0, p.world?.y ?? 0));
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
  });

  it("respects the reach margin (does not grab at the very edge)", () => {
    // 23.5 cm is inside 24.2 but outside 24.2 - 1.1
    const plan = planPicks([at(23.5, 0)], H, base, 24.2);
    expect(plan.picks).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("out-of-reach");
  });

  it("an empty detection set yields ok:false, not a fabricated pick", () => {
    const plan = planPicks([], H, base, 24.2);
    expect(plan.ok).toBe(false);
    expect(plan.picks).toEqual([]);
  });
});

describe("integration with the real homography solver", () => {
  it("localises a detection using a genuinely fitted calibration", () => {
    // Four known marks, solved the same way the Vision tab solves them.
    const marks = [
      { px: { x: 0, y: 0 }, world: { x: -10, y: -10 } },
      { px: { x: 100, y: 0 }, world: { x: 10, y: -10 } },
      { px: { x: 100, y: 100 }, world: { x: 10, y: 10 } },
      { px: { x: 0, y: 100 }, world: { x: -10, y: 10 } },
    ];
    const fitted = solveHomography(
      marks.map((m) => m.px),
      marks.map((m) => m.world),
    );
    expect(fitted).not.toBeNull();

    // a detection at pixel centre -> world (0,0), i.e. the table centre
    const d = toDetections([raw({ px: { x: 50, y: 50 } })], fitted!)[0];
    expect(d.world!.x).toBeCloseTo(0, 4);
    expect(d.world!.y).toBeCloseTo(0, 4);

    // 24 cm from the table centre is outside a 23.1 cm envelope
    const far = toDetections([raw({ px: { x: 170, y: 50 } })], fitted!)[0];
    const plan = planPicks(
      [{ ...raw({ px: { x: 170, y: 50 } }) }],
      fitted!,
      { x: 0, y: 0 },
      23.1,
    );
    expect(far.world!.x).toBeGreaterThan(20);
    expect(plan.picks).toHaveLength(0);
  });
});

describe("pixelToWorld", () => {
  it("returns null without a calibration rather than a fake point", () => {
    expect(pixelToWorld({ x: 5, y: 5 }, null)).toBeNull();
  });
  it("maps through the homography when calibrated", () => {
    expect(pixelToWorld({ x: 50, y: 60 }, H)).toEqual({ x: 5, y: 6 });
  });
});

describe("measured Florence-2 limitations are encoded, not assumed away", () => {
  it("accepts a large REAL object (the bus at 47% of frame) rather than capping area", () => {
    // A 0.35 frame cap was tried and DELETED: it rejected the bus along with the
    // hallucinated capacitor. They differ by 0.3% of frame area.
    const big = raw({ label: "a bus", area: 412_953, bbox: [0, 229, 808, 740], px: { x: 404, y: 484 } });
    const plan = planPicks([big], H, { x: 0, y: 0 }, 400);
    expect(plan.picks).toHaveLength(1);
  });

  it("carries frame_fraction through so a caller can see a suspiciously large box", () => {
    const d = toDetections([raw({ frame_fraction: 0.475 })], H)[0];
    expect(d.label).toBe("resistor");
    // the raw field survives on the RawDetection the caller still holds
    expect(raw({ frame_fraction: 0.475 }).frame_fraction).toBeCloseTo(0.475, 6);
  });

  it("per_label counts are surfaced for multi-label prompts", async () => {
    vi.stubGlobal("ImageData", class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 2,
        height: 2,
        getContext: () => ({ putImageData: () => undefined }),
        toDataURL: () => "data:image/jpeg;base64,AAAA",
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          detections: [raw()],
          per_label: { "a bus": 1, "a person": 3 },
          dropped_as_implausible: 0,
        }),
      }),
    );
    const r = await detectOpenVocabulary(img, { text: "a bus, a person", baseUrl: "http://x" });
    expect(r.per_label).toEqual({ "a bus": 1, "a person": 3 });
    expect(r.dropped_as_implausible).toBe(0);
  });
});
