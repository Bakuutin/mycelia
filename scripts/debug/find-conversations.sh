#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER="${CONTAINER:-mycelia-backend-1}"
OUTPUT_FILE=""

usage() {
  cat <<'EOF'
Usage: ./scripts/debug/find-conversations.sh [--write-json [FILE]]

Lists conversation records that should be re-extracted with the v2 extractor.
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

const rows = await db.collection("objects").find({
  isConversation: true,
  "metadata.extractedWith.chunkId": { $type: "string" },
  $or: [
    { "metadata.extractedWith.extractorVersion": { $ne: "v2" } },
    { "metadata.extractedWith.result": { $exists: false } },
    { "icon.text": { $exists: false } },
    {
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
              -2
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

  if (extracted.extractorVersion !== "v2") {
    reasons.push("not_v2");
  }

  if (!extracted.result) {
    reasons.push("missing_receipt");
  }

  if (!row.icon?.text) {
    reasons.push("missing_emoji");
  }

  if (
    result.relationshipsCreated !==
    result.relationshipsAttempted
  ) {
    reasons.push("link_mismatch");
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
