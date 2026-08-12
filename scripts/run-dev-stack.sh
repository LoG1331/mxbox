#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/run-server-dev.sh" &
SERVER_PID=$!

"$ROOT_DIR/scripts/run-frontend-dev.sh" &
FRONTEND_PID=$!

cleanup() {
  kill "$SERVER_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait -n "$SERVER_PID" "$FRONTEND_PID"
