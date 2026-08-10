"""Diarization job - runs speaker diarization on audio chunks within a time range."""

import logging
import math
import time
from datetime import datetime
from typing import Any, Callable, Dict, Optional
from pydantic import BaseModel
from bson import ObjectId

from diarization_worker import (
    get_diarization_sequences,
    diarize_sequence,
    count_pending_chunks,
    MAX_SEQUENCE_CHUNKS,
)
from lib.worker import get_worker_id
from lib.resources import call_resource

logger = logging.getLogger(__name__)


def campaign_rate_estimate(samples: list[float]) -> Optional[float]:
    recent = [float(value) for value in samples[-10:] if value > 0]
    if len(recent) < 2:
        return None
    estimate = recent[0]
    for value in recent[1:]:
        estimate = 0.35 * value + 0.65 * estimate
    return estimate


class DiarizationJobData(BaseModel):
    """Data model for diarization job."""
    start: Optional[datetime] = None  # Filter chunks starting from this time
    end: Optional[datetime] = None  # Filter chunks up to this time
    limit: int = 4
    batchSize: Optional[int] = None
    mode: str = "missing"
    runId: Optional[str] = None
    cursor: Optional[datetime] = None
    diarizationServerUrl: Optional[str] = None
    campaignId: Optional[str] = None
    originalId: Optional[str] = None


def _campaign_call(request: Dict[str, Any]) -> Any:
    """Campaign telemetry must not discard completed diarization work."""
    try:
        return call_resource("mongo", request)
    except Exception as exc:
        logger.warning("Could not persist diarization campaign telemetry: %s", exc)
        return None


def _update_campaign(campaign_id: str, fields: Dict[str, Any]) -> None:
    _campaign_call({
        "action": "updateOne",
        "collection": "diarization_campaigns",
        "query": {"campaignId": campaign_id},
        "update": {"$set": {**fields, "updatedAt": datetime.now().astimezone()}},
        "options": {"upsert": True},
    })


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
    if data.originalId:
        filters["original_id"] = ObjectId(data.originalId)
    
    logger.info(f"Filters: {filters}")
    
    campaign_id = data.campaignId or f"diarization-{job_id}"
    campaign = _campaign_call({
        "action": "findOne",
        "collection": "diarization_campaigns",
        "query": {"campaignId": campaign_id},
    }) or {}
    if not campaign:
        progress_callback({
            "stage": "counting",
            "message": "Counting pending chunks...",
            "campaignId": campaign_id,
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

    # Count once when a campaign starts. Continuations use the fixed campaign
    # total instead of scanning the entire historical backlog between batches.
    if campaign:
        pending_count = max(
            int(campaign.get("totalChunks", 0))
            - int(campaign.get("processedChunks", 0)),
            0,
        )
    # Re-diarization deliberately includes chunks that already have diarized_at.
    elif building_generation:
        pending_count = call_resource("mongo", {
            "action": "count", "collection": "audio_chunks",
            "query": {**filters, "vad.has_speech": True},
        })
    else:
        pending_count = count_pending_chunks(filters if filters else None)
    logger.info(f"Pending chunks: {pending_count}")

    total_chunks = int(campaign.get("totalChunks", pending_count or 0))
    cumulative_chunks = int(campaign.get("processedChunks", 0))
    cumulative_sequences = int(campaign.get("processedSequences", 0))
    cumulative_segments = int(campaign.get("segmentsCreated", 0))
    cumulative_errors = int(campaign.get("errorCount", 0))
    previous_errors = list(campaign.get("errors", []))[-100:]
    previous_rate_samples = [
        float(value) for value in campaign.get("rateSamples", [])[-9:]
        if value is not None and float(value) > 0
    ]
    effective_batch_size = data.batchSize or data.limit
    job_ids = [str(value) for value in campaign.get("jobIds", [])]
    if job_id not in job_ids:
        job_ids.append(job_id)
    batch_number = len(job_ids)
    estimated_batches = max(
        batch_number,
        math.ceil(total_chunks / max(effective_batch_size * MAX_SEQUENCE_CHUNKS, 1)),
    ) if total_chunks else batch_number
    _update_campaign(campaign_id, {
        "campaignId": campaign_id,
        "mode": data.mode,
        "runId": data.runId,
        "range": {"start": data.start, "end": data.end},
        "originalId": data.originalId,
        "route": data.diarizationServerUrl,
        "status": "running",
        "totalChunks": total_chunks,
        "processedChunks": cumulative_chunks,
        "processedSequences": cumulative_sequences,
        "segmentsCreated": cumulative_segments,
        "errorCount": cumulative_errors,
        "currentJobId": job_id,
        "firstJobId": campaign.get("firstJobId", job_id),
        "jobIds": job_ids,
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
        "startedAt": campaign.get("startedAt", datetime.now().astimezone()),
    })
    
    if not pending_count:
        final_empty_status = (
            "completed_with_errors" if cumulative_errors > 0 else "completed"
        )
        _update_campaign(campaign_id, {
            "status": final_empty_status,
            "pendingChunks": 0,
            "finishedAt": datetime.now().astimezone(),
        })
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
            "campaignId": campaign_id,
            "errorCount": cumulative_errors,
            "errors": [],
            "successfulSequences": 0,
            "failedSequences": 0,
        }
    
    progress_callback({
        "stage": "processing",
        "message": f"Processing {pending_count} pending chunks...",
        "total_chunks": total_chunks,
        "chunks_processed": cumulative_chunks,
        "chunks_remaining": max(total_chunks - cumulative_chunks, 0),
        "campaignId": campaign_id,
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
    })
    
    # Process sequences
    sequences_processed = 0
    chunks_processed = 0
    segments_created = 0
    errors = 0
    error_details: list[Dict[str, Any]] = []
    successful_sequences = 0
    failed_sequences = 0
    last_error: Optional[str] = None
    cursor: Optional[datetime] = data.cursor
    elapsed_seconds = 0.0
    
    # Get and process sequences
    for sequence in get_diarization_sequences(
        limit=effective_batch_size,
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
        sequences_processed += 1
        chunks_processed += result.get("chunks_diarized", 0)
        segments_created += result.get("segments", 0)
        
        if result.get("status") == "error":
            errors += 1
            failed_sequences += 1
            last_error = result.get("error") or "Unknown diarization error"
            detail = result.get("errorDetail")
            if isinstance(detail, dict):
                error_details.append(detail)
            # A generation cursor must never advance past failed source audio.
            # The next continuation can safely retry because segment writes are
            # idempotent inside a run.
            if building_generation:
                break
        else:
            successful_sequences += 1
            if building_generation:
                cursor = max(cursor or sequence.start, sequence.last["start"])
        
        elapsed_seconds = max(time.monotonic() - started_at, 0.0)
        campaign_processed = cumulative_chunks + chunks_processed
        chunks_remaining = max(total_chunks - campaign_processed, 0)
        batch_rate = (
            chunks_processed / elapsed_seconds
            if chunks_processed > 0 and elapsed_seconds > 0
            else None
        )
        rate_samples = previous_rate_samples + ([batch_rate] if batch_rate else [])
        smoothed_rate = campaign_rate_estimate(rate_samples)
        eta_seconds = (
            chunks_remaining / smoothed_rate
            if smoothed_rate and chunks_remaining > 0
            else 0.0 if smoothed_rate else None
        )
        progress_callback({
            "stage": "processing",
            "message": f"Processed {sequences_processed} sequences, {chunks_processed} chunks",
            "total_chunks": total_chunks,
            "sequences_processed": cumulative_sequences + sequences_processed,
            "chunks_processed": campaign_processed,
            "chunks_remaining": chunks_remaining,
            "segments_created": cumulative_segments + segments_created,
            "errors": cumulative_errors + errors,
            "errorCount": cumulative_errors + errors,
            "campaignId": campaign_id,
            "batchNumber": batch_number,
            "estimatedBatches": estimated_batches,
            "elapsed_seconds": elapsed_seconds,
            "chunks_per_second": smoothed_rate or batch_rate,
            "current_chunks_per_second": batch_rate,
            "eta_seconds": eta_seconds,
            "eta_confidence": "medium" if len(rate_samples) >= 5 else "low",
        })
        _update_campaign(campaign_id, {
            "status": "running",
            "currentJobId": job_id,
            "processedChunks": campaign_processed,
            "processedSequences": cumulative_sequences + sequences_processed,
            "segmentsCreated": cumulative_segments + segments_created,
            "pendingChunks": chunks_remaining,
            "errorCount": cumulative_errors + errors,
            "etaSeconds": eta_seconds,
            "chunksPerSecond": smoothed_rate or batch_rate,
            "currentChunksPerSecond": batch_rate,
            "lastCursor": cursor,
        })
    
    if errors > 0 and chunks_processed == 0:
        retryable_failure = any(
            bool(detail.get("retryable")) for detail in error_details
        )
        _update_campaign(campaign_id, {
            "status": "interrupted" if building_generation or retryable_failure else "failed",
            "errorCount": cumulative_errors + errors,
            "errors": (previous_errors + error_details)[-100:],
            "nextRetryAt": next(
                (detail.get("retryAt") for detail in error_details if detail.get("retryAt")),
                None,
            ),
            "lastCursor": cursor,
        })
        raise RuntimeError(last_error or "Diarization made no progress")

    remaining = max(
        total_chunks - (cumulative_chunks + chunks_processed),
        0,
    )
    if building_generation and remaining == 0:
        now = datetime.now().astimezone()
        call_resource("mongo", {"action": "updateMany", "collection": "diarizations", "query": {"runId": data.runId}, "update": {"$set": {"lifecycleStatus": "ready"}}})
        call_resource("mongo", {"action": "updateOne", "collection": "diarization_runs", "query": {"runId": data.runId, "status": "building"}, "update": {"$set": {"status": "ready", "readyAt": now, "coverage": {"chunks": cumulative_chunks + chunks_processed, "segments": cumulative_segments + segments_created}, "errors": cumulative_errors + errors}}})
    final_status = (
        "running" if remaining > 0
        else "completed_with_errors" if cumulative_errors + errors > 0
        else "completed"
    )
    final_elapsed = elapsed_seconds
    final_batch_rate = (
        chunks_processed / final_elapsed
        if chunks_processed > 0 and final_elapsed > 0
        else None
    )
    final_rate_samples = (
        previous_rate_samples + ([final_batch_rate] if final_batch_rate else [])
    )[-10:]
    _update_campaign(campaign_id, {
        "status": final_status,
        "processedChunks": cumulative_chunks + chunks_processed,
        "processedSequences": cumulative_sequences + sequences_processed,
        "segmentsCreated": cumulative_segments + segments_created,
        "pendingChunks": remaining,
        "errorCount": cumulative_errors + errors,
        "errors": (previous_errors + error_details)[-100:],
        "finishedAt": datetime.now().astimezone() if remaining == 0 else None,
        "lastCursor": cursor,
        "rateSamples": final_rate_samples,
    })
    logger.info(f"Diarization job {job_id} completed: {sequences_processed} sequences, {chunks_processed} chunks, {segments_created} segments")
    
    return {
        "success": True,
        "sequences_processed": sequences_processed,
        "chunks_processed": chunks_processed,
        "segments_created": segments_created,
        "errorCount": errors,
        "errors": error_details,
        "successfulSequences": successful_sequences,
        "failedSequences": failed_sequences,
        "processed": chunks_processed,
        "hasMore": remaining > 0,
        "cursor": cursor.isoformat() if cursor else None,
        "campaignId": campaign_id,
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
    }
