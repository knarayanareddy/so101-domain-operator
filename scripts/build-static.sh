#!/usr/bin/env bash
# =============================================================================
# build-static: produce a GitHub-Pages-ready static export.
#
# Why this is a script and not just an env var: `output: "export"` cannot coexist
# with the /api/voice and /api/speak routes, which shell out to a LOCAL python
# tool. Next refuses to build while they are present, so they are moved aside for
# the duration of the build and restored immediately afterwards — including on
# failure or interrupt.
#
# What you lose on Pages vs `npm run dev`:
#   voice input   (STT) — the browser cannot spawn voice_pick.py
#   narration     (TTS) — degrades to silent; motion is unaffected
#   postgres backup       — localStorage was already the source of truth
# Everything else (Sim Lab, missions, virtual arm, single pick, Web Serial,
# camera calibration) runs entirely in the browser.
# =============================================================================
set -euo pipefail

PROJ="${SO101_PROJECT:-$HOME/.so101/deck}"
OUT="${1:-$PROJ/out}"
REPO="${NEXT_PUBLIC_REPO:-so101-domain-operator}"
STASH=""

cleanup() {
  if [ -n "$STASH" ] && [ -d "$STASH" ]; then
    for d in "$STASH"/*; do
      [ -e "$d" ] || continue
      mv "$d" "$PROJ/src/app/api/$(basename "$d")" 2>/dev/null || true
    done
    rmdir "$STASH" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$PROJ"

# Move the server-only routes aside.
STASH="$(mktemp -d)"
for r in voice speak state health; do
  if [ -d "src/app/api/$r" ]; then
    mkdir -p "$STASH/$r"
    mv "src/app/api/$r"/* "$STASH/$r"/ 2>/dev/null || true
    rmdir "src/app/api/$r" 2>/dev/null || true
  fi
done

# GitHub Pages serves the published directory at the ROOT of the hostname, so the
# default is an EMPTY basePath — Next rejects "/" outright ("basePath has to be
# either an empty string or a path prefix"). Pass /<repo> only if you will serve
# the site exclusively under that sub-path.
BASE_PATH="${BASE_PATH:-}"
echo "[build-static] building with BASE_PATH=${BASE_PATH:-<none, served at root>}"
STATIC_EXPORT=1 NEXT_PUBLIC_REPO="$REPO" NEXT_PUBLIC_BASE_PATH="$BASE_PATH" \
  npx next build

echo "[build-static] output: $OUT"
find "$OUT" -maxdepth 1 -type f -o -maxdepth 1 -type d | head -12
echo "[build-static] done. Publish $OUT to GitHub Pages."
