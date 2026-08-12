#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3001}"
export NEW_SERVER_SQLITE_PATH="${NEW_SERVER_SQLITE_PATH:-$ROOT_DIR/data/new-server-dev.sqlite}"
export INBOUND_AUTH_TOKEN="${INBOUND_AUTH_TOKEN:-dev-inbound-token}"
export BOOTSTRAP_ADMIN_USERNAME="${BOOTSTRAP_ADMIN_USERNAME:-admin}"
export BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-admin-pass-123}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://127.0.0.1:3002}"

mkdir -p "$ROOT_DIR/data"

exec node --watch "$ROOT_DIR/server/src/server.mjs"
