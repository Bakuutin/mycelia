#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER="${CONTAINER:-mycelia-backend-1}"
OUTPUT_FILE=""

usage() {
  cat <<'EOF'
Usage: ./scripts/debug/find-conversations.sh [--write-json [FILE]]

Lists conversation records that should be re-extracted with the current
extractor. Records produced by a current extractor ("v2" legacy two-call or
"merged-v1" single-call) with a complete receipt are considered healthy.
It does not create a JSONL file by default.

Options:
  -j, --write-json [FILE]  Explicitly save matching records as JSONL. Defaults
                           to conversations-to-reextract.jsonl when FILE is omitted.
  -h, --help               Show this help.

Environment:
  CONTAINER                Backend Docker container (default: mycelia-backend-1).
EOF
}

while (( $# > 0 )); do
  case "$1" in
    -j|--write-json)
      if [[ $# -gt 1 && "$2" != -* ]]; then
        OUTPUT_FILE="$2"
        shift
      else
        OUTPUT_FILE="conversations-to-reextract.jsonl"
      fi
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

RESULTS="$(
  docker exec -w /app "$CONTAINER" deno eval '
import { getRootDB } from "./app/lib/mongo/core.server.ts";

const db = await getRootDB();

// Extractor versions whose receipts are considered current. "v2" is the
// legacy two-call extractor, "merged-v1" the single-call merged extractor
// that replaced it (migration 0029). Anything else is stale.
const CURRENT_VERSIONS = ["v2", "merged-v1"];

const rows = await db.collection("objects").find({
  isConversation: true,
  "metadata.extractedWith.chunkId": { $type: "string" },
  $or: [
    { "metadata.extractedWith.extractorVersion": { $nin: CURRENT_VERSIONS } },
    { "metadata.extractedWith.result": { $exists: false } },
    { "icon.text": { $exists: false } },
    {
      // Entity-link mismatch. Only v2 receipts carry these two fields;
      // both $ifNull defaults MUST be equal so documents without them
      // (all merged-v1 receipts) do not match.
      $expr: {
        $ne: [
          {
            $ifNull: [
              "$metadata.extractedWith.result.relationshipsCreated",
              -1
            ]
          },
          {
            $ifNull: [
              "$metadata.extractedWith.result.relationshipsAttempted",
              -1
            ]
          }
        ]
      }
    }
  ]
}, {
  projection: {
    name: 1,
    icon: 1,
    "metadata.extractedWith.chunkId": 1,
    "metadata.extractedWith.extractorVersion": 1,
    "metadata.extractedWith.result": 1
  }
}).toArray();

for (const row of rows) {
  const extracted = row.metadata?.extractedWith ?? {};
  const result = extracted.result ?? {};
  const reasons = [];

  if (!CURRENT_VERSIONS.includes(extracted.extractorVersion)) {
    reasons.push("stale_extractor");
  }

  if (!extracted.result) {
    reasons.push("missing_receipt");
  }

  if (!row.icon?.text) {
    reasons.push("missing_emoji");
  }

  // Only v2 receipts have these counters; skip the check when absent.
  if (
    result.relationshipsCreated !== undefined &&
    result.relationshipsAttempted !== undefined &&
    result.relationshipsCreated !== result.relationshipsAttempted
  ) {
    reasons.push("link_mismatch");
  }

  // The query matched but no rule above explains why (e.g. a receipt with
  // only one of the two link counters). Flag it instead of hiding it.
  if (reasons.length === 0) {
    reasons.push("receipt_anomaly");
  }

  console.log(JSON.stringify({
    chunkId: extracted.chunkId,
    objectId: String(row._id),
    name: row.name ?? "",
    reasons
  }));
}

Deno.exit(0);
' |
  jq -c '
  select(
    (.chunkId | type) == "string"
    and (.chunkId | test("^[0-9a-fA-F]{24}$"))
  )
' |
  awk '!seen[$0]++'
)"

COUNT="$(printf '%s\n' "$RESULTS" | sed '/^$/d' | wc -l | tr -d ' ')"

if [[ -n "$OUTPUT_FILE" ]]; then
  printf '%s\n' "$RESULTS" > "$OUTPUT_FILE"
  echo "Saved ${COUNT} records to ${OUTPUT_FILE}"
else
  echo "Found ${COUNT} records. No JSONL file was created."
  if (( COUNT > 0 )); then
    printf '%s\n' "$RESULTS" | jq -r '[.chunkId, (.reasons | join(",")), .name] | @tsv'
  fi
  echo "To save JSONL explicitly: $0 --write-json [FILE]"
fi
