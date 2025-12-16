from __future__ import annotations

import os
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict
import requests

from jobs.vad import VadJobData

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mycelia Worker Server")

MYCELIA_URL = os.environ.get("MYCELIA_URL", "http://localhost:3000")
MYCELIA_API_KEY = os.environ.get("MYCELIA_API_KEY")


class JobRequest(BaseModel):
    jobId: str
    data: VadJobData




def update_progress(job_id: str, job_type: str, progress: Dict[str, Any]):
    """Send progress update back to TypeScript server"""
    try:
        response = requests.post(
            f"{MYCELIA_URL}/api/resource/worker_progress",
            json={
                "jobId": job_id,
                "jobType": job_type,
                "progress": progress,
            },
            headers={
                "Authorization": f"Bearer {MYCELIA_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=5,
        )
        response.raise_for_status()
    except Exception as e:
        logger.error(f"Failed to update progress: {e}")


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
        ],
    }


@app.post("/jobs/vad")
async def process_vad(request: JobRequest):
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
