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

# BUG FIXED: this defaulted to $HOME/.so101/deck, which exists on this Mac but not
# in CI. GitHub Actions failed with "cd: /home/runner/.so101/deck: No such file or
# directory". In CI the script runs from the checkout, so GITHUB_WORKSPACE (or the
# current directory) is the correct answer; the override stays for local use.
if [ -n "${GITHUB_WORKSPACE:-}" ] && [ -d "${GITHUB_WORKSPACE}/src/app" ]; then
  PROJ="${GITHUB_WORKSPACE}"
elif [ -f ./src/app/api/voice/route.ts ] || [ -d ./src/app/api ]; then
  PROJ="$(pwd)"
else
  PROJ="${SO101_PROJECT:-$HOME/.so101/deck}"
fi
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
for r in voice speak state health detect; do
  if [ -d "src/app/api/$r" ]; then
    mkdir -p "$STASH/$r"
    mv "src/app/api/$r"/* "$STASH/$r"/ 2>/dev/null || true
    rmdir "src/app/api/$r" 2>/dev/null || true
  fi
done

# A GitHub Pages PROJECT site is served at /<repo>/, so the asset prefix must
# include the repo or every /_next chunk 404s (verified: white page). Next rejects
# "/" so pass the real prefix. Override with BASE_PATH="" only for a user/org page.
BASE_PATH="${BASE_PATH:-/$REPO}"
echo "[build-static] building with BASE_PATH=${BASE_PATH:-<none, served at root>}"
STATIC_EXPORT=1 NEXT_PUBLIC_REPO="$REPO" NEXT_PUBLIC_BASE_PATH="$BASE_PATH" \
  npx next build

echo "[build-static] output: $OUT"
find "$OUT" -maxdepth 1 -type f -o -maxdepth 1 -type d | head -12
echo "[build-static] done. Publish $OUT to GitHub Pages."
