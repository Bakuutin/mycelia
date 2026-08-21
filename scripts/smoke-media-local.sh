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
smoke_tmp_dir="$(mktemp -d -t mycelia-media-smoke.XXXXXX)"
trap 'rm -rf "$smoke_tmp_dir"' EXIT

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

analysis="$(resource media '{"action":"analyzeSource","relativePath":"."}')"
import_id="$(printf '%s' "$analysis" | jq -r '.importId | if type == "object" then .["$oid"] else . end // empty')"
if [[ -z "$import_id" ]]; then
  printf '%s\n' "$analysis" | jq . >&2
  exit 1
fi

confirmation="$(resource media "{\"action\":\"confirmImport\",\"importId\":\"$import_id\",\"consent\":true,\"queueRecognition\":false}")"
asset_id="$(printf '%s' "$confirmation" | jq -r '.created[0].assetId | if type == "object" then .["$oid"] else . end // empty')"
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

preview_file="$smoke_tmp_dir/mounted-preview.webp"
curl -fsS "$base_url$preview_path" -H "Authorization: Bearer $jwt" -o "$preview_file"
preview_probe="$(ffprobe -v error -show_entries stream=codec_name,width,height -of json "$preview_file")"
preview_sha256="$(shasum -a 256 "$preview_file" | awk '{print $1}')"

managed_source="$smoke_tmp_dir/managed-upload.png"
ffmpeg -v error -f lavfi -i color=c=blue:s=64x48 -frames:v 1 -y "$managed_source"
managed_source_sha256="$(shasum -a 256 "$managed_source" | awk '{print $1}')"
managed_analysis="$(curl -fsS -X POST "$base_url/api/media/imports/analyze" \
  -H "Authorization: Bearer $jwt" \
  -F "files=@$managed_source;type=image/png")"
managed_import_id="$(printf '%s' "$managed_analysis" | jq -r '.importId | if type == "object" then .["$oid"] else . end // empty')"
if [[ -z "$managed_import_id" ]]; then
  printf '%s\n' "$managed_analysis" | jq . >&2
  exit 1
fi
managed_confirmation="$(resource media "{\"action\":\"confirmImport\",\"importId\":\"$managed_import_id\",\"consent\":true,\"queueRecognition\":false}")"
managed_asset_id="$(printf '%s' "$managed_confirmation" | jq -r '.created[0].assetId | if type == "object" then .["$oid"] else . end // empty')"
if [[ -z "$managed_asset_id" ]]; then
  printf '%s\n' "$managed_confirmation" | jq . >&2
  exit 1
fi
managed_asset="$(resource media "{\"action\":\"getAsset\",\"assetId\":\"$managed_asset_id\"}")"
managed_original_id="$(printf '%s' "$managed_asset" | jq -r '.asset.managedOriginal.fileId | if type == "object" then .["$oid"] else . end // empty')"
managed_download="$smoke_tmp_dir/managed-download.png"
curl -fsS "$base_url/api/files/$managed_original_id?bucket=media_originals" \
  -H "Authorization: Bearer $jwt" -o "$managed_download"
managed_download_sha256="$(shasum -a 256 "$managed_download" | awk '{print $1}')"
if [[ "$managed_source_sha256" != "$managed_download_sha256" ]]; then
  echo "Managed original hash mismatch" >&2
  exit 1
fi

duplicate_analysis="$(curl -fsS -X POST "$base_url/api/media/imports/analyze" \
  -H "Authorization: Bearer $jwt" \
  -F "files=@$managed_source;type=image/png")"
duplicate_id="$(printf '%s' "$duplicate_analysis" | jq -r '.items[0].duplicateAssetId | if type == "object" then .["$oid"] else . end // empty')"
if [[ "$duplicate_id" != "$managed_asset_id" ]]; then
  printf '%s\n' "$duplicate_analysis" | jq . >&2
  exit 1
fi

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
  --arg managedImportId "$managed_import_id" \
  --arg managedAssetId "$managed_asset_id" \
  --arg managedStorageMode "$(printf '%s' "$managed_asset" | jq -r '.asset.storageMode')" \
  --arg managedOriginalId "$managed_original_id" \
  --arg managedOriginalSha256 "$managed_download_sha256" \
  --arg duplicateAssetId "$duplicate_id" \
  '{mounted:{importId:$importId,assetId:$assetId,status:$status,storageMode:$storageMode,sourcePath:$sourcePath,previewPath:$previewPath,thumbnailPath:$thumbnailPath,previewSha256:$previewSha256,preview:$preview},managed:{importId:$managedImportId,assetId:$managedAssetId,storageMode:$managedStorageMode,originalId:$managedOriginalId,originalSha256:$managedOriginalSha256,duplicateAssetId:$duplicateAssetId}}'
