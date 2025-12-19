from __future__ import annotations

import os
import logging
import threading
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict
import dotenv

dotenv.load_dotenv('../.env', override=True)

from lib.resources import call_resource
from jobs.vad import VadJobData
from jobs.test_python_integration import TestPythonIntegrationJobData

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mycelia Worker Server")


class VadJobRequest(BaseModel):
    jobId: str
    data: VadJobData


class TestPythonIntegrationJobRequest(BaseModel):
    jobId: str
    data: TestPythonIntegrationJobData




def _update_progress_sync(job_id: str, job_type: str, progress: Dict[str, Any]):
    """Internal synchronous function to send progress update"""
    try:
        call_resource("worker_progress", {
            "jobId": job_id,
            "jobType": job_type,
            "progress": progress,
        })
    except Exception as e:
        logger.error(f"Failed to update progress: {e}")


def update_progress(job_id: str, job_type: str, progress: Dict[str, Any]):
    """Send progress update back to TypeScript server (non-blocking)"""
    # Fire and forget - don't block job processing
    thread = threading.Thread(
        target=_update_progress_sync,
        args=(job_id, job_type, progress),
        daemon=True
    )
    thread.start()


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
async def process_test_python_integration(request: TestPythonIntegrationJobRequest):
    """Process test Python integration job and return result"""
    from jobs.test_python_integration import process_test_python_integration_job
    
    logger.info(f"Processing test Python integration job {request.jobId}")

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


@app.post("/jobs/vad")
async def process_vad(request: VadJobRequest):
    """Process VAD job and return result"""
    from jobs.vad import process_vad_job

    logger.info(f"Processing VAD job {request.jobId}")

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


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
