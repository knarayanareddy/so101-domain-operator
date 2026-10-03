import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

/**
 * POST /api/speak -> local text-to-speech.
 *
 * Runs `voice_pick.py --text ... --speak`, which drives `voice-speak` (kokoro) on
 * Apple Silicon. Fully local and offline.
 *
 * Returns `ok: false` rather than throwing when synthesis fails. Speech is a
 * narration layer: a robot demo that refuses to move because the narrator's voice
 * model is missing is worse than a silent one. Callers should treat a failure as
 * "no narration", never as a motion-blocking error.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOOL = "tools/voice_pick.py";

export async function POST(req: Request) {
  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ ok: false, error: "expected JSON body {text}" }, { status: 400 });
  }

  if (!text) return Response.json({ ok: false, error: "empty text" }, { status: 400 });
  // Keep the route cheap to abuse: narration is short by design.
  if (text.length > 400) text = `${text.slice(0, 397)}...`;

  try {
    const { stdout } = await exec("python3", [TOOL, "--text", text, "--speak", "--json"], {
      timeout: 120_000,
      maxBuffer: 1 << 20,
    });
    const line = (stdout.trim().split("\n").pop() || "{}");
    let parsed: { ok?: boolean; tts?: { ok: boolean; error?: string } };
    try {
      parsed = JSON.parse(line);
    } catch {
      // A failure can still exit 0 with a non-JSON last line; treat as narrate-failed.
      return Response.json({ ok: false, error: "voice_pick produced no parseable result" });
    }
    const tts = parsed.tts ?? { ok: false, error: "no tts field" };
    // 200 either way: the caller narrates opportunistically.
    return Response.json({ ok: Boolean(tts.ok), text, error: tts.ok ? null : tts.error ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, text, error: msg });
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    note: "POST {text} to narrate with local kokoro TTS. Failures are advisory, not blocking.",
  });
}