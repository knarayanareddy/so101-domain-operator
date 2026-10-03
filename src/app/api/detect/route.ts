import { NextRequest } from "next/server";

/**
 * POST /api/detect -> open-vocabulary detections as the project's own Detection[].
 *
 * Thin proxy to `tools/detector_watch.py` (Florence-2, local, MPS/CPU). It runs in
 * a separate process because it needs torch + transformers; Next cannot host it.
 *
 * Like /api/voice and /api/speak, this route does NOT exist in the static export
 * (`output: "export"` cannot coexist with server routes) — see
 * scripts/build-static.sh, which moves it aside for Pages builds. On Pages,
 * detection is unavailable and callers must degrade to `unknown`.
 *
 * The response is advisory evidence. It confers no permission to move: the caller
 * still applies the homography, the reach check, and the stall check.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DETECTOR = process.env.DETECTOR_URL ?? "http://127.0.0.1:8767";
const TIMEOUT_MS = Number(process.env.DETECTOR_TIMEOUT_MS ?? 20_000);

export async function POST(req: NextRequest) {
  let body: { text?: unknown; image_b64?: unknown; baseUrl?: unknown; threshold?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, detections: [], error: "expected JSON {text, image_b64}" },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const image = typeof body.image_b64 === "string" ? body.image_b64 : "";
  if (!text) return Response.json({ ok: false, detections: [], error: "empty prompt" }, { status: 400 });
  if (!image) return Response.json({ ok: false, detections: [], error: "no image" }, { status: 400 });

  const base = typeof body.baseUrl === "string" && body.baseUrl ? body.baseUrl : DEFAULT_DETECTOR;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/detect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, image_b64: image }),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json({ ok: false, detections: [], error: `detector HTTP ${res.status}` });
    }
    const j = await res.json();
    return Response.json(j);
  } catch (e) {
    // Service down is the NORMAL case on a fresh machine, not an exception worth
    // crashing the control loop over. Report it; the caller degrades to unknown.
    const msg = e instanceof Error ? (e.name === "AbortError" ? "detector timeout" : e.message) : String(e);
    return Response.json({ ok: false, detections: [], error: msg });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const res = await fetch(`${DEFAULT_DETECTOR}/health`, {
      signal: ac.signal,
      cache: "no-store",
    });
    const j = await res.json();
    return Response.json(j);
  } catch {
    return Response.json({ ok: false, ready: false, error: "detector not running", advisory: true });
  } finally {
    clearTimeout(timer);
  }
}