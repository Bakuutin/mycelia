FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    RAG_STATE_PATH=/data/rag-state.sqlite3 \
    RAG_MODEL_CACHE=/models

WORKDIR /app
COPY --from=builder /app /app

RUN groupadd --system rag && useradd --system --gid rag --home /app rag \
    && mkdir -p /data /models \
    && chown -R rag:rag /app /data /models

USER rag
EXPOSE 8091

CMD ["uvicorn", "mycelia_rag.app:app", "--host", "0.0.0.0", "--port", "8091"]
