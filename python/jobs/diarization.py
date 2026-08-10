"""Diarization job - runs speaker diarization on audio chunks within a time range."""

import logging
import time
from datetime import datetime
from typing import Any, Callable, Dict, Optional
from pydantic import BaseModel

from diarization_worker import (
    get_diarization_sequences,
    diarize_sequence,
    count_pending_chunks,
)
from lib.worker import get_worker_id
from lib.resources import call_resource

logger = logging.getLogger(__name__)


class DiarizationJobData(BaseModel):
    """Data model for diarization job."""
    start: Optional[datetime] = None  # Filter chunks starting from this time
    end: Optional[datetime] = None  # Filter chunks up to this time
    limit: int = 4
    mode: str = "missing"
    runId: Optional[str] = None
    cursor: Optional[datetime] = None
    diarizationServerUrl: Optional[str] = None


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
    started_at = time.monotonic()
    logger.info(f"Starting diarization job {job_id}, worker={worker_id}")
    
    # Build filters from time range
    filters: Dict[str, Any] = {}
    if data.start:
        filters.setdefault("start", {})["$gte"] = data.start
    if data.end:
        filters.setdefault("start", {})["$lte"] = data.end
    if data.cursor:
        filters.setdefault("start", {})["$gt"] = data.cursor
    
    logger.info(f"Filters: {filters}")
    
    progress_callback({
        "stage": "counting",
        "message": "Counting pending chunks...",
    })
    
    building_generation = data.mode == "build_generation"
    if building_generation and not data.runId:
        raise ValueError("runId is required for build_generation")
    run = None
    if building_generation:
        run = call_resource("mongo", {
            "action": "findOne", "collection": "diarization_runs",
            "query": {"runId": data.runId, "status": "building"},
        })
        if not run:
            raise ValueError("A building diarization run must exist before processing")

    # Re-diarization deliberately includes chunks that already have diarized_at.
    if building_generation:
        pending_count = call_resource("mongo", {
            "action": "count", "collection": "audio_chunks",
            "query": {**filters, "vad.has_speech": True},
        })
    else:
        pending_count = count_pending_chunks(filters if filters else None)
    logger.info(f"Pending chunks: {pending_count}")
    
    if not pending_count:
        if building_generation:
            now = datetime.now().astimezone()
            call_resource("mongo", {"action": "updateMany", "collection": "diarizations", "query": {"runId": data.runId}, "update": {"$set": {"lifecycleStatus": "ready"}}})
            call_resource("mongo", {"action": "updateOne", "collection": "diarization_runs", "query": {"runId": data.runId, "status": "building"}, "update": {"$set": {"status": "ready", "readyAt": now}}})
        return {
            "success": True,
            "message": "No pending chunks to diarize",
            "sequences_processed": 0,
            "chunks_processed": 0,
            "segments_created": 0,
            "processed": 0,
            "hasMore": False,
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
    last_error: Optional[str] = None
    cursor: Optional[datetime] = data.cursor
    
    # Get and process sequences
    for sequence in get_diarization_sequences(
        limit=data.limit,
        filters=filters if filters else None,
        worker_id=worker_id,
        include_diarized=building_generation,
    ):
        result = diarize_sequence(
            sequence,
            worker_id,
            run_id=data.runId or "legacy-v0",
            generation=int((run or {}).get("generation", 0)),
            lifecycle_status="building" if building_generation else "active",
            mark_chunks=not building_generation,
            expected_embedding_space_id=(run or {}).get("embeddingSpaceId") if building_generation else None,
            server_url=data.diarizationServerUrl,
        )
        if building_generation:
            cursor = max(cursor or sequence.start, sequence.last["start"])
        sequences_processed += 1
        chunks_processed += result.get("chunks_diarized", 0)
        segments_created += result.get("segments", 0)
        
        if result.get("status") == "error":
            errors += 1
            last_error = result.get("error") or "Unknown diarization error"
        
        elapsed_seconds = max(time.monotonic() - started_at, 0.0)
        chunks_remaining = max(pending_count - chunks_processed, 0)
        chunks_per_second = (
            chunks_processed / elapsed_seconds
            if chunks_processed > 0 and elapsed_seconds > 0
            else None
        )
        eta_seconds = (
            chunks_remaining / chunks_per_second
            if chunks_per_second and chunks_remaining > 0
            else 0.0 if chunks_per_second else None
        )
        progress_callback({
            "stage": "processing",
            "message": f"Processed {sequences_processed} sequences, {chunks_processed} chunks",
            "total_chunks": pending_count,
            "sequences_processed": sequences_processed,
            "chunks_processed": chunks_processed,
            "chunks_remaining": chunks_remaining,
            "segments_created": segments_created,
            "errors": errors,
            "elapsed_seconds": elapsed_seconds,
            "chunks_per_second": chunks_per_second,
            "eta_seconds": eta_seconds,
        })
    
    if errors > 0 and chunks_processed == 0:
        if building_generation:
            call_resource("mongo", {
                "action": "updateOne", "collection": "diarization_runs",
                "query": {"runId": data.runId, "status": "building"},
                "update": {"$set": {"status": "failed", "failedAt": datetime.now().astimezone(), "errors": [last_error or "Diarization made no progress"]}},
            })
        raise RuntimeError(last_error or "Diarization made no progress")

    if building_generation:
        remaining_filters = dict(filters)
        if cursor:
            remaining_filters["start"] = {"$gt": cursor}
            if data.end:
                remaining_filters["start"]["$lte"] = data.end
        remaining = call_resource("mongo", {
            "action": "count", "collection": "audio_chunks",
            "query": {**remaining_filters, "vad.has_speech": True},
        }) or 0
    else:
        remaining = count_pending_chunks(filters if filters else None) or 0
    if building_generation and remaining == 0:
        now = datetime.now().astimezone()
        call_resource("mongo", {"action": "updateMany", "collection": "diarizations", "query": {"runId": data.runId}, "update": {"$set": {"lifecycleStatus": "ready"}}})
        call_resource("mongo", {"action": "updateOne", "collection": "diarization_runs", "query": {"runId": data.runId, "status": "building"}, "update": {"$set": {"status": "ready", "readyAt": now, "coverage": {"chunks": chunks_processed, "segments": segments_created}, "errors": errors}}})
    logger.info(f"Diarization job {job_id} completed: {sequences_processed} sequences, {chunks_processed} chunks, {segments_created} segments")
    
    return {
        "success": True,
        "sequences_processed": sequences_processed,
        "chunks_processed": chunks_processed,
        "segments_created": segments_created,
        "errors": errors,
        "processed": chunks_processed,
        "hasMore": remaining > 0,
        "cursor": cursor.isoformat() if cursor else None,
    }
