#!/usr/bin/env bash
# Starts a local dev server that rebuilds and reloads the page when src/ changes.
# Usage: ./start.sh [port]   (default 8000)
set -euo pipefail
cd "$(dirname "$0")"
exec node dev.js "${1:-${PORT:-8000}}"
