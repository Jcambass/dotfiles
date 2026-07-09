#!/usr/bin/env bash
# Build/cache and run the Bubble Tea Pi status Dock control.

set -euo pipefail

MODE="${1:-all}"
case "$MODE" in
  all|session|tasks|git) ;;
  *) MODE="all" ;;
esac

SCRIPT_PATH="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
SRC_DIR="$SCRIPT_DIR/status-dock"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/pi"
BIN="$CACHE_DIR/status-dock"
STAMP="$CACHE_DIR/status-dock.stamp"

mkdir -p "$CACHE_DIR"

needs_build=0
if [[ ! -x "$BIN" || ! -f "$STAMP" ]]; then
  needs_build=1
elif find "$SRC_DIR" -type f \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) -newer "$STAMP" | grep -q .; then
  needs_build=1
fi

if [[ "$needs_build" -eq 1 ]]; then
  if ! command -v go >/dev/null 2>&1; then
    echo "status-dock requires Go to build the Bubble Tea control" >&2
    exit 1
  fi
  (cd "$SRC_DIR" && go build -o "$BIN" .)
  touch "$STAMP"
fi

exec "$BIN" "$MODE"
