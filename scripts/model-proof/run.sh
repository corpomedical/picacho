#!/usr/bin/env bash
# The Helios model proof (2026-09-24, "We make our models better than meshy").
#
# Our own models, on nobody's API: TRELLIS.2 (Microsoft, MIT licence) builds
# a thing from each of your photos on a GPU rented by the hour, and every
# model is scored against the photos it was NOT built from — the question
# that matters is whether a car built from its front still looks like YOUR
# car from the side and the back.
#
# Where it runs: a RunPod pod, A100 80GB (Microsoft tested A100 and H100),
# a "RunPod PyTorch" template with CUDA 12.4 and "devel" in its name (the
# extensions compile against nvcc). Put this folder, with 2 to 4 photos of
# one thing in photos/, at /workspace/model-proof, then:
#
#   bash /workspace/model-proof/run.sh
#
# The first run installs TRELLIS.2 (the longest part); a second run on the
# same pod skips that. Everything it makes lands in out/. Stop the pod when
# it is done: it costs by the hour whether it works or not.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"
mkdir -p "$OUT"
started=$(date +%s)
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }

shopt -s nullglob nocaseglob
photos=("$HERE"/photos/*.{jpg,jpeg,png,webp})
shopt -u nullglob nocaseglob
if [ "${#photos[@]}" -eq 0 ]; then
  echo "No photos in $HERE/photos — put 2 to 4 photos of the same thing there first."
  exit 1
fi
log "photos: ${#photos[@]}"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | tee -a "$OUT/run.log"

cd /workspace
if [ ! -d TRELLIS.2 ]; then
  log "cloning TRELLIS.2"
  git clone -b main https://github.com/microsoft/TRELLIS.2.git --recursive || exit 1
fi
cd TRELLIS.2
git rev-parse HEAD > "$OUT/trellis-commit.txt"

if [ ! -f /workspace/.trellis2-ready ]; then
  # The versions TRELLIS.2's own setup pins for a new environment; the
  # template's own torch is older.
  python -c "import torch,sys; sys.exit(0 if torch.__version__.startswith('2.6.0') else 1)" 2>/dev/null ||
    pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
  log "installing TRELLIS.2 (the long part: extensions compile)"
  # Its own installer, sourced as its README says. "sudo" is not on a pod
  # (we are root already); the one line that uses it only installs a
  # faster Pillow, so it is allowed to fail.
  . ./setup.sh --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm
  cd /workspace/TRELLIS.2
  python -c "import trellis2, o_voxel" || { log "TRELLIS.2 did not install — see the lines above"; exit 1; }
  touch /workspace/.trellis2-ready
  log "installed in $(( $(date +%s) - started )) s"
fi

python "$HERE/build.py" --photos "$HERE/photos" --out "$OUT" --trellis /workspace/TRELLIS.2 "$@" 2>&1 | tee -a "$OUT/run.log"
log "all done in $(( $(date +%s) - started )) s — download out/, then STOP the pod"
