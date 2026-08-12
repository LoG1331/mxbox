#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3001}"
export NEW_SERVER_SQLITE_PATH="${NEW_SERVER_SQLITE_PATH:-$ROOT_DIR/data/new-server.sqlite}"

: "${INBOUND_AUTH_TOKEN:?INBOUND_AUTH_TOKEN must be set before running npm run start}"

mkdir -p "$ROOT_DIR/data"

exec node "$ROOT_DIR/server/src/server.mjs"
