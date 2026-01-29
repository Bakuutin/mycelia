from __future__ import annotations

import asyncio
import os
import logging
from contextvars import copy_context
from dataclasses import dataclass
from fastapi import FastAPI, HTTPException, Request, Header, Depends
from pydantic import BaseModel
from typing import Any, Callable, Dict, Optional, Type

from lib.resources import call_resource
from lib.api import job_token_var

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mycelia Worker Server")


@dataclass
class JobDefinition:
    data_model: Type[BaseModel]
    processor: Callable


# Job registry - add new jobs here
JOB_REGISTRY: Dict[str, JobDefinition] = {}


def register_job(name: str, data_model: Type[BaseModel], processor: Callable):
    """Register a job type with its data model and processor"""
    JOB_REGISTRY[name] = JobDefinition(data_model, processor)


def _load_jobs():
    """Load and register all job types"""
    from jobs.vad import VadJobData, process_vad_job
    from jobs.test_python_integration import TestPythonIntegrationJobData, process_test_python_integration_job

    register_job("vad", VadJobData, process_vad_job)
    register_job("testPythonIntegration", TestPythonIntegrationJobData, process_test_python_integration_job)


_load_jobs()


def get_token(authorization: Optional[str] = Header(None)) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ")[1]
    return None


def update_progress(job_id: str, progress: Dict[str, Any]):
    """Send progress update back to TypeScript server"""
    call_resource("jobs", {
        "action": "progressUpdate",
        "jobId": job_id,
        "progress": progress,
    })


async def run_in_thread_with_context(func: Callable, *args) -> Any:
    """Run a sync function in a thread pool while preserving context variables"""
    ctx = copy_context()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: ctx.run(func, *args))


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/")
async def root():
    return {
        "service": "Mycelia Worker Server",
        "endpoints": [f"POST /jobs/{name}" for name in JOB_REGISTRY],
    }


@app.post("/jobs/{job_type}")
async def process_job(
    job_type: str,
    request: Request,
    token: Optional[str] = Depends(get_token),
):
    """Unified job endpoint - validates and processes any registered job type"""
    if job_type not in JOB_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown job type: {job_type}")

    job_def = JOB_REGISTRY[job_type]
    body = await request.json()

    job_id = body.get("jobId")
    if not job_id:
        raise HTTPException(status_code=400, detail="Missing jobId")

    try:
        data = job_def.data_model.model_validate(body.get("data", {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid job data: {e}")

    logger.info(f"Processing {job_type} job {job_id}")

    # Set token in current context before copying to thread
    token_ref = job_token_var.set(token) if token else None

    def run_processor():
        try:
            result = job_def.processor(
                job_id,
                data,
                lambda progress: update_progress(job_id, progress),
            )
            logger.info(f"{job_type} job {job_id} completed: {result}")
            return result
        except Exception as e:
            logger.exception(f"{job_type} job {job_id} failed")
            raise e

    try:
        result = await run_in_thread_with_context(run_processor)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if token_ref:
            job_token_var.reset(token_ref)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
