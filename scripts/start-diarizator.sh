#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
diarizator_dir="${repo_root}/diarizator"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

# HF_TOKEN is required: the pyannote models are license-gated on Hugging Face
# and are downloaded on first start (~1.5 GB).
if [[ -z "${HF_TOKEN:-}" ]]; then
  for env_file in "${diarizator_dir}/.env" "${repo_root}/.env"; do
    if [[ -f "${env_file}" ]] && grep -Eq '^HF_TOKEN=.+$' "${env_file}"; then
      HF_TOKEN="$(grep -E '^HF_TOKEN=' "${env_file}" | tail -1 | cut -d= -f2-)"
      export HF_TOKEN
      break
    fi
  done
fi

if [[ -z "${HF_TOKEN:-}" ]]; then
  cat >&2 <<'EOF'
HF_TOKEN is not set (checked env, diarizator/.env, .env).

The diarizator needs a Hugging Face token with access to the gated models:
  https://huggingface.co/pyannote/speaker-diarization-community-1
  https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM

Accept both licenses, create a token at https://huggingface.co/settings/tokens,
then add HF_TOKEN=hf_... to diarizator/.env or export it in your shell.
EOF
  exit 1
fi

port="${SPEAKER_SERVICE_PORT:-8085}"

echo "Syncing diarizator dependencies (uv sync)..."
cd "${diarizator_dir}"
uv sync --extra cpu

echo
echo "Starting diarizator on port ${port} (CPU mode)."
echo "Smoke check:            curl http://localhost:${port}/health"
echo "Reachable from Docker:  http://host.docker.internal:${port}"
echo "First start downloads ~1.5 GB of models; wait for 'Models ready'."
echo

exec env \
  COMPUTE_MODE="${COMPUTE_MODE:-cpu}" \
  AUDIO_BACKEND="${AUDIO_BACKEND:-soundfile}" \
  SPEAKER_SERVICE_HOST="${SPEAKER_SERVICE_HOST:-0.0.0.0}" \
  SPEAKER_SERVICE_PORT="${port}" \
  uv run simple-speaker-service
