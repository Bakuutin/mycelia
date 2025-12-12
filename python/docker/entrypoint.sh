#!/bin/sh
set -eu

SECRETS_FILE="${MYCELIA_SECRETS_FILE:-/run/mycelia/mycelia.env}"

if [ -f "$SECRETS_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | \#*) continue ;;
    esac

    key="${line%%=*}"
    value="${line#*=}"

    if [ -z "$key" ] || [ "$key" = "$line" ]; then
      continue
    fi

    eval current="\${$key:-}"
    if [ -z "$current" ]; then
      export "$key=$value"
    fi
  done < "$SECRETS_FILE"
fi

exec "$@"
