"""Diarization job - runs speaker diarization on audio chunks within a time range."""

import logging
import math
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable, Dict, Optional
from pydantic import BaseModel, Field
from bson import ObjectId

from diarization_worker import (
    get_diarization_recording_candidates,
    get_diarization_sequences,
    diarize_sequence,
    prepare_diarization_sequence,
    PreparedDiarizationSequence,
    count_pending_chunks,
    get_speaker_profiles_snapshot,
    MAX_SEQUENCE_CHUNKS,
)
from lib.worker import get_worker_id
from lib.resources import call_resource, call_resource_once
from lib.api import create_session, job_session_var, job_token_var
from lib.diarization_runtime import (
    RecordingLease,
    acquire_recording_lease,
    aggregate_stage_timings,
    is_job_cancelled,
    job_cancel_event_var,
    new_provider_session,
    release_recording_leases,
    renew_recording_lease,
)

logger = logging.getLogger(__name__)


def parse_diarization_prefetch_sequences(raw: Optional[str] = None) -> int:
    """Parse the bounded lookahead switch; values other than 0/1 are invalid."""
    value = (
        os.environ.get("DIARIZATION_PREFETCH_SEQUENCES", "0")
        if raw is None
        else raw
    )
    if value not in {"0", "1"}:
        raise ValueError("DIARIZATION_PREFETCH_SEQUENCES must be exactly 0 or 1")
    return int(value)


DIARIZATION_PREFETCH_SEQUENCES = parse_diarization_prefetch_sequences()


def diarization_claim_owner(job_id: str) -> str:
    """Return a claim owner that is unique to one concurrent BullMQ job."""
    return f"{get_worker_id()}:job:{job_id}"


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
    # Legacy queued/manual jobs used `limit` values up to 100. Keep accepting
    # those payloads, but cap the effective per-job sequence batch below.
    limit: int = Field(default=4, ge=1, le=100)
    batchSize: Optional[int] = Field(default=None, ge=1, le=32)
    mode: str = "missing"
    runId: Optional[str] = None
    cursor: Optional[datetime] = None
    diarizationServerUrl: Optional[str] = None
    campaignId: Optional[str] = None
    originalId: Optional[str] = None
    routingContext: Optional[Dict[str, Any]] = None
    maxSequenceChunks: Optional[int] = Field(default=None, ge=1, le=32)


def is_diarization_route_enabled(provider_profile_id: Optional[str]) -> bool:
    """Return whether the snapshotted route still accepts external calls."""
    if not provider_profile_id:
        # Legacy jobs without a provider snapshot keep their historical
        # behavior. New provider-routed jobs always carry this field.
        return True

    try:
        config = call_resource("config", {"action": "get"}) or {}
    except Exception as exc:
        # A transient config read must not interrupt a healthy inference call.
        # The next sequence checks again, so an explicit disable still takes
        # effect as soon as config storage recovers.
        logger.warning(
            "Could not verify diarization route %s; allowing this sequence: %s",
            provider_profile_id,
            exc,
        )
        return True

    routes = config.get("diarizationProfiles") or {}
    if provider_profile_id == "environment":
        return bool(routes.get("includeEnvironment", True))

    for profile in routes.get("profiles", []):
        if str(profile.get("id")) == provider_profile_id:
            return bool(profile.get("enabled", True))
    return False


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


def _initialize_campaign(
    campaign_id: str,
    fields: Dict[str, Any],
    *,
    job_id: str,
) -> None:
    """Create campaign counters once without overwriting concurrent progress."""
    now = datetime.now().astimezone()
    _campaign_call({
        "action": "updateOne",
        "collection": "diarization_campaigns",
        "query": {"campaignId": campaign_id},
        "update": {
            "$set": {**fields, "updatedAt": now},
            "$setOnInsert": {
                "processedChunks": 0,
                "processedSequences": 0,
                "segmentsCreated": 0,
                "errorCount": 0,
                "startedAt": now,
            },
            "$addToSet": {"jobIds": job_id},
        },
        "options": {"upsert": True, "touchUpdatedAt": False},
    })


def _record_job_rate_sample(
    *,
    job_id: str,
    campaign_id: str,
    route: Optional[str],
    provider_profile_id: Optional[str],
    started_at: datetime,
    finished_at: datetime,
    status: str,
    duration_seconds: float,
    chunks_processed: int,
    audio_seconds_processed: float,
    segments_created: int,
    successful_sequences: int,
    failed_sequences: int,
    skipped_sequences: int,
    recording_lease_busy_originals: int,
    recording_lease_skipped_sequences: int,
    chunk_claim_skips: int,
    stage_timings_ms: dict[str, dict[str, float]],
) -> None:
    chunks_per_second = (
        chunks_processed / duration_seconds
        if chunks_processed > 0 and duration_seconds > 0
        else None
    )
    audio_realtime_factor = (
        audio_seconds_processed / duration_seconds
        if audio_seconds_processed > 0 and duration_seconds > 0
        else None
    )
    sample = {
        "campaignId": campaign_id,
        "route": route,
        "providerProfileId": provider_profile_id,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "durationSeconds": duration_seconds,
        "status": status,
        "chunksProcessed": chunks_processed,
        "audioSecondsProcessed": audio_seconds_processed,
        "segmentsCreated": segments_created,
        "successfulSequences": successful_sequences,
        "failedSequences": failed_sequences,
        "skippedSequences": skipped_sequences,
        "recordingLeaseBusyOriginals": recording_lease_busy_originals,
        "recordingLeaseSkippedSequences": recording_lease_skipped_sequences,
        "chunkClaimSkips": chunk_claim_skips,
        "stageTimingsMs": stage_timings_ms,
        "chunksPerSecond": chunks_per_second,
        "audioRealtimeFactor": audio_realtime_factor,
    }
    _campaign_call({
        "action": "updateOne",
        "collection": "diarization_campaign_rate_samples",
        "query": {"_id": job_id},
        "update": {"$set": sample},
        "options": {"upsert": True},
    })

    # The marker and increments share one Mongo update, so a retried callback
    # cannot double-count the same BullMQ job.
    _campaign_call({
        "action": "updateOne",
        "collection": "diarization_campaigns",
        "query": {
            "campaignId": campaign_id,
            "accountedJobIds": {"$ne": job_id},
        },
        "update": {
            "$inc": {
                "processedChunks": chunks_processed,
                "processedSequences": successful_sequences + failed_sequences,
                "segmentsCreated": segments_created,
                "errorCount": failed_sequences,
            },
            "$addToSet": {"accountedJobIds": job_id},
            "$set": {"updatedAt": finished_at},
        },
        "options": {"touchUpdatedAt": False},
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
    worker_id = diarization_claim_owner(job_id)
    started_at = time.monotonic()
    job_started_at = datetime.now().astimezone()
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

    cumulative_chunks = int(campaign.get("processedChunks", 0))
    cumulative_sequences = int(campaign.get("processedSequences", 0))
    cumulative_segments = int(campaign.get("segmentsCreated", 0))
    cumulative_errors = int(campaign.get("errorCount", 0))

    # Continuations reuse the persisted campaign total. Recounting a large
    # historical backlog in every concurrent job delays the external GPU
    # requests and turns a six-slot pool into a staggered ramp. The total is a
    # progress estimate; actual continuation is still decided by claimed work.
    count_warning: Optional[str] = None
    campaign_total = campaign.get("totalChunks") if campaign else None
    try:
        if campaign and campaign_total is not None:
            pending_count: Optional[int] = max(
                int(campaign_total) - int(campaign.get("processedChunks", 0)),
                0,
            )
        # Re-diarization deliberately includes chunks that already have diarized_at.
        elif building_generation:
            pending_count = call_resource("mongo", {
                "action": "count", "collection": "audio_chunks",
                "query": {**filters, "vad.has_speech": True},
                "options": {
                    "hint": "audio_chunks_diarization_coverage_v1",
                    "maxTimeMS": 5_000,
                },
            })
        else:
            pending_count = count_pending_chunks(filters if filters else None)
    except Exception as exc:
        pending_count = None
        count_warning = str(exc)
        logger.warning(
            "Pending count unavailable after bounded query; processing will continue: %s",
            exc,
        )
    logger.info(f"Pending chunks: {pending_count}")

    total_chunks: Optional[int] = (
        int(campaign_total)
        if building_generation and campaign_total is not None
        else cumulative_chunks + int(pending_count)
        if pending_count is not None
        else None
    )
    previous_errors = list(campaign.get("errors", []))[-100:]
    previous_rate_samples = [
        float(value) for value in campaign.get("rateSamples", [])[-9:]
        if value is not None and float(value) > 0
    ]
    effective_batch_size = data.batchSize or min(data.limit, 32)
    effective_max_sequence_chunks = data.maxSequenceChunks or MAX_SEQUENCE_CHUNKS
    job_ids = [str(value) for value in campaign.get("jobIds", [])]
    if job_id not in job_ids:
        job_ids.append(job_id)
    batch_number = len(job_ids)
    estimated_batches = max(
        batch_number,
        math.ceil(
            total_chunks
            / max(effective_batch_size * effective_max_sequence_chunks, 1)
        ),
    ) if total_chunks is not None and total_chunks > 0 else batch_number
    _initialize_campaign(campaign_id, {
        "campaignId": campaign_id,
        "mode": data.mode,
        "runId": data.runId,
        "range": {"start": data.start, "end": data.end},
        "originalId": data.originalId,
        "route": data.diarizationServerUrl,
        "status": "running",
        "totalChunks": total_chunks,
        "totalEstimated": total_chunks is None,
        "countWarning": count_warning,
        "currentJobId": job_id,
        "firstJobId": campaign.get("firstJobId", job_id),
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
    }, job_id=job_id)
    
    if pending_count == 0:
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
        "message": (
            f"Processing {pending_count} pending chunks..."
            if pending_count is not None
            else "Processing pending chunks..."
        ),
        "total_chunks": total_chunks,
        "total_estimated": total_chunks is None,
        "count_warning": count_warning,
        "chunks_processed": cumulative_chunks,
        "chunks_remaining": (
            max(total_chunks - cumulative_chunks, 0)
            if total_chunks is not None
            else None
        ),
        "campaignId": campaign_id,
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
        "batch_sequences_processed": 0,
        "batch_sequences_total": effective_batch_size,
        "batch_chunks_processed": 0,
        "worker_chunks_per_second": None,
    })
    
    # Production jobs always use original-wide leases and optionally one-item
    # lookahead when explicitly enabled. Tokenless unit calls retain the legacy
    # sequential path so their mocked resources need no authentication context.
    sequences_processed = 0
    skipped_sequences = 0
    chunks_processed = 0
    audio_seconds_processed = 0.0
    segments_created = 0
    errors = 0
    error_details: list[Dict[str, Any]] = []
    successful_sequences = 0
    failed_sequences = 0
    chunk_claim_skips = 0
    recording_lease_skipped_sequences = 0
    blocked_originals: set[str] = set()
    stage_timings_ms: dict[str, dict[str, float]] = {}
    last_error: Optional[str] = None
    cursor: Optional[datetime] = data.cursor
    elapsed_seconds = 0.0
    provider_unavailable = False
    route_disabled = False
    cancelled = False
    provider_profile_id = (data.routingContext or {}).get("providerProfileId")

    def emit_stopping(message: str) -> None:
        progress_callback({
            "stage": "stopping",
            "message": message,
            "campaignId": campaign_id,
            "providerProfileId": provider_profile_id,
            "sequences_processed": cumulative_sequences + sequences_processed,
            "chunks_processed": cumulative_chunks + chunks_processed,
            "segments_created": cumulative_segments + segments_created,
            "batch_sequences_processed": sequences_processed,
            "batch_sequences_total": effective_batch_size,
            "batch_chunks_processed": chunks_processed,
            "worker_chunks_per_second": (
                chunks_processed / max(time.monotonic() - started_at, 0.001)
                if chunks_processed > 0
                else None
            ),
        })

    def record_result(result: Dict[str, Any], sequence: Any) -> bool:
        """Record one promoted sequence; return whether the batch must stop."""
        nonlocal sequences_processed, skipped_sequences, chunks_processed
        nonlocal audio_seconds_processed, segments_created, errors
        nonlocal successful_sequences, failed_sequences, chunk_claim_skips
        nonlocal last_error, provider_unavailable, cursor, elapsed_seconds

        sample_timings = result.get("stage_timings_ms")
        if isinstance(sample_timings, dict):
            aggregate_stage_timings(stage_timings_ms, sample_timings)

        if result.get("status") == "skipped":
            skipped_sequences += 1
            if result.get("skip_reason") == "chunk_claim":
                chunk_claim_skips += 1
            return False

        sequences_processed += 1
        chunks_processed += int(result.get("chunks_diarized", 0))
        segments_created += int(result.get("segments", 0))

        if result.get("status") == "error":
            errors += 1
            failed_sequences += 1
            last_error = result.get("error") or "Unknown diarization error"
            detail = result.get("errorDetail")
            if isinstance(detail, dict):
                error_details.append(detail)
                provider_unavailable = bool(detail.get("retryable")) and detail.get(
                    "category"
                ) in {"provider_network", "provider_busy", "timeout"}
        else:
            successful_sequences += 1
            audio_seconds_processed += float(result.get("audio_seconds", 0.0))
            if building_generation:
                cursor = max(cursor or sequence.start, sequence.last["start"])

        elapsed_seconds = max(time.monotonic() - started_at, 0.0)
        campaign_processed = cumulative_chunks + chunks_processed
        chunks_remaining = (
            max(total_chunks - campaign_processed, 0)
            if total_chunks is not None
            else None
        )
        batch_rate = (
            chunks_processed / elapsed_seconds
            if chunks_processed > 0 and elapsed_seconds > 0
            else None
        )
        rate_samples = previous_rate_samples + ([batch_rate] if batch_rate else [])
        smoothed_rate = campaign_rate_estimate(rate_samples)
        eta_seconds = (
            chunks_remaining / smoothed_rate
            if smoothed_rate and chunks_remaining is not None and chunks_remaining > 0
            else 0.0 if smoothed_rate and chunks_remaining == 0 else None
        )
        progress_callback({
            "stage": "processing",
            "message": f"Processed {sequences_processed} sequences, {chunks_processed} chunks",
            "total_chunks": total_chunks,
            "total_estimated": total_chunks is None,
            "count_warning": count_warning,
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
            "batch_sequences_processed": sequences_processed,
            "batch_sequences_total": effective_batch_size,
            "batch_chunks_processed": chunks_processed,
            "worker_chunks_per_second": batch_rate,
            "recording_lease_skipped_sequences": recording_lease_skipped_sequences,
            "chunk_claim_skips": chunk_claim_skips,
            "stage_timings_ms": stage_timings_ms,
        })
        # Counters and rates are applied once at job completion. Per-sequence
        # updates only publish mutable state that cannot lose completed work.
        _update_campaign(campaign_id, {
            "status": "running",
            "currentJobId": job_id,
            "lastCursor": cursor,
            "batchNumber": batch_number,
            "estimatedBatches": estimated_batches,
        })
        return (
            (result.get("status") == "error" and (
                building_generation or provider_unavailable
            ))
            or sequences_processed >= effective_batch_size
        )

    runtime_token = job_token_var.get()
    held_leases: dict[str, RecordingLease] = {}
    initial_lease_seconds: dict[str, float] = {}
    lease_lock = threading.Lock()

    # Production jobs reserve exactly one recording before constructing the
    # sequence cursor. Without this boundary, every lane starts at the same
    # oldest chunk and one fast lane can prefetch leases for multiple originals.
    if not is_diarization_route_enabled(provider_profile_id):
        route_disabled = True
        logger.info(
            "Stopping diarization job %s before scanning because route %s is disabled",
            job_id,
            provider_profile_id,
        )
        emit_stopping("Route disabled; stopping before scanning for work")
        sequences: Any = ()
    elif runtime_token is not None:
        selected_original_id: ObjectId | None = None
        for candidate_original_id in get_diarization_recording_candidates(
            filters=filters if filters else None,
            include_diarized=building_generation,
        ):
            if is_job_cancelled():
                cancelled = True
                break
            lease_started = time.monotonic()
            lease = acquire_recording_lease(
                candidate_original_id,
                worker_id,
                job_id=job_id,
                campaign_id=campaign_id,
                run_id=data.runId,
                route=data.diarizationServerUrl,
                resource_call=call_resource_once,
            )
            lease_seconds = max(time.monotonic() - lease_started, 0.0)
            original_key = str(candidate_original_id)
            if lease is None:
                blocked_originals.add(original_key)
                # This is a candidate reservation miss, not a skipped
                # sequence: the job has not opened that recording's cursor.
                continue
            selected_original_id = candidate_original_id
            with lease_lock:
                held_leases[original_key] = lease
                initial_lease_seconds[original_key] = lease_seconds
            break

        if selected_original_id is None:
            sequences = ()
        else:
            selected_filters = {
                **filters,
                "original_id": selected_original_id,
            }
            sequences = get_diarization_sequences(
                limit=None,
                filters=selected_filters,
                worker_id=worker_id,
                include_diarized=building_generation,
                max_sequence_length=effective_max_sequence_chunks,
            )
    else:
        sequences = get_diarization_sequences(
            limit=None,
            filters=filters if filters else None,
            worker_id=worker_id,
            include_diarized=building_generation,
            max_sequence_length=effective_max_sequence_chunks,
        )

    speaker_profiles_snapshot = (
        get_speaker_profiles_snapshot()
        if not building_generation and not route_disabled
        else []
    )
    provider_session = new_provider_session()
    executor: Optional[ThreadPoolExecutor] = None
    pending_future: Optional[Future] = None
    prefetch_resource_session = (
        create_session(runtime_token)
        if runtime_token and DIARIZATION_PREFETCH_SEQUENCES == 1
        else None
    )
    cancel_event = job_cancel_event_var.get()

    def invoke_diarization(
        sequence: Any,
        prepared: Optional[PreparedDiarizationSequence] = None,
    ) -> Dict[str, Any]:
        return diarize_sequence(
            sequence,
            worker_id,
            run_id=data.runId or "legacy-v0",
            generation=int((run or {}).get("generation", 0)),
            lifecycle_status="building" if building_generation else "active",
            mark_chunks=not building_generation,
            expected_embedding_space_id=(run or {}).get("embeddingSpaceId")
            if building_generation
            else None,
            server_url=data.diarizationServerUrl,
            prepared=prepared,
            provider_session=provider_session,
            speaker_profiles_snapshot=speaker_profiles_snapshot,
        )

    def next_leased_candidate(*, should_prepare: bool):
        nonlocal recording_lease_skipped_sequences
        for candidate in sequences:
            if is_job_cancelled():
                return None
            original_key = str(candidate.original_id)
            if original_key in blocked_originals:
                recording_lease_skipped_sequences += 1
                continue

            with lease_lock:
                lease = held_leases.get(original_key)
                lease_seconds = initial_lease_seconds.pop(original_key, 0.0)
            if lease is None:
                lease_started = time.monotonic()
                lease = acquire_recording_lease(
                    candidate.original_id,
                    worker_id,
                    job_id=job_id,
                    campaign_id=campaign_id,
                    run_id=data.runId,
                    route=data.diarizationServerUrl,
                    resource_call=call_resource_once,
                )
                lease_seconds = max(time.monotonic() - lease_started, 0.0)
                if lease is None:
                    blocked_originals.add(original_key)
                    recording_lease_skipped_sequences += 1
                    continue
                with lease_lock:
                    held_leases[original_key] = lease

            if is_job_cancelled():
                return None

            if should_prepare:
                try:
                    prepared = prepare_diarization_sequence(
                        candidate,
                        worker_id,
                        include_diarized=building_generation,
                        resource_call=call_resource_once,
                    )
                    prepared.stage_timings_seconds["lease"] = (
                        prepared.stage_timings_seconds.get("lease", 0.0)
                        + lease_seconds
                    )
                    return (candidate, prepared, lease, None, lease_seconds)
                except Exception as exc:
                    # The promoted sequence retries through the established
                    # claim/hydrate error path, which records retry metadata.
                    return (candidate, None, lease, exc, lease_seconds)
            return (candidate, None, lease, None, lease_seconds)
        return None

    def prepare_next():
        assert prefetch_resource_session is not None
        token_ref = job_token_var.set(runtime_token)
        session_ref = job_session_var.set(prefetch_resource_session)
        cancel_ref = job_cancel_event_var.set(cancel_event)
        try:
            return next_leased_candidate(should_prepare=True)
        finally:
            job_cancel_event_var.reset(cancel_ref)
            job_session_var.reset(session_ref)
            job_token_var.reset(token_ref)

    try:
        if runtime_token is None:
            # Focused unit tests call this function without the worker-server
            # JWT context. Keep that path deterministic and sequential.
            for sequence in sequences:
                if not is_diarization_route_enabled(provider_profile_id):
                    route_disabled = True
                    emit_stopping(
                        "Route disabled; stopping before the next external request"
                    )
                    break
                if record_result(invoke_diarization(sequence), sequence):
                    break
        elif DIARIZATION_PREFETCH_SEQUENCES == 0:
            while True:
                # Disabling lookahead removes only the overlap: preparation is
                # still synchronous and bounded before the chunk claim/POST.
                outcome = next_leased_candidate(should_prepare=True)
                if outcome is None:
                    if is_job_cancelled():
                        cancelled = True
                        emit_stopping("Job cancelled; stopping before the next external request")
                    break
                sequence, prepared, lease, preparation_error, lease_seconds = outcome
                if is_job_cancelled():
                    cancelled = True
                    if prepared is not None:
                        prepared.close()
                    emit_stopping("Job cancelled; stopping before the next external request")
                    break
                if not is_diarization_route_enabled(provider_profile_id):
                    route_disabled = True
                    if prepared is not None:
                        prepared.close()
                    emit_stopping(
                        "Route disabled; stopping before the next external request"
                    )
                    break

                read_timeout = 300 + len(sequence.chunks) * 3
                renewed = renew_recording_lease(
                    lease,
                    minimum_seconds=read_timeout + 120,
                    resource_call=call_resource_once,
                )
                if renewed is None:
                    blocked_originals.add(str(sequence.original_id))
                    recording_lease_skipped_sequences += 1
                    if prepared is not None:
                        prepared.close()
                    continue
                with lease_lock:
                    held_leases[str(sequence.original_id)] = renewed

                result = invoke_diarization(
                    sequence,
                    prepared if preparation_error is None else None,
                )
                if lease_seconds > 0:
                    result.setdefault("stage_timings_ms", {})["lease"] = round(
                        lease_seconds * 1000.0,
                        3,
                    )
                if record_result(result, sequence):
                    break
        else:
            executor = ThreadPoolExecutor(max_workers=1)
            pending_future = executor.submit(prepare_next)
            while pending_future is not None:
                wait_started = time.monotonic()
                outcome = pending_future.result()
                pending_future = None
                if outcome is None:
                    if is_job_cancelled():
                        cancelled = True
                        emit_stopping("Job cancelled; stopping before the next external request")
                    break
                sequence, prepared, lease, preparation_error, _lease_seconds = outcome
                if prepared is not None:
                    prepared.stage_timings_seconds["prefetch_wait"] = max(
                        time.monotonic() - wait_started,
                        0.0,
                    )

                if is_job_cancelled():
                    cancelled = True
                    if prepared is not None:
                        prepared.close()
                    emit_stopping("Job cancelled; stopping before the next external request")
                    break
                if not is_diarization_route_enabled(provider_profile_id):
                    route_disabled = True
                    if prepared is not None:
                        prepared.close()
                    emit_stopping(
                        "Route disabled; stopping before the next external request"
                    )
                    break

                read_timeout = 300 + len(sequence.chunks) * 3
                renewed = renew_recording_lease(
                    lease,
                    minimum_seconds=read_timeout + 120,
                    resource_call=call_resource_once,
                )
                if renewed is None:
                    blocked_originals.add(str(sequence.original_id))
                    recording_lease_skipped_sequences += 1
                    if prepared is not None:
                        prepared.close()
                    pending_future = executor.submit(prepare_next)
                    continue
                with lease_lock:
                    held_leases[str(sequence.original_id)] = renewed

                # Start exactly one lookahead only after stop/lease checks and
                # immediately before the current serial provider request.
                pending_future = executor.submit(prepare_next)
                result = invoke_diarization(
                    sequence,
                    prepared if preparation_error is None else None,
                )
                if record_result(result, sequence):
                    break
    finally:
        if pending_future is not None:
            if not pending_future.cancel():
                try:
                    unused = pending_future.result()
                    if unused is not None and unused[1] is not None:
                        unused[1].close()
                except Exception as exc:
                    logger.warning("Could not drain diarization lookahead: %s", exc)
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
        close_sequences = getattr(sequences, "close", None)
        if close_sequences:
            close_sequences()
        if prefetch_resource_session is not None:
            prefetch_resource_session.close()
        provider_session.close()
        with lease_lock:
            leases_to_release = list(held_leases.values())
        try:
            release_recording_leases(
                leases_to_release,
                resource_call=call_resource_once,
            )
        except Exception as exc:
            logger.warning("Could not release recording leases: %s", exc)
    
    retryable_failure = any(
        bool(detail.get("retryable")) for detail in error_details
    )
    next_retry_at = next(
        (detail.get("retryAt") for detail in error_details if detail.get("retryAt")),
        None,
    )
    if errors > 0 and chunks_processed == 0:
        failed_status = (
            "interrupted" if building_generation or retryable_failure else "failed"
        )
        failed_at = datetime.now().astimezone()
        failed_elapsed = max(time.monotonic() - started_at, 0.0)
        _record_job_rate_sample(
            job_id=job_id,
            campaign_id=campaign_id,
            route=data.diarizationServerUrl,
            provider_profile_id=provider_profile_id,
            started_at=job_started_at,
            finished_at=failed_at,
            status=failed_status,
            duration_seconds=failed_elapsed,
            chunks_processed=chunks_processed,
            audio_seconds_processed=audio_seconds_processed,
            segments_created=segments_created,
            successful_sequences=successful_sequences,
            failed_sequences=failed_sequences,
            skipped_sequences=skipped_sequences + recording_lease_skipped_sequences,
            recording_lease_busy_originals=len(blocked_originals),
            recording_lease_skipped_sequences=recording_lease_skipped_sequences,
            chunk_claim_skips=chunk_claim_skips,
            stage_timings_ms=stage_timings_ms,
        )
        _update_campaign(campaign_id, {
            "status": failed_status,
            "errors": (previous_errors + error_details)[-100:],
            "nextRetryAt": next_retry_at,
            "lastCursor": cursor,
        })
        raise RuntimeError(last_error or "Diarization made no progress")

    remaining = (
        max(total_chunks - (cumulative_chunks + chunks_processed), 0)
        if total_chunks is not None
        else None
    )
    # A failed sequence carries its own retry schedule, and the job chain
    # already refuses to continue a batch that made no progress. Ending the
    # campaign on any error stranded the rest of the backlog instead.
    has_more = (
        remaining > 0
        if remaining is not None
        else sequences_processed >= effective_batch_size
        and successful_sequences > 0
    )
    if provider_unavailable:
        # Avoid a hot continuation loop while the selected service is down.
        # The historical watchdog resumes interrupted campaigns once their
        # persisted sequence retryAt becomes eligible again.
        has_more = False
    if route_disabled:
        # A route toggle is an explicit operator stop. Never chain another job
        # carrying the same immutable, now-disabled route snapshot.
        has_more = False
    if cancelled:
        has_more = False
    if (
        building_generation
        and not has_more
        and not provider_unavailable
        and not route_disabled
        and not cancelled
    ):
        now = datetime.now().astimezone()
        call_resource("mongo", {"action": "updateMany", "collection": "diarizations", "query": {"runId": data.runId}, "update": {"$set": {"lifecycleStatus": "ready"}}})
        call_resource("mongo", {"action": "updateOne", "collection": "diarization_runs", "query": {"runId": data.runId, "status": "building"}, "update": {"$set": {"status": "ready", "readyAt": now, "coverage": {"chunks": cumulative_chunks + chunks_processed, "segments": cumulative_segments + segments_created}, "errors": cumulative_errors + errors}}})
    final_status = (
        "interrupted" if provider_unavailable or cancelled
        else "running" if has_more
        else "completed_with_errors" if cumulative_errors + errors > 0
        else "completed"
    )
    final_elapsed = (
        elapsed_seconds
        if elapsed_seconds > 0
        else max(time.monotonic() - started_at, 0.0)
    )
    final_batch_rate = (
        chunks_processed / final_elapsed
        if chunks_processed > 0 and final_elapsed > 0
        else None
    )
    finished_at = datetime.now().astimezone()
    _record_job_rate_sample(
        job_id=job_id,
        campaign_id=campaign_id,
        route=data.diarizationServerUrl,
        provider_profile_id=provider_profile_id,
        started_at=job_started_at,
        finished_at=finished_at,
        status=final_status,
        duration_seconds=final_elapsed,
        chunks_processed=chunks_processed,
        audio_seconds_processed=audio_seconds_processed,
        segments_created=segments_created,
        successful_sequences=successful_sequences,
        failed_sequences=failed_sequences,
        skipped_sequences=skipped_sequences + recording_lease_skipped_sequences,
        recording_lease_busy_originals=len(blocked_originals),
        recording_lease_skipped_sequences=recording_lease_skipped_sequences,
        chunk_claim_skips=chunk_claim_skips,
        stage_timings_ms=stage_timings_ms,
    )
    _update_campaign(campaign_id, {
        "status": final_status,
        "pendingChunks": remaining,
        "errors": (previous_errors + error_details)[-100:],
        "nextRetryAt": next_retry_at if provider_unavailable else None,
        "finishedAt": (
            None
            if provider_unavailable or has_more
            else finished_at
        ),
        "lastCursor": cursor,
    })
    logger.info(f"Diarization job {job_id} completed: {sequences_processed} sequences, {chunks_processed} chunks, {segments_created} segments")
    
    return {
        "success": True,
        "sequences_processed": sequences_processed,
        "chunks_processed": chunks_processed,
        "segments_created": segments_created,
        "worker_chunks_per_second": final_batch_rate,
        "errorCount": errors,
        "errors": error_details,
        "successfulSequences": successful_sequences,
        "failedSequences": failed_sequences,
        "skippedSequences": skipped_sequences + recording_lease_skipped_sequences,
        "recordingLeaseBusyOriginals": len(blocked_originals),
        "recordingLeaseSkippedSequences": recording_lease_skipped_sequences,
        "chunkClaimSkips": chunk_claim_skips,
        "audioSecondsProcessed": audio_seconds_processed,
        "stageTimingsMs": stage_timings_ms,
        "processed": chunks_processed,
        "hasMore": has_more,
        "retryScheduled": provider_unavailable,
        "routeDisabled": route_disabled,
        "cancelled": cancelled,
        "cursor": cursor.isoformat() if cursor else None,
        "campaignId": campaign_id,
        "batchNumber": batch_number,
        "estimatedBatches": estimated_batches,
    }
