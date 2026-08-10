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

# Persist the same token in the Hugging Face cache without exposing it in the
# command line or logs. Pipeline.from_pretrained still receives HF_TOKEN
# explicitly; this login also covers nested gated model downloads.
uv run python -c 'import os; from huggingface_hub import login; login(token=os.environ["HF_TOKEN"], add_to_git_credential=False, skip_if_logged_in=False)'

if ! uv run python -c 'import os; from huggingface_hub import HfApi; HfApi(token=os.environ["HF_TOKEN"]).model_info("pyannote/speaker-diarization-community-1")' >/dev/null 2>&1; then
  cat >&2 <<'EOF'
HF_TOKEN is valid, but its Hugging Face account cannot access the gated model.
Log in with the same account and accept the model conditions here:
  https://huggingface.co/pyannote/speaker-diarization-community-1
  https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM
Then run scripts/start-diarizator.sh again. Creating a new token is not required.
EOF
  exit 1
fi

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
