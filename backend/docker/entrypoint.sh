#!/bin/sh
set -eu

SECRETS_FILE="${MYCELIA_SECRETS_FILE:-/run/mycelia/mycelia.env}"

if [ -f "$SECRETS_FILE" ]; then
  # Load only missing variables from secrets file
  # Expected format:
  #   MYCELIA_TOKEN=...
  #   MYCELIA_CLIENT_ID=...
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | \#*) continue ;;
    esac

    key="${line%%=*}"
    value="${line#*=}"

    # Skip malformed lines
    if [ -z "$key" ] || [ "$key" = "$line" ]; then
      continue
    fi

    # Set only if not already set
    eval current="\${$key:-}"
    if [ -z "$current" ]; then
      export "$key=$value"
    fi
  done < "$SECRETS_FILE"
fi

exec "$@"
