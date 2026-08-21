#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERMISSIONS=(--allow-read)

for arg in "$@"; do
  if [[ "$arg" == "--fix" ]]; then
    PERMISSIONS+=(--allow-write)
    break
  fi
done

exec deno run "${PERMISSIONS[@]}" "$SCRIPT_DIR/check-env.ts" "$@"
