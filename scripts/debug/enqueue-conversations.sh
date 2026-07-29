#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env}"
INPUT_FILE=""
API_URL="${API_URL:-https://localhost:4433}"

MODEL="${MODEL:-small}"
FALLBACK_MODEL="${FALLBACK_MODEL:-}"
EXTRACTOR_VERSION="${EXTRACTOR_VERSION:-v2}"
TRIGGER_REASON="${TRIGGER_REASON:-historical_v2_metadata_backfill}"

DELAY_SECONDS="${DELAY_SECONDS:-0}"
DRY_RUN="${DRY_RUN:-false}"

usage() {
  cat <<'EOF'
Usage: ./scripts/debug/enqueue-conversations.sh --input FILE [options]

Enqueues selected conversation chunks for v2 extraction. The input JSONL file
must be chosen explicitly; this script never discovers or creates one.

Options:
  -i, --input FILE         JSONL produced by find-conversations.sh (required).
  --dry-run                Print job payloads without enqueuing them.
  -h, --help               Show this help.

Environment:
  ENV_FILE, API_URL, MODEL, FALLBACK_MODEL, EXTRACTOR_VERSION,
  TRIGGER_REASON, DELAY_SECONDS, DRY_RUN
EOF
}

while (( $# > 0 )); do
  case "$1" in
    -i|--input)
      [[ $# -gt 1 ]] || { echo "$1 requires a file path" >&2; exit 2; }
      INPUT_FILE="$2"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

command -v curl >/dev/null || {
  echo "curl is required" >&2
  exit 1
}

command -v jq >/dev/null || {
  echo "jq is required" >&2
  exit 1
}

test -f "$ENV_FILE" || {
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
}

[[ -n "$INPUT_FILE" ]] || {
  echo "Input file is required; use --input FILE" >&2
  usage >&2
  exit 2
}

test -f "$INPUT_FILE" || {
  echo "Input file not found: $INPUT_FILE" >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MYCELIA_CLIENT_ID:?MYCELIA_CLIENT_ID is missing}"
: "${MYCELIA_TOKEN:?MYCELIA_TOKEN is missing}"

echo "Requesting OAuth token..."

TOKEN_RESPONSE="$(
  curl -skS -X POST "${API_URL}/oauth/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "client_id=${MYCELIA_CLIENT_ID}" \
    --data-urlencode "client_secret=${MYCELIA_TOKEN}"
)"

MYCELIA_ACCESS_TOKEN="$(
  jq -r '.access_token // empty' <<<"$TOKEN_RESPONSE"
)"

if [[ -z "$MYCELIA_ACCESS_TOKEN" ]]; then
  echo "OAuth token request failed" >&2
  jq . <<<"$TOKEN_RESPONSE" >&2 2>/dev/null || printf '%s\n' "$TOKEN_RESPONSE" >&2
  exit 1
fi

TOTAL="$(
  jq -sc '
    map(
      select(
        (.chunkId | type) == "string"
        and (.chunkId | test("^[0-9a-fA-F]{24}$"))
      )
    )
    | unique_by(.chunkId)
    | length
  ' "$INPUT_FILE"
)"

echo "Found ${TOTAL} unique chunks in ${INPUT_FILE}"

if (( TOTAL == 0 )); then
  echo "Nothing to enqueue"
  exit 0
fi

SUCCESS=0
FAILED=0
INDEX=0

while IFS= read -r ROW; do
  INDEX=$((INDEX + 1))

  CHUNK_ID="$(jq -r '.chunkId' <<<"$ROW")"
  OBJECT_ID="$(jq -r '.objectId // ""' <<<"$ROW")"
  NAME="$(jq -r '.name // ""' <<<"$ROW")"
  REASONS="$(jq -r '.reasons // [] | join(",")' <<<"$ROW")"

  printf '[%d/%d] chunk=%s object=%s reasons=%s name=%s\n' \
    "$INDEX" \
    "$TOTAL" \
    "$CHUNK_ID" \
    "$OBJECT_ID" \
    "$REASONS" \
    "$NAME"

  PAYLOAD="$(
    jq -n \
      --arg chunkId "$CHUNK_ID" \
      --arg extractorVersion "$EXTRACTOR_VERSION" \
      --arg model "$MODEL" \
      --arg fallbackModel "$FALLBACK_MODEL" \
      --arg reason "$TRIGGER_REASON" \
      '{
        action: "enqueue",
        data: {
          type: "conversation_extractor",
          chunkId: $chunkId,
          force: true,
          extractorVersion: $extractorVersion,
          model: $model,
          fallbackModel: $fallbackModel,
          limit: 1
        },
        trigger: {
          type: "manual",
          reason: $reason
        }
      }'
  )"

  if [[ "$DRY_RUN" == "true" ]]; then
    jq . <<<"$PAYLOAD"
    echo
    continue
  fi

  RESPONSE_FILE="$(mktemp)"

  HTTP_CODE="$(
    curl -skS \
      -o "$RESPONSE_FILE" \
      -w '%{http_code}' \
      -X POST "${API_URL}/api/resource/jobs" \
      -H "Authorization: Bearer ${MYCELIA_ACCESS_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data-binary "$PAYLOAD"
  )" || HTTP_CODE="000"

  if [[ "$HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
    SUCCESS=$((SUCCESS + 1))
    echo "Enqueued, HTTP ${HTTP_CODE}"
    jq . "$RESPONSE_FILE" 2>/dev/null || cat "$RESPONSE_FILE"
  else
    FAILED=$((FAILED + 1))
    echo "Failed, HTTP ${HTTP_CODE}" >&2
    jq . "$RESPONSE_FILE" >&2 2>/dev/null || cat "$RESPONSE_FILE" >&2
  fi

  rm -f "$RESPONSE_FILE"
  echo

  if [[ "$DELAY_SECONDS" != "0" ]]; then
    sleep "$DELAY_SECONDS"
  fi
done < <(
  jq -sc '
    map(
      select(
        (.chunkId | type) == "string"
        and (.chunkId | test("^[0-9a-fA-F]{24}$"))
      )
    )
    | unique_by(.chunkId)
    | .[]
  ' "$INPUT_FILE"
)

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run completed for ${TOTAL} chunks"
  exit 0
fi

echo
echo "Finished"
echo "Successfully enqueued: ${SUCCESS}"
echo "Failed: ${FAILED}"
echo "Total: ${TOTAL}"

(( FAILED == 0 ))
