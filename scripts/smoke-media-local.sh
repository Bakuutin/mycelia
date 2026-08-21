#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(
  docker compose
  --env-file "$root_dir/.env.media.local"
  -f "$root_dir/docker-compose.yml"
  -f "$root_dir/docker-compose.media-dev.yml"
)
base_url="${MEDIA_SMOKE_BASE_URL:-http://127.0.0.1:3211}"
smoke_owner="media-smoke-$(date +%s)-$$"

credentials="$(${compose[@]} exec -T backend deno run -A server.ts token-create \
  --owner "$smoke_owner" --name media-local-smoke)"
client_id="$(printf '%s\n' "$credentials" | sed -n 's/^MYCELIA_CLIENT_ID=//p' | tail -1)"
client_secret="$(printf '%s\n' "$credentials" | sed -n 's/^MYCELIA_TOKEN=//p' | tail -1)"
if [[ -z "$client_id" || -z "$client_secret" ]]; then
  echo "Could not create isolated smoke-test credentials" >&2
  exit 1
fi

token_response="$(curl -fsS -X POST "$base_url/oauth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$client_id" \
  --data-urlencode "client_secret=$client_secret")"
jwt="$(printf '%s' "$token_response" | jq -r '.access_token // empty')"
if [[ -z "$jwt" ]]; then
  echo "Could not exchange isolated smoke-test credentials" >&2
  exit 1
fi

resource() {
  local name="$1"
  local payload="$2"
  curl -fsS -X POST "$base_url/api/resource/$name" \
    -H "Authorization: Bearer $jwt" \
    -H 'Content-Type: application/json' \
    --data "$payload"
}

resource config '{"action":"patch","path":"mediaKnowledge","updates":{"enabled":true}}' >/dev/null
analysis="$(resource media '{"action":"analyzeSource","relativePath":"."}')"
import_id="$(printf '%s' "$analysis" | jq -r '.importId["$oid"] // .importId // empty')"
if [[ -z "$import_id" ]]; then
  printf '%s\n' "$analysis" | jq . >&2
  exit 1
fi

confirmation="$(resource media "{\"action\":\"confirmImport\",\"importId\":\"$import_id\",\"consent\":true,\"queueRecognition\":false}")"
asset_id="$(printf '%s' "$confirmation" | jq -r '.created[0].assetId["$oid"] // .created[0].assetId // empty')"
if [[ -z "$asset_id" ]]; then
  printf '%s\n' "$confirmation" | jq . >&2
  exit 1
fi

asset="$(resource media "{\"action\":\"getAsset\",\"assetId\":\"$asset_id\"}")"
preview_path="$(printf '%s' "$asset" | jq -r '.asset.previewUrl // .previewUrl // empty')"
thumbnail_path="$(printf '%s' "$asset" | jq -r '.asset.thumbnailUrl // .thumbnailUrl // empty')"
if [[ -z "$preview_path" ]]; then
  printf '%s\n' "$asset" | jq . >&2
  exit 1
fi

preview_file="$(mktemp -t mycelia-media-preview.XXXXXX.webp)"
trap 'rm -f "$preview_file"' EXIT
curl -fsS "$base_url$preview_path" -H "Authorization: Bearer $jwt" -o "$preview_file"
preview_probe="$(ffprobe -v error -show_entries stream=codec_name,width,height -of json "$preview_file")"
preview_sha256="$(shasum -a 256 "$preview_file" | awk '{print $1}')"

jq -n \
  --arg importId "$import_id" \
  --arg assetId "$asset_id" \
  --arg status "$(printf '%s' "$asset" | jq -r '.asset.status // .status')" \
  --arg storageMode "$(printf '%s' "$asset" | jq -r '.asset.storageMode // .storageMode')" \
  --arg sourcePath "$(printf '%s' "$asset" | jq -r '.asset.source.relativePath // .source.relativePath')" \
  --arg previewPath "$preview_path" \
  --arg thumbnailPath "$thumbnail_path" \
  --arg previewSha256 "$preview_sha256" \
  --argjson preview "$preview_probe" \
  '{importId:$importId,assetId:$assetId,status:$status,storageMode:$storageMode,sourcePath:$sourcePath,previewPath:$previewPath,thumbnailPath:$thumbnailPath,previewSha256:$previewSha256,preview:$preview}'
