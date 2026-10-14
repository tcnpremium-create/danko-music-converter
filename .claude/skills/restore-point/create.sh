#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
slug=$(echo "${1:-manual}" | tr -c 'a-zA-Z0-9\n' '-' | cut -c1-30)
tag="restore/$(date +%Y%m%d-%H%M%S)-$slug"
mkdir -p .claude/restore
git tag "$tag"
git bundle create ".claude/restore/${tag//\//_}.bundle" --all >/dev/null 2>&1
echo "Punto de restauración creado: $tag"
git status --short | head -20
