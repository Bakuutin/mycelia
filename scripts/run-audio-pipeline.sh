#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_root}/.env"
pipeline_venv="${UV_PROJECT_ENVIRONMENT:-/private/tmp/mycelia-daemon-venv}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required" >&2
  exit 1
fi

if [[ ! -f "${env_file}" ]]; then
  echo "Missing ${env_file}; copy .env.example to .env and configure it first." >&2
  exit 1
fi

if ! grep -Eq '^STT_SERVER_URL=.+$' "${env_file}"; then
  echo "STT_SERVER_URL is missing from ${env_file}" >&2
  exit 1
fi

if ! grep -Eq '^PROXY_API_KEY=.+$' "${env_file}"; then
  echo "PROXY_API_KEY is missing from ${env_file}" >&2
  exit 1
fi

echo "Starting Mycelia services and the automatic audio pipeline..."
docker compose --project-directory "${repo_root}" up -d

echo "Starting host audio discovery/import. Press Ctrl+C to stop importing."
echo "VAD and transcription continue automatically in the Docker services."
cd "${repo_root}/python"
exec env UV_PROJECT_ENVIRONMENT="${pipeline_venv}" uv run daemon.py "$@"
