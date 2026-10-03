import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * POST /api/voice -> local speech-to-text.
 *
 * Runs `voice_pick.py`, which calls mlx-whisper on Apple Silicon. Fully local and
 * offline. It returns TEXT ONLY — it never emits motor commands. The caller feeds
 * the text to `resolvePick()` and executes that in the browser, which is the only
 * process holding Web Serial.
 *
 * This route is deliberately dumb: no intent classification here, so the same
 * resolver can be unit-tested without a server.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOOL = "tools/voice_pick.py";

export async function POST() {
  try {
    // 4 s of microphone, base model. Long enough for "pick up the resistor".
    const { stdout } = await exec(
      "python3",
      [TOOL, "--record", "4", "--json"],
      { timeout: 120_000, maxBuffer: 1 << 20 },
    );
    const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    if (!parsed.ok) return Response.json({ error: parsed.error ?? "no speech" }, { status: 502 });
    return Response.json({ text: parsed.speech, source: parsed.source });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    note: "POST to transcribe 4 s from the microphone using local STT. Text only — no actuation.",
  });
}