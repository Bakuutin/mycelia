from __future__ import annotations

import os
import logging
import threading
import contextvars
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Any, Dict, Optional
import dotenv

from lib.resources import call_resource
from lib.api import job_token_var
from jobs.vad import VadJobData
from jobs.test_python_integration import TestPythonIntegrationJobData

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mycelia Worker Server")


def get_token(authorization: Optional[str] = Header(None)) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ")[1]
    return None


class VadJobRequest(BaseModel):
    jobId: str
    data: VadJobData


class TestPythonIntegrationJobRequest(BaseModel):
    jobId: str
    data: TestPythonIntegrationJobData




def update_progress(job_id: str, job_type: str, progress: Dict[str, Any]):
    """Send progress update back to TypeScript server (non-blocking)"""
    # Capture current context to propagate to the thread
    ctx = contextvars.copy_context()

    print(f"My JWT is {job_token_var.get()}")
    
    # Define the worker function for the thread
    # def _threaded_update():
    #     try:
    call_resource("jobs", {
        "action": "progressUpdate",
        "jobId": job_id,
        "progress": progress,
    })
    #     except Exception as e:
    #         logger.error(f"Failed to update progress: {e}")

    # _threaded_update()

    # Fire and forget - don't block job processing
    # thread = threading.Thread(
    #     target=ctx.run,
    #     args=(_threaded_update,),
    #     daemon=True
    # )
    # thread.start()


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/")
async def root():
    return {
        "service": "Mycelia Worker Server",
        "endpoints": [
            "POST /jobs/vad",
            "POST /jobs/transcription",
            "POST /jobs/diarization",
            "POST /jobs/ingestion",
            "POST /jobs/testPythonIntegration",
        ],
    }


@app.post("/jobs/testPythonIntegration")
async def process_test_python_integration(
    request: TestPythonIntegrationJobRequest,
    token: Optional[str] = Depends(get_token)
):
    """Process test Python integration job and return result"""
    from jobs.test_python_integration import process_test_python_integration_job
    
    logger.info(f"Processing test Python integration job {request.jobId}")

    token_token = None
    if token:
        token_token = job_token_var.set(token)

    try:
        def progress_callback(progress: Dict[str, Any]):
            update_progress(request.jobId, "testPythonIntegration", progress)

        result = process_test_python_integration_job(
            request.jobId,
            request.data,
            progress_callback,
        )

        logger.info(f"Test Python integration job {request.jobId} completed: {result}")
        return result

    except Exception as e:
        logger.exception(f"Test Python integration job {request.jobId} failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if token_token:
            job_token_var.reset(token_token)


@app.post("/jobs/vad")
async def process_vad(
    request: VadJobRequest,
    token: Optional[str] = Depends(get_token)
):
    """Process VAD job and return result"""
    from jobs.vad import process_vad_job

    logger.info(f"Processing VAD job {request.jobId}")

    token_token = None
    if token:
        token_token = job_token_var.set(token)

    try:
        def progress_callback(progress: Dict[str, Any]):
            update_progress(request.jobId, "vad", progress)

        result = process_vad_job(
            request.jobId,
            request.data,
            progress_callback,
        )

        logger.info(f"VAD job {request.jobId} completed: {result}")
        return result

    except Exception as e:
        logger.exception(f"VAD job {request.jobId} failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if token_token:
            job_token_var.reset(token_token)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
