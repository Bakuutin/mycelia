FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# System deps (TASK_BREAKDOWN.md): ffmpeg + portaudio
# Plus build tooling for packages like pyaudio
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    portaudio19-dev \
    build-essential \
    pkg-config \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager/runner)
RUN pip install --no-cache-dir uv

# Install deps first for better caching
COPY pyproject.toml uv.lock /app/
RUN uv sync --frozen

# Copy source
COPY . /app

# Allow sourcing generated credentials (MYCELIA_TOKEN / MYCELIA_CLIENT_ID)
RUN chmod +x /app/docker/entrypoint.sh

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["uv", "run", "daemon.py"]
