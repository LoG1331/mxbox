#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:3001}"

cd "$ROOT_DIR/frontend"
exec npm run dev -- --host 127.0.0.1 --port 3002 --strictPort
