#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env}"
INPUT_FILE=""
API_URL="${API_URL:-https://localhost:4433}"

MODEL="${MODEL:-small}"
FALLBACK_MODEL="${FALLBACK_MODEL:-}"
JOB_TYPE="${JOB_TYPE:-conversation_extractor_merged}"
TRIGGER_REASON="${TRIGGER_REASON:-historical_merged_backfill}"

DELAY_SECONDS="${DELAY_SECONDS:-0}"
DRY_RUN="${DRY_RUN:-false}"
ASSUME_YES="${ASSUME_YES:-false}"

usage() {
  cat <<'EOF'
Usage: ./scripts/debug/enqueue-conversations.sh --input FILE [options]

Enqueues selected conversation chunks for re-extraction with the merged
extractor (conversation_extractor_merged). The input JSONL file must be
chosen explicitly; this script never discovers or creates one.

DESTRUCTIVE: each job runs with force=true, which DELETES every existing
conversation of the chunk (with its summaries, tags, stars, and manual
edits) before re-extracting. The script asks for confirmation first.

Options:
  -i, --input FILE         JSONL produced by find-conversations.sh (required).
  --dry-run                Print job payloads without enqueuing them.
  -y, --yes                Skip the interactive force confirmation.
  -h, --help               Show this help.

Environment:
  ENV_FILE, API_URL, MODEL, FALLBACK_MODEL, JOB_TYPE,
  TRIGGER_REASON, DELAY_SECONDS, DRY_RUN, ASSUME_YES
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
    -y|--yes)
      ASSUME_YES="true"
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

# Refuse to enqueue into a paused worker: the jobs would be accepted with
# HTTP 200 and then sit invisibly in the paused BullMQ set forever.
WORKER_STATUS="$(
  curl -skS -X POST "${API_URL}/api/resource/jobs" \
    -H "Authorization: Bearer ${MYCELIA_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data-binary '{"action":"get_worker_status"}'
)"

# NB: jq's // operator treats false as empty, so spell the fallback out.
WORKER_PAUSED="$(
  jq -r --arg t "$JOB_TYPE" \
    'if (.workers[$t].paused? | type) == "boolean" then (.workers[$t].paused | tostring) else "unknown" end' \
    <<<"$WORKER_STATUS"
)"

case "$WORKER_PAUSED" in
  false) ;;
  true)
    echo "Worker '${JOB_TYPE}' is PAUSED — enqueued jobs would never run." >&2
    echo "Resume it on the Jobs page (or via resume_worker) and retry." >&2
    exit 1
    ;;
  *)
    echo "Could not determine pause state for worker '${JOB_TYPE}':" >&2
    jq . <<<"$WORKER_STATUS" >&2 2>/dev/null || printf '%s\n' "$WORKER_STATUS" >&2
    exit 1
    ;;
esac

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

if [[ "$DRY_RUN" != "true" && "$ASSUME_YES" != "true" ]]; then
  echo
  echo "WARNING: force=true re-extraction DELETES all existing conversations"
  echo "of each of the ${TOTAL} chunk(s) — including their summaries, tags,"
  echo "stars, and manual edits — before creating new ones."
  printf 'Type "yes" to continue: '
  read -r CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted"
    exit 1
  fi
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

  # The merged extractor's schema rejects unknown fields (e.g. the legacy
  # extractorVersion), so the payload carries only fields it declares.
  # fallbackModel is omitted when empty so the provider route's configured
  # fallback applies.
  PAYLOAD="$(
    jq -n \
      --arg jobType "$JOB_TYPE" \
      --arg chunkId "$CHUNK_ID" \
      --arg model "$MODEL" \
      --arg fallbackModel "$FALLBACK_MODEL" \
      --arg reason "$TRIGGER_REASON" \
      '{
        action: "enqueue",
        data: ({
          type: $jobType,
          chunkId: $chunkId,
          force: true,
          model: $model,
          limit: 1
        } + (if $fallbackModel != "" then { fallbackModel: $fallbackModel } else {} end)),
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
