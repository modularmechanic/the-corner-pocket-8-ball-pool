#!/usr/bin/env bash
# Bakes the pub's indirect (bounce) lighting with Blender Cycles and installs the result as a texture.
#
#   tools/bake-lighting/bake.sh [size=512] [samples=256]
#
# Re-run it after changing the room's geometry or its lights. It is the whole pipeline:
#   1. export-room.ts  builds the real procedural room head-lessly and writes .cache/room.glb
#   2. bake.py         path-traces the indirect diffuse pass in Cycles
#   3. cwebp           compresses it into public/lightmaps/
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="$HERE/.cache"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

SIZE=512
SAMPLES=256
for arg in "$@"; do
  case "$arg" in
    size=*) SIZE="${arg#size=}" ;;
    samples=*) SAMPLES="${arg#samples=}" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

[ -x "$BLENDER" ] || { echo "Blender not found at $BLENDER (override with BLENDER=/path/to/blender)" >&2; exit 1; }
command -v cwebp >/dev/null || { echo "cwebp not found (brew install webp)" >&2; exit 1; }

mkdir -p "$CACHE" "$ROOT/public/lightmaps"

echo "==> exporting the procedural room"
(cd "$ROOT" && node --import tsx "$HERE/export-room.ts")

# Cycles does not run its denoiser on a bake, so the map comes back speckled. Baking at twice the
# shipped resolution and averaging back down is the cheap fix: four path-traced texels per shipped
# texel, which is worth far more than the same time spent on extra samples.
BAKE_SIZE=$(( SIZE * 2 ))

echo "==> baking indirect light in Cycles (${BAKE_SIZE}px, ${SAMPLES} samples, shipped at ${SIZE}px)"
# `nice` keeps the owner's machine usable: Cycles will otherwise take everything it is given.
nice -n 10 "$BLENDER" --background --factory-startup --python "$HERE/bake.py" -- \
  "size=$BAKE_SIZE" "samples=$SAMPLES" | grep -vE '^(Fra:|Read blend|INFO: Blender create)' || true

[ -f "$CACHE/pub-indirect.png" ] || { echo "bake produced no image" >&2; exit 1; }

echo "==> compressing"
cwebp -quiet -q 88 -resize "$SIZE" "$SIZE" "$CACHE/pub-indirect.png" -o "$ROOT/public/lightmaps/pub-indirect.webp"
ls -l "$ROOT/public/lightmaps/pub-indirect.webp" | awk '{print "    " $9 "  " $5 " bytes"}'
