#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_root}/.env"
pipeline_venv="${UV_PROJECT_ENVIRONMENT:-/private/tmp/mycelia-daemon-venv}"
uv_bin="${UV_BIN:-$(command -v uv || true)}"

if [[ -z "${uv_bin}" && -x "${HOME}/.local/bin/uv" ]]; then
  uv_bin="${HOME}/.local/bin/uv"
fi

if [[ -z "${uv_bin}" ]]; then
  echo "uv is required" >&2
  exit 1
fi

if [[ ! -f "${env_file}" ]]; then
  echo "Missing ${env_file}; configure it before starting ingestion." >&2
  exit 1
fi

cd "${repo_root}/python"
exec env UV_PROJECT_ENVIRONMENT="${pipeline_venv}" \
  "${uv_bin}" run --env-file "${env_file}" ingestion_server.py
