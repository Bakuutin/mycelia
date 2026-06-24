FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WHISPER_HOST=0.0.0.0 \
    WHISPER_PORT=9000 \
    WHISPER_CACHE_DIR=/models

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY python/whisper_server /app

RUN uv pip install --system .

EXPOSE 9000
VOLUME ["/models"]

CMD ["mycelia-whisper-server"]
