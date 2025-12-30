FROM python:3.12-slim

WORKDIR /app

# Install build dependencies for pyaudio and other native packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc-dev \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install uv

COPY python/pyproject.toml python/uv.lock ./

RUN uv export --frozen --no-hashes > /tmp/requirements.txt && \
    uv pip install --system -r /tmp/requirements.txt

COPY python/ .

# Run the worker server
CMD ["uvicorn", "worker_server:app", "--host", "0.0.0.0", "--port", "8000"]

