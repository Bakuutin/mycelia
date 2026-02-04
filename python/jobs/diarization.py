"""Diarization job - runs speaker diarization on audio chunks within a time range."""

import logging
from datetime import datetime
from typing import Any, Callable, Dict, Optional
from pydantic import BaseModel

from diarization_worker import (
    get_diarization_sequences,
    diarize_sequence,
    count_pending_chunks,
)
from lib.worker import get_worker_id

logger = logging.getLogger(__name__)


class DiarizationJobData(BaseModel):
    """Data model for diarization job."""
    start: Optional[datetime] = None  # Filter chunks starting from this time
    end: Optional[datetime] = None  # Filter chunks up to this time


def process_diarization_job(
    job_id: str,
    data: DiarizationJobData,
    progress_callback: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    """
    Process a diarization job for chunks within a time range.
    
    This job runs speaker diarization on audio chunks, combining them into
    sequences and calling the diarization server to identify speakers.
    """
    worker_id = get_worker_id()
    logger.info(f"Starting diarization job {job_id}, worker={worker_id}")
    
    # Build filters from time range
    filters: Dict[str, Any] = {}
    if data.start:
        filters.setdefault("start", {})["$gte"] = data.start
    if data.end:
        filters.setdefault("start", {})["$lte"] = data.end
    
    logger.info(f"Filters: {filters}")
    
    progress_callback({
        "stage": "counting",
        "message": "Counting pending chunks...",
    })
    
    # Count pending chunks
    pending_count = count_pending_chunks(filters if filters else None)
    logger.info(f"Pending chunks: {pending_count}")
    
    if not pending_count:
        return {
            "success": True,
            "message": "No pending chunks to diarize",
            "sequences_processed": 0,
            "chunks_processed": 0,
            "segments_created": 0,
        }
    
    progress_callback({
        "stage": "processing",
        "message": f"Processing {pending_count} pending chunks...",
        "total_chunks": pending_count,
    })
    
    # Process sequences
    sequences_processed = 0
    chunks_processed = 0
    segments_created = 0
    errors = 0
    
    # Get and process sequences
    for sequence in get_diarization_sequences(
        limit=None,  # Process all matching
        filters=filters if filters else None,
        worker_id=worker_id,
    ):
        result = diarize_sequence(sequence, worker_id)
        sequences_processed += 1
        chunks_processed += result.get("chunks_diarized", 0)
        segments_created += result.get("segments", 0)
        
        if result.get("status") == "error":
            errors += 1
        
        # Update progress periodically
        if sequences_processed % 5 == 0:
            progress_callback({
                "stage": "processing",
                "message": f"Processed {sequences_processed} sequences, {chunks_processed} chunks",
                "sequences_processed": sequences_processed,
                "chunks_processed": chunks_processed,
                "segments_created": segments_created,
            })
    
    logger.info(f"Diarization job {job_id} completed: {sequences_processed} sequences, {chunks_processed} chunks, {segments_created} segments")
    
    return {
        "success": True,
        "sequences_processed": sequences_processed,
        "chunks_processed": chunks_processed,
        "segments_created": segments_created,
        "errors": errors,
    }
