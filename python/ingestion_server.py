from __future__ import annotations

import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# CLI credentials come from .env; the local API address has a stable nginx
# default and must be set before daemon/lib.config modules are imported.
os.environ.setdefault("MYCELIA_URL", "http://localhost:3210")

from daemon import import_new_files, ingests_missing_sources, initialize_auth
from lib.api import job_token_var
from lib.resources import call_resource

logger = logging.getLogger("ingestion_server")

cycle_lock = threading.Lock()
last_cycle: dict[str, Any] = {"status": "not_started"}


class IngestionJobData(BaseModel):
    type: str = "ingestion"
    limit: int = Field(default=20, ge=1, le=100)


def run_ingestion_cycle(limit: int, job_id: str | None = None) -> dict[str, Any]:
    """Discover and ingest one bounded batch, serializing automatic/manual runs."""
    global last_cycle

    with cycle_lock:
        if job_id:
            call_resource("jobs", {
                "action": "progressUpdate",
                "jobId": job_id,
                "progress": {"phase": "discovery", "processed": 0, "limit": limit},
            })

        import_new_files()

        if job_id:
            call_resource("jobs", {
                "action": "progressUpdate",
                "jobId": job_id,
                "progress": {"phase": "ingestion", "processed": 0, "limit": limit},
            })

        ingests_missing_sources(limit=limit)
        last_cycle = {"status": "completed", "limit": limit}
        return last_cycle.copy()


async def automatic_ingestion_loop() -> None:
    interval = max(1, int(os.getenv("INGESTION_INTERVAL_SECONDS", "10")))
    limit = min(100, max(1, int(os.getenv("INGESTION_BATCH_SIZE", "20"))))
    authenticated = False

    while True:
        try:
            if not authenticated:
                initialize_auth()
                authenticated = True
            await asyncio.to_thread(run_ingestion_cycle, limit)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_cycle.clear()
            last_cycle.update({"status": "failed", "error": str(exc)})
            logger.exception("Automatic ingestion cycle failed")
            authenticated = False
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(automatic_ingestion_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Mycelia Host Ingestion", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "healthy", "automatic": True, "lastCycle": last_cycle}


@app.post("/jobs/ingestion")
async def process_ingestion_job(
    body: dict[str, Any],
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")

    job_id = body.get("jobId")
    if not job_id:
        raise HTTPException(status_code=400, detail="Missing jobId")

    try:
        data = IngestionJobData.model_validate(body.get("data", {}))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid job data: {exc}") from exc

    token_ref = job_token_var.set(authorization.removeprefix("Bearer "))
    try:
        return await asyncio.to_thread(run_ingestion_cycle, data.limit, job_id)
    except Exception as exc:
        logger.exception("Manual ingestion job %s failed", job_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        job_token_var.reset(token_ref)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "ingestion_server:app",
        host="0.0.0.0",
        port=int(os.getenv("INGESTION_WORKER_PORT", "8001")),
    )
