#!/usr/bin/env bash
# Rebuild the CodeForge stack images. Does not start the stack — run
# `docker compose up -d` yourself when ready.
#
# Pass --no-cache to force a full rebuild without Docker's layer cache.
#
# Usage:
#   ./rebuild.sh              # rebuild with cache
#   ./rebuild.sh --no-cache   # full rebuild from scratch

set -euo pipefail

cd "$(dirname "$0")"

echo "[rebuild] Stopping stack..."
docker compose down --remove-orphans

echo "[rebuild] Building images..."
docker compose build "$@"

echo
echo "[rebuild] Done. Next steps:"
echo "  docker compose up -d              # start in background"
echo "  docker compose up                 # start with interleaved logs"
echo "  docker logs -f codeforge-<svc>    # follow one service's logs"
