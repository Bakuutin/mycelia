from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration; all public names are prefixed with ``RAG_``."""

    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongo_url: str = "mongodb://localhost:27017/?replicaSet=rs0"
    mongo_database: str = "mycelia"
    require_readonly_mongo: bool = False
    mongo_server_selection_timeout_ms: int = Field(default=5_000, ge=100, le=60_000)

    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: SecretStr | None = None
    state_path: Path = Path("./state/rag-state.sqlite3")
    collection_prefix: str = Field(default="mycelia_rag", pattern=r"^[a-zA-Z0-9_-]+$")

    model_cache: Path = Path("./state/models")
    dense_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    sparse_model: str = "Qdrant/bm25"
    dense_dimensions: int = Field(default=384, ge=8, le=65_536)

    auth_mode: Literal["none", "internal_token"] = "none"
    internal_token: SecretStr | None = None

    enable_background: bool = True
    reconcile_interval_seconds: int = Field(default=900, ge=10)
    change_stream_retry_seconds: float = Field(default=5.0, ge=0.1, le=300)
    batch_size: int = Field(default=64, ge=1, le=1_000)
    chunk_size: int = Field(default=1_200, ge=200, le=20_000)
    chunk_overlap: int = Field(default=160, ge=0, le=5_000)
    qdrant_timeout_seconds: float = Field(default=30.0, ge=1, le=300)

    @model_validator(mode="after")
    def validate_related_settings(self) -> Settings:
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE")
        if self.auth_mode == "internal_token" and not (
            self.internal_token and self.internal_token.get_secret_value()
        ):
            raise ValueError("RAG_INTERNAL_TOKEN is required for RAG_AUTH_MODE=internal_token")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
