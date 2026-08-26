import threading
import time
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from sys import path
from unittest import TestCase
from unittest.mock import Mock, patch

from bson import ObjectId
from pydantic import ValidationError

path.insert(0, str(Path(__file__).resolve().parents[1]))

from jobs.diarization import (  # noqa: E402
    DiarizationJobData,
    _record_job_rate_sample,
    campaign_rate_estimate,
    diarization_claim_owner,
    is_diarization_route_enabled,
    parse_diarization_prefetch_sequences,
    process_diarization_job,
)
from diarization_worker import (  # noqa: E402
    DiarizationSequence,
    PreparedDiarizationSequence,
)
from lib.api import job_token_var  # noqa: E402
from lib.diarization_runtime import (  # noqa: E402
    RecordingLease,
    job_cancel_event_var,
)
from jobs.enrollment import EnrollmentJobData, process_enrollment_job  # noqa: E402
from jobs.speaker_matching import (  # noqa: E402
    SpeakerMatchingJobData,
    process_speaker_matching_job,
)


class EnrollmentJobTest(TestCase):
    def test_enrollment_persists_the_actual_admitted_runtime(self):
        runtime = {
            "modelId": "pyannote/community-1",
            "modelVersion": "model-revision-1",
            "embeddingSpaceId": "space-v1",
        }
        with (
            patch("jobs.enrollment._get_audio_from_gridfs", return_value=b"wav"),
            patch(
                "jobs.enrollment._extract_embedding",
                return_value={
                    "embedding": [1.0, 0.0],
                    "duration": 10.0,
                    **runtime,
                },
            ),
            patch(
                "jobs.enrollment.create_or_update_profile",
                return_value={
                    "_id": ObjectId(),
                    "embeddingSpaceId": "space-v1",
                },
            ) as create,
            patch(
                "jobs.enrollment.call_resource",
                return_value={"matchedCount": 1},
            ),
        ):
            result = process_enrollment_job(
                "job-runtime",
                EnrollmentJobData(
                    name="Sky",
                    sample_file_id=str(ObjectId()),
                    routingContext=runtime,
                ),
                lambda _progress: None,
            )

        self.assertEqual(
            create.call_args.kwargs["runtime_provenance"],
            runtime,
        )
        self.assertEqual(result["runtimeProvenance"], runtime)

    def test_existing_profile_is_updated_by_id_and_sample_link_is_required(self):
        profile_id = str(ObjectId())
        sample_id = str(ObjectId())
        profile = {
            "_id": ObjectId(profile_id),
            "name": "Sky",
            "sample_count": 3,
            "total_duration": 60.0,
            "is_primary": True,
        }

        with (
            patch("jobs.enrollment._get_audio_from_gridfs", return_value=b"wav"),
            patch(
                "jobs.enrollment._extract_embedding",
                return_value={"embedding": [1.0, 0.0], "duration": 10.0, "embeddingSpaceId": "space-v1"},
            ),
            patch("jobs.enrollment.get_profile_by_id", return_value=profile),
            patch("jobs.enrollment.add_sample_to_profile", return_value=profile) as add,
            patch(
                "jobs.enrollment.call_resource",
                return_value={"matchedCount": 1, "modifiedCount": 1},
            ) as resource,
        ):
            result = process_enrollment_job(
                "job-1",
                EnrollmentJobData(
                    name="ignored-name",
                    profile_id=profile_id,
                    sample_file_id=sample_id,
                ),
                lambda _progress: None,
            )

        add.assert_called_once_with(profile, [1.0, 0.0], 10.0, "space-v1")
        link_request = resource.call_args.args[1]
        self.assertEqual(link_request["collection"], "voice_samples.files")
        self.assertEqual(link_request["update"]["$set"]["metadata.profile_id"], profile_id)
        self.assertEqual(result["profile_id"], profile_id)

    def test_selected_diarizator_url_is_passed_to_embedding_extraction(self):
        with (
            patch("jobs.enrollment._get_audio_from_gridfs", return_value=b"wav"),
            patch(
                "jobs.enrollment._extract_embedding",
                return_value={"embedding": [1.0], "duration": 1.0},
            ) as extract,
            patch("jobs.enrollment.create_or_update_profile", return_value={"_id": ObjectId()}),
            patch("jobs.enrollment.call_resource", return_value={"matchedCount": 1}),
        ):
            process_enrollment_job(
                "job-route",
                EnrollmentJobData(
                    name="Sky",
                    sample_file_id=str(ObjectId()),
                    diarizationServerUrl="https://voice.example",
                ),
                lambda _progress: None,
            )

        self.assertEqual(extract.call_args.args[3], "https://voice.example")

    def test_missing_sample_link_fails_the_job(self):
        profile_id = str(ObjectId())
        profile = {"_id": ObjectId(profile_id), "name": "Sky"}

        with (
            patch("jobs.enrollment._get_audio_from_gridfs", return_value=b"wav"),
            patch(
                "jobs.enrollment._extract_embedding",
                return_value={"embedding": [1.0, 0.0], "duration": 10.0},
            ),
            patch("jobs.enrollment.get_profile_by_id", return_value=profile),
            patch("jobs.enrollment.add_sample_to_profile", return_value=profile),
            patch(
                "jobs.enrollment.call_resource",
                return_value={"matchedCount": 0, "modifiedCount": 0},
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "sample.*not linked"):
                process_enrollment_job(
                    "job-1",
                    EnrollmentJobData(
                        name="Sky",
                        profile_id=profile_id,
                        sample_file_id=str(ObjectId()),
                    ),
                    lambda _progress: None,
                )


class DiarizationJobTest(TestCase):
    def test_job_reports_actual_processed_audio_range(self):
        sequence_start = datetime(2026, 8, 18, 8, 0, tzinfo=UTC)
        sequence = DiarizationSequence(
            original_id=ObjectId(),
            chunks=[{
                "_id": ObjectId(),
                "index": 1,
                "start": sequence_start,
            }],
        )
        progress_updates = []
        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=1),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=[sequence],
            ),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "diarized",
                    "chunks_diarized": 1,
                    "segments": 2,
                    "audio_seconds": 12.5,
                    "payload_audio_seconds": 12.5,
                },
            ),
        ):
            result = process_diarization_job(
                "job-processed-range",
                DiarizationJobData(limit=1),
                progress_updates.append,
            )

        expected = {
            "start": "2026-08-18T08:00:00+00:00",
            "end": "2026-08-18T08:00:12.500000+00:00",
        }
        self.assertEqual(result["processedRange"], expected)
        processing = next(
            update
            for update in progress_updates
            if update.get("stage") == "processing"
            and update.get("processedRange") is not None
        )
        self.assertEqual(processing["processedRange"], expected)

    def test_max_sequence_chunks_snapshot_is_validated_and_forwarded(self):
        for value in (0, 33):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                DiarizationJobData(maxSequenceChunks=value)
        for invalid in (
            {"limit": 0},
            {"limit": 101},
            {"batchSize": 0},
            {"batchSize": 33},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                DiarizationJobData(**invalid)

        sequence = object()
        progress_updates = []
        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=10),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=[sequence],
            ) as get_sequences,
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "diarized",
                    "chunks_diarized": 2,
                    "segments": 3,
                },
            ),
        ):
            result = process_diarization_job(
                "job-snapshotted-window",
                DiarizationJobData(limit=100, maxSequenceChunks=3),
                progress_updates.append,
            )

        self.assertEqual(
            get_sequences.call_args.kwargs["max_sequence_length"],
            3,
        )
        self.assertEqual(result["estimatedBatches"], 1)
        processing_update = next(
            update
            for update in progress_updates
            if update.get("stage") == "processing"
        )
        self.assertEqual(processing_update["batch_sequences_total"], 32)

    def test_prefetch_switch_accepts_only_zero_or_one(self):
        self.assertEqual(parse_diarization_prefetch_sequences("0"), 0)
        self.assertEqual(parse_diarization_prefetch_sequences("1"), 1)
        for value in ("", "2", "true", " 1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_diarization_prefetch_sequences(value)

    def test_multi_sequence_job_resolves_speaker_snapshot_once(self):
        profile = {
            "_id": ObjectId(),
            "name": "Sky",
            "embedding": [1.0, 0.0],
            "embeddingSpaceId": "space-v1",
            "revision": 4,
        }
        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=2),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=[object(), object()],
            ),
            patch(
                "diarization_worker._is_speaker_identification_enabled",
                return_value=True,
            ) as feature_flag,
            patch(
                "diarization_worker._get_speaker_profiles",
                return_value=[profile],
            ) as profiles,
            patch(
                "jobs.diarization.diarize_sequence",
                side_effect=[
                    {
                        "status": "diarized",
                        "chunks_diarized": 1,
                        "segments": 1,
                    },
                    {
                        "status": "diarized",
                        "chunks_diarized": 1,
                        "segments": 1,
                    },
                ],
            ) as diarize,
        ):
            process_diarization_job(
                "job-profile-snapshot",
                DiarizationJobData(
                    limit=2,
                    routingContext={"embeddingSpaceId": "space-v1"},
                ),
                lambda _progress: None,
            )

        feature_flag.assert_called_once_with()
        profiles.assert_called_once_with()
        self.assertEqual(diarize.call_count, 2)
        for call in diarize.call_args_list:
            self.assertEqual(
                call.kwargs["speaker_profiles_snapshot"],
                [profile],
            )

    def test_rate_sample_is_idempotent_by_job_and_campaign_totals_use_inc(self):
        calls = []
        started_at = datetime(2026, 8, 18, 8, 0, tzinfo=UTC)
        finished_at = datetime(2026, 8, 18, 8, 2, tzinfo=UTC)

        with patch(
            "jobs.diarization._campaign_call",
            side_effect=lambda request: calls.append(request),
        ):
            _record_job_rate_sample(
                job_id="job-1",
                campaign_id="campaign-1",
                route="https://diar.example",
                provider_profile_id="gpu-1",
                started_at=started_at,
                finished_at=finished_at,
                status="completed",
                duration_seconds=120.0,
                chunks_processed=12,
                audio_seconds_processed=240.0,
                segments_created=8,
                successful_sequences=2,
                failed_sequences=1,
                skipped_sequences=4,
                recording_lease_busy_originals=2,
                recording_lease_skipped_sequences=3,
                chunk_claim_skips=1,
                stage_timings_ms={
                    "provider": {
                        "count": 3,
                        "total": 90_000.0,
                        "avg": 30_000.0,
                        "max": 35_000.0,
                    },
                },
            )

        sample_request, campaign_request = calls
        self.assertEqual(
            sample_request["collection"],
            "diarization_campaign_rate_samples",
        )
        self.assertEqual(sample_request["query"], {"_id": "job-1"})
        sample = sample_request["update"]["$set"]
        self.assertEqual(sample["audioSecondsProcessed"], 240.0)
        self.assertEqual(sample["recordingLeaseBusyOriginals"], 2)
        self.assertEqual(sample["recordingLeaseSkippedSequences"], 3)
        self.assertEqual(sample["chunkClaimSkips"], 1)
        self.assertEqual(sample["audioRealtimeFactor"], 2.0)
        self.assertTrue(sample_request["options"]["upsert"])

        self.assertEqual(
            campaign_request["query"],
            {
                "campaignId": "campaign-1",
                "accountedJobIds": {"$ne": "job-1"},
            },
        )
        self.assertEqual(
            campaign_request["update"]["$inc"],
            {
                "processedChunks": 12,
                "processedSequences": 3,
                "segmentsCreated": 8,
                "errorCount": 1,
            },
        )
        self.assertEqual(
            campaign_request["update"]["$addToSet"],
            {"accountedJobIds": "job-1"},
        )

    def test_prefetch_off_keeps_production_lease_and_session_without_decode_overlap(self):
        original_id = ObjectId()
        base = datetime(2026, 8, 18, 8, 0, tzinfo=UTC)
        sequences = [
            DiarizationSequence(
                original_id=original_id,
                chunks=[{
                    "_id": ObjectId(),
                    "original_id": original_id,
                    "index": index,
                    "start": base + timedelta(seconds=index),
                }],
            )
            for index in range(2)
        ]
        lease = RecordingLease(
            original_id=original_id,
            owner="worker-1",
            token="lease-token",
            expires_at=base + timedelta(minutes=10),
        )
        cancel_event = threading.Event()
        provider_session = Mock()
        bounded_resource_call = Mock()
        events = []

        def acquire(*_args, **_kwargs):
            events.append("lease")
            return lease

        def prepare(candidate, _worker_id, **_kwargs):
            events.append("prepare")
            return PreparedDiarizationSequence(
                sequence=candidate,
                wav_file=BytesIO(b"wav"),
                total_samples=16_000,
            )

        def renew(*_args, **_kwargs):
            events.append("renew")
            return lease

        def release(*_args, **_kwargs):
            events.append("release")
            return 1

        def diarize(_candidate, _worker_id, **kwargs):
            events.append("claim_provider")
            self.assertIsNotNone(kwargs["prepared"])
            self.assertIs(kwargs["provider_session"], provider_session)
            kwargs["prepared"].close()
            cancel_event.set()
            return {
                "status": "diarized",
                "chunks_diarized": 1,
                "segments": 1,
                "audio_seconds": 1.0,
                "stage_timings_ms": {"provider": 10.0},
            }

        token_ref = job_token_var.set("job-jwt")
        cancel_ref = job_cancel_event_var.set(cancel_event)
        try:
            with (
                patch("jobs.diarization._campaign_call", return_value=None),
                patch("jobs.diarization._update_campaign"),
                patch("jobs.diarization.count_pending_chunks", return_value=2),
                patch(
                    "jobs.diarization.get_diarization_recording_candidates",
                    return_value=iter([original_id]),
                ),
                patch(
                    "jobs.diarization.get_diarization_sequences",
                    return_value=iter(sequences),
                ) as get_sequences,
                patch(
                    "jobs.diarization.is_diarization_route_enabled",
                    return_value=True,
                ),
                patch(
                    "jobs.diarization.get_speaker_profiles_snapshot",
                    return_value=[],
                ),
                patch("jobs.diarization.DIARIZATION_PREFETCH_SEQUENCES", 0),
                patch(
                    "jobs.diarization.call_resource_once",
                    bounded_resource_call,
                ),
                patch("jobs.diarization.create_session") as create_session,
                patch("jobs.diarization.ThreadPoolExecutor") as executor,
                patch(
                    "jobs.diarization.new_provider_session",
                    return_value=provider_session,
                ),
                patch(
                    "jobs.diarization.acquire_recording_lease",
                    side_effect=acquire,
                ) as acquire,
                patch(
                    "jobs.diarization.renew_recording_lease",
                    side_effect=renew,
                ) as renew,
                patch(
                    "jobs.diarization.release_recording_leases",
                    side_effect=release,
                ) as release,
                patch(
                    "jobs.diarization.prepare_diarization_sequence",
                    side_effect=prepare,
                ) as prepare_call,
                patch(
                    "jobs.diarization.diarize_sequence",
                    side_effect=diarize,
                ) as diarize_call,
            ):
                result = process_diarization_job(
                    "job-no-prefetch",
                    DiarizationJobData(limit=2),
                    lambda _progress: None,
                )
        finally:
            job_cancel_event_var.reset(cancel_ref)
            job_token_var.reset(token_ref)

        self.assertEqual(diarize_call.call_count, 1)
        acquire.assert_called_once()
        self.assertEqual(
            get_sequences.call_args.kwargs["filters"],
            {"original_id": original_id},
        )
        renew.assert_called_once()
        prepare_call.assert_called_once()
        create_session.assert_not_called()
        executor.assert_not_called()
        release.assert_called_once_with(
            [lease],
            resource_call=bounded_resource_call,
        )
        self.assertTrue(provider_session.close.called)
        self.assertEqual(
            events,
            ["lease", "prepare", "renew", "claim_provider", "release"],
        )
        self.assertTrue(result["cancelled"])
        self.assertFalse(result["hasMore"])

    def test_lost_lease_counts_one_skip_in_result_and_rate_sample(self):
        original_id = ObjectId()
        base = datetime(2026, 8, 18, 8, 0, tzinfo=UTC)
        sequence = DiarizationSequence(
            original_id=original_id,
            chunks=[{
                "_id": ObjectId(),
                "original_id": original_id,
                "index": 0,
                "start": base,
            }],
        )
        lease = RecordingLease(
            original_id=original_id,
            owner="worker-1",
            token="lease-token",
            expires_at=base + timedelta(minutes=10),
        )
        provider_session = Mock()
        bounded_resource_call = Mock()
        token_ref = job_token_var.set("job-jwt")
        cancel_ref = job_cancel_event_var.set(threading.Event())
        try:
            with (
                patch("jobs.diarization._campaign_call", return_value=None),
                patch("jobs.diarization._update_campaign"),
                patch("jobs.diarization._record_job_rate_sample") as rate_sample,
                patch("jobs.diarization.count_pending_chunks", return_value=1),
                patch(
                    "jobs.diarization.get_diarization_recording_candidates",
                    return_value=iter([original_id]),
                ),
                patch(
                    "jobs.diarization.get_diarization_sequences",
                    return_value=iter([sequence]),
                ),
                patch(
                    "jobs.diarization.get_speaker_profiles_snapshot",
                    return_value=[],
                ),
                patch("jobs.diarization.DIARIZATION_PREFETCH_SEQUENCES", 0),
                patch(
                    "jobs.diarization.call_resource_once",
                    bounded_resource_call,
                ),
                patch(
                    "jobs.diarization.new_provider_session",
                    return_value=provider_session,
                ),
                patch(
                    "jobs.diarization.acquire_recording_lease",
                    return_value=lease,
                ),
                patch(
                    "jobs.diarization.renew_recording_lease",
                    return_value=None,
                ),
                patch(
                    "jobs.diarization.release_recording_leases",
                    return_value=1,
                ),
                patch("jobs.diarization.diarize_sequence") as diarize,
            ):
                result = process_diarization_job(
                    "job-lease-lost",
                    DiarizationJobData(limit=1),
                    lambda _progress: None,
                )
        finally:
            job_cancel_event_var.reset(cancel_ref)
            job_token_var.reset(token_ref)

        diarize.assert_not_called()
        self.assertEqual(result["recordingLeaseSkippedSequences"], 1)
        self.assertEqual(result["skippedSequences"], 1)
        self.assertEqual(rate_sample.call_args.kwargs["skipped_sequences"], 1)
        self.assertEqual(
            rate_sample.call_args.kwargs["recording_lease_skipped_sequences"],
            1,
        )

    def test_job_reserves_one_free_recording_before_opening_sequence_cursor(self):
        busy_original_id = ObjectId()
        selected_original_id = ObjectId()
        base = datetime(2026, 8, 18, 8, 0, tzinfo=UTC)
        sequence = DiarizationSequence(
            original_id=selected_original_id,
            chunks=[{
                "_id": ObjectId(),
                "original_id": selected_original_id,
                "index": 0,
                "start": base,
            }],
        )
        lease = RecordingLease(
            original_id=selected_original_id,
            owner="worker-1",
            token="lease-token",
            expires_at=base + timedelta(minutes=10),
        )
        cancel_event = threading.Event()
        provider_session = Mock()

        def diarize(_candidate, _worker_id, **kwargs):
            kwargs["prepared"].close()
            cancel_event.set()
            return {
                "status": "diarized",
                "chunks_diarized": 1,
                "segments": 1,
                "audio_seconds": 1.0,
            }

        token_ref = job_token_var.set("job-jwt")
        cancel_ref = job_cancel_event_var.set(cancel_event)
        try:
            with (
                patch("jobs.diarization._campaign_call", return_value=None),
                patch("jobs.diarization._update_campaign"),
                patch("jobs.diarization.count_pending_chunks", return_value=2),
                patch(
                    "jobs.diarization.get_diarization_recording_candidates",
                    return_value=iter([busy_original_id, selected_original_id]),
                ),
                patch(
                    "jobs.diarization.get_diarization_sequences",
                    return_value=iter([sequence]),
                ) as get_sequences,
                patch(
                    "jobs.diarization.get_speaker_profiles_snapshot",
                    return_value=[],
                ),
                patch("jobs.diarization.DIARIZATION_PREFETCH_SEQUENCES", 0),
                patch("jobs.diarization.call_resource_once", Mock()),
                patch(
                    "jobs.diarization.new_provider_session",
                    return_value=provider_session,
                ),
                patch(
                    "jobs.diarization.acquire_recording_lease",
                    side_effect=[None, lease],
                ) as acquire,
                patch(
                    "jobs.diarization.renew_recording_lease",
                    return_value=lease,
                ),
                patch(
                    "jobs.diarization.release_recording_leases",
                    return_value=1,
                ),
                patch(
                    "jobs.diarization.prepare_diarization_sequence",
                    return_value=PreparedDiarizationSequence(
                        sequence=sequence,
                        wav_file=BytesIO(b"wav"),
                        total_samples=16_000,
                    ),
                ),
                patch("jobs.diarization.diarize_sequence", side_effect=diarize),
            ):
                result = process_diarization_job(
                    "job-recording-selection",
                    DiarizationJobData(limit=1),
                    lambda _progress: None,
                )
        finally:
            job_cancel_event_var.reset(cancel_ref)
            job_token_var.reset(token_ref)

        self.assertEqual(acquire.call_count, 2)
        self.assertEqual(
            get_sequences.call_args.kwargs["filters"],
            {"original_id": selected_original_id},
        )
        self.assertEqual(result["successfulSequences"], 1)
        self.assertEqual(result["recordingLeaseBusyOriginals"], 1)
        self.assertEqual(result["recordingLeaseSkippedSequences"], 0)
        self.assertEqual(result["skippedSequences"], 0)

    def test_prefetch_overlaps_provider_and_cancellation_cleans_up_lease(self):
        original_id = ObjectId()
        base = datetime(2026, 8, 18, 8, 0, tzinfo=UTC)

        def sequence(index: int) -> DiarizationSequence:
            return DiarizationSequence(
                original_id=original_id,
                chunks=[
                    {
                        "_id": ObjectId(),
                        "original_id": original_id,
                        "index": index,
                        "start": base + timedelta(seconds=index),
                    },
                ],
            )

        sequences = [sequence(0), sequence(1), sequence(2)]
        lease = RecordingLease(
            original_id=original_id,
            owner="worker-1",
            token="lease-token",
            expires_at=base + timedelta(minutes=10),
        )
        prepared_items = []
        second_prepared = threading.Event()
        release_blocked_prefetch = threading.Event()
        cancel_event = threading.Event()
        provider_session = Mock()
        resource_session = Mock()

        def prepare(candidate, _worker_id, **kwargs):
            self.assertIs(kwargs["resource_call"], bounded_resource_call)
            prepared = PreparedDiarizationSequence(
                sequence=candidate,
                wav_file=BytesIO(b"wav"),
                total_samples=16_000,
            )
            prepared_items.append(prepared)
            if len(prepared_items) == 2:
                second_prepared.set()
                self.assertTrue(release_blocked_prefetch.wait(timeout=1.0))
            return prepared

        def diarize(_candidate, _worker_id, **kwargs):
            # The second sequence must already be hydrated/decoded while the
            # first provider request is in flight.
            self.assertTrue(second_prepared.wait(timeout=1.0))
            kwargs["prepared"].close()
            cancel_event.set()
            release_blocked_prefetch.set()
            return {
                "status": "diarized",
                "chunks_diarized": 1,
                "segments": 1,
                "audio_seconds": 1.0,
                "stage_timings_ms": {"provider": 10.0},
            }

        token_ref = job_token_var.set("job-jwt")
        cancel_ref = job_cancel_event_var.set(cancel_event)
        bounded_resource_call = Mock()
        test_started = time.perf_counter()
        try:
            with (
                patch("jobs.diarization._campaign_call", return_value=None),
                patch("jobs.diarization._update_campaign"),
                patch("jobs.diarization.count_pending_chunks", return_value=3),
                patch(
                    "jobs.diarization.get_diarization_recording_candidates",
                    return_value=iter([original_id]),
                ),
                patch(
                    "jobs.diarization.get_diarization_sequences",
                    return_value=iter(sequences),
                ),
                patch(
                    "jobs.diarization.is_diarization_route_enabled",
                    return_value=True,
                ),
                patch(
                    "jobs.diarization.get_speaker_profiles_snapshot",
                    return_value=[],
                ),
                patch("jobs.diarization.DIARIZATION_PREFETCH_SEQUENCES", 1),
                patch(
                    "jobs.diarization.call_resource_once",
                    bounded_resource_call,
                ),
                patch(
                    "jobs.diarization.create_session",
                    return_value=resource_session,
                ),
                patch(
                    "jobs.diarization.new_provider_session",
                    return_value=provider_session,
                ),
                patch(
                    "jobs.diarization.acquire_recording_lease",
                    return_value=lease,
                ) as acquire,
                patch(
                    "jobs.diarization.renew_recording_lease",
                    return_value=lease,
                ),
                patch(
                    "jobs.diarization.release_recording_leases",
                    return_value=1,
                ) as release,
                patch(
                    "jobs.diarization.prepare_diarization_sequence",
                    side_effect=prepare,
                ) as prepare_call,
                patch(
                    "jobs.diarization.diarize_sequence",
                    side_effect=diarize,
                ) as diarize_call,
            ):
                result = process_diarization_job(
                    "job-prefetch-cancel",
                    DiarizationJobData(limit=3),
                    lambda _progress: None,
                )
        finally:
            job_cancel_event_var.reset(cancel_ref)
            job_token_var.reset(token_ref)

        self.assertEqual(prepare_call.call_count, 2)
        self.assertEqual(diarize_call.call_count, 1)
        self.assertEqual(acquire.call_count, 1)
        release.assert_called_once_with(
            [lease],
            resource_call=bounded_resource_call,
        )
        self.assertTrue(prepared_items[0].wav_file.closed)
        self.assertTrue(prepared_items[1].wav_file.closed)
        self.assertTrue(resource_session.close.called)
        self.assertTrue(provider_session.close.called)
        self.assertTrue(result["cancelled"])
        self.assertFalse(result["hasMore"])
        self.assertLess(time.perf_counter() - test_started, 1.0)

    def test_claim_owner_is_unique_per_job(self):
        with patch("jobs.diarization.get_worker_id", return_value="host_1"):
            self.assertEqual(
                diarization_claim_owner("job-a"),
                "host_1:job:job-a",
            )
            self.assertNotEqual(
                diarization_claim_owner("job-a"),
                diarization_claim_owner("job-b"),
            )

    def test_route_enabled_state_follows_saved_routing_config(self):
        config = {
            "diarizationProfiles": {
                "includeEnvironment": False,
                "profiles": [
                    {"id": "gpu-1", "enabled": True},
                    {"id": "gpu-2", "enabled": False},
                ],
            },
        }
        with patch("jobs.diarization.call_resource", return_value=config):
            self.assertFalse(is_diarization_route_enabled("environment"))
            self.assertTrue(is_diarization_route_enabled("gpu-1"))
            self.assertFalse(is_diarization_route_enabled("gpu-2"))
            self.assertFalse(is_diarization_route_enabled("removed-route"))

    def test_disabling_route_stops_batch_before_next_external_request(self):
        sequences = [object(), object()]
        updates = []

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=4),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=sequences,
            ),
            patch(
                "jobs.diarization.is_diarization_route_enabled",
                side_effect=[True, True, False],
            ),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "diarized",
                    "chunks_diarized": 2,
                    "segments": 3,
                },
            ) as diarize,
        ):
            result = process_diarization_job(
                "job-route-off",
                DiarizationJobData(
                    limit=2,
                    routingContext={"providerProfileId": "environment"},
                ),
                updates.append,
            )

        self.assertEqual(diarize.call_count, 1)
        self.assertEqual(result["processed"], 2)
        self.assertFalse(result["hasMore"])
        self.assertTrue(result["routeDisabled"])
        self.assertEqual(updates[-1]["stage"], "stopping")

    def test_disabled_route_stops_before_sequence_scan(self):
        updates = []

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=4),
            patch(
                "jobs.diarization.is_diarization_route_enabled",
                return_value=False,
            ),
            patch("jobs.diarization.get_diarization_sequences") as sequences,
            patch("jobs.diarization.diarize_sequence") as diarize,
        ):
            result = process_diarization_job(
                "job-route-already-off",
                DiarizationJobData(
                    limit=2,
                    routingContext={"providerProfileId": "gpu-4"},
                ),
                updates.append,
            )

        sequences.assert_not_called()
        diarize.assert_not_called()
        self.assertEqual(result["processed"], 0)
        self.assertFalse(result["hasMore"])
        self.assertTrue(result["routeDisabled"])
        self.assertEqual(updates[-1]["stage"], "stopping")

    def test_empty_campaign_is_finalized_instead_of_left_running(self):
        with (
            patch("jobs.diarization.count_pending_chunks", return_value=0),
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign") as update_campaign,
        ):
            result = process_diarization_job(
                "job-empty",
                DiarizationJobData(),
                lambda _progress: None,
            )

        self.assertFalse(result["hasMore"])
        self.assertEqual(update_campaign.call_args.args[1]["status"], "completed")

    def test_campaign_eta_uses_recent_batch_rates_and_requires_two_samples(self):
        self.assertIsNone(campaign_rate_estimate([2.0]))
        estimate = campaign_rate_estimate([1.0, 3.0, 5.0])
        self.assertGreater(estimate, 1.0)
        self.assertLess(estimate, 5.0)

    def test_count_timeout_does_not_block_diarization_work(self):
        updates = []

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization.count_pending_chunks", side_effect=TimeoutError("count timed out")),
            patch("jobs.diarization.get_diarization_sequences", return_value=[object()]),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={"status": "diarized", "chunks_diarized": 2, "segments": 3},
            ),
        ):
            result = process_diarization_job(
                "job-count-timeout",
                DiarizationJobData(limit=1),
                updates.append,
            )

        self.assertEqual(result["processed"], 2)
        self.assertTrue(result["hasMore"])
        self.assertTrue(any(update.get("total_estimated") for update in updates))
        self.assertTrue(any(update.get("total_chunks") is None for update in updates))

    def test_job_limits_work_and_reports_continuation(self):
        sequence = object()

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign") as update_campaign,
            patch("jobs.diarization.count_pending_chunks", return_value=10),
            # Batch estimation reads a deployment-tuned constant; pinning it
            # keeps the expected batch count independent of the local .env.
            patch("jobs.diarization.MAX_SEQUENCE_CHUNKS", 6),
            patch("jobs.diarization.get_diarization_sequences", return_value=[sequence]) as get_sequences,
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={"status": "diarized", "chunks_diarized": 2, "segments": 3},
            ),
        ):
            result = process_diarization_job(
                "job-1",
                DiarizationJobData(limit=1),
                lambda _progress: None,
            )

        self.assertIsNone(get_sequences.call_args.kwargs["limit"])
        self.assertTrue(result["hasMore"])
        self.assertEqual(result["processed"], 2)
        self.assertTrue(result["campaignId"].startswith("diarization-"))
        campaign_updates = [call.args[1] for call in update_campaign.call_args_list]
        self.assertTrue(any(update.get("batchNumber") == 1 for update in campaign_updates))
        self.assertTrue(any(update.get("estimatedBatches") == 2 for update in campaign_updates))

    def test_lost_claim_scans_forward_without_consuming_batch_capacity(self):
        sequences = [object(), object()]

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=4),
            patch("jobs.diarization.get_diarization_sequences", return_value=sequences),
            patch(
                "jobs.diarization.diarize_sequence",
                side_effect=[
                    {"status": "skipped", "chunks_diarized": 0, "segments": 0},
                    {"status": "diarized", "chunks_diarized": 2, "segments": 3},
                ],
            ) as diarize,
        ):
            result = process_diarization_job(
                "job-parallel",
                DiarizationJobData(limit=1),
                lambda _progress: None,
            )

        self.assertEqual(diarize.call_count, 2)
        self.assertEqual(result["sequences_processed"], 1)
        self.assertEqual(result["skippedSequences"], 1)
        self.assertEqual(result["processed"], 2)

    def test_job_closes_sequence_cursor_after_filling_batch(self):
        class ClosingIterator:
            def __init__(self):
                self._items = iter([object(), object()])
                self.closed = False

            def __iter__(self):
                return self

            def __next__(self):
                return next(self._items)

            def close(self):
                self.closed = True

        sequences = ClosingIterator()

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks", return_value=4),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=sequences,
            ),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "diarized",
                    "chunks_diarized": 2,
                    "segments": 3,
                },
            ),
        ):
            process_diarization_job(
                "job-close-cursor",
                DiarizationJobData(limit=1),
                lambda _progress: None,
            )

        self.assertTrue(sequences.closed)

    def test_continuation_reuses_campaign_total_without_wide_recount(self):
        updates = []
        campaign = {
            "campaignId": "diarization-historical-existing",
            "totalChunks": 100,
            "processedChunks": 12,
            "processedSequences": 4,
            "segmentsCreated": 20,
            "errorCount": 0,
            "jobIds": ["job-before"],
        }

        with (
            patch("jobs.diarization._campaign_call", return_value=campaign),
            patch("jobs.diarization._update_campaign"),
            patch("jobs.diarization.count_pending_chunks") as count,
            patch("jobs.diarization.get_diarization_sequences", return_value=[object()]),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={"status": "diarized", "chunks_diarized": 2, "segments": 3},
            ),
        ):
            result = process_diarization_job(
                "job-continuation",
                DiarizationJobData(
                    campaignId="diarization-historical-existing",
                    limit=1,
                ),
                updates.append,
            )

        count.assert_not_called()
        processing = [update for update in updates if update.get("stage") == "processing"]
        self.assertEqual(processing[0]["total_chunks"], 100)
        self.assertEqual(processing[0]["chunks_remaining"], 88)
        self.assertEqual(processing[-1]["chunks_processed"], 14)
        self.assertEqual(processing[-1]["chunks_remaining"], 86)
        self.assertTrue(result["hasMore"])

    def test_one_failed_sequence_does_not_end_a_campaign_of_unknown_size(self):
        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign"),
            patch(
                "jobs.diarization.count_pending_chunks",
                side_effect=TimeoutError("count timed out"),
            ),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=[object(), object()],
            ),
            patch(
                "jobs.diarization.diarize_sequence",
                side_effect=[
                    {"status": "diarized", "chunks_diarized": 2, "segments": 3},
                    {
                        "status": "error",
                        "error": "audio decode failed",
                        "chunks_diarized": 0,
                        "segments": 0,
                        "errorDetail": {
                            "category": "invalid_audio",
                            "retryable": True,
                        },
                    },
                ],
            ),
        ):
            result = process_diarization_job(
                "job-partial-failure",
                DiarizationJobData(limit=2),
                lambda _progress: None,
            )

        self.assertEqual(result["successfulSequences"], 1)
        self.assertEqual(result["failedSequences"], 1)
        self.assertTrue(result["hasMore"])

    def test_reports_complete_progress_after_each_sequence(self):
        updates = []

        with (
            patch("time.monotonic", side_effect=[100.0, 106.0]),
            patch("jobs.diarization._campaign_call", return_value=None),
            patch(
                "jobs.diarization.get_speaker_profiles_snapshot",
                return_value=[],
            ),
            patch("jobs.diarization.count_pending_chunks", return_value=10),
            patch("jobs.diarization.get_diarization_sequences", return_value=[object()]),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={"status": "diarized", "chunks_diarized": 3, "segments": 4},
            ),
        ):
            process_diarization_job(
                "job-progress",
                DiarizationJobData(limit=1),
                updates.append,
            )

        progress = updates[-1]
        self.assertEqual(progress["stage"], "processing")
        self.assertEqual(progress["total_chunks"], 10)
        self.assertEqual(progress["chunks_processed"], 3)
        self.assertEqual(progress["chunks_remaining"], 7)
        self.assertEqual(progress["sequences_processed"], 1)
        self.assertEqual(progress["segments_created"], 4)
        self.assertEqual(progress["errors"], 0)
        self.assertEqual(progress["elapsed_seconds"], 6.0)
        self.assertEqual(progress["chunks_per_second"], 0.5)
        self.assertEqual(progress["worker_chunks_per_second"], 0.5)
        self.assertEqual(progress["batch_sequences_processed"], 1)
        self.assertEqual(progress["batch_sequences_total"], 1)
        self.assertEqual(progress["batch_chunks_processed"], 3)
        self.assertIsNone(progress["eta_seconds"])
        self.assertEqual(progress["eta_confidence"], "low")

    def test_worker_rate_is_not_the_smoothed_recent_job_average(self):
        updates = []
        campaign = {
            "campaignId": "diarization-rate-semantics",
            "totalChunks": 100,
            "processedChunks": 10,
            "processedSequences": 2,
            "segmentsCreated": 4,
            "errorCount": 0,
            "jobIds": ["job-before"],
            "rateSamples": [2.0, 4.0],
        }

        with (
            patch("time.monotonic", side_effect=[100.0, 106.0]),
            patch("jobs.diarization._campaign_call", return_value=campaign),
            patch("jobs.diarization._update_campaign"),
            patch(
                "jobs.diarization.get_speaker_profiles_snapshot",
                return_value=[],
            ),
            patch("jobs.diarization.count_pending_chunks") as count,
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=[object()],
            ),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "diarized",
                    "chunks_diarized": 3,
                    "segments": 4,
                },
            ),
        ):
            result = process_diarization_job(
                "job-current-worker",
                DiarizationJobData(campaignId=campaign["campaignId"], limit=1),
                updates.append,
            )

        count.assert_not_called()
        progress = updates[-1]
        self.assertEqual(progress["worker_chunks_per_second"], 0.5)
        self.assertEqual(result["worker_chunks_per_second"], 0.5)
        self.assertNotEqual(
            progress["chunks_per_second"],
            progress["worker_chunks_per_second"],
        )

    def test_structured_sequence_errors_are_returned(self):
        structured = {
            "category": "invalid_audio",
            "message": "bad opus",
            "originalId": str(ObjectId()),
            "start": datetime.now(tz=UTC),
            "end": datetime.now(tz=UTC),
            "route": "https://diar.example",
            "attempt": 1,
            "retryable": True,
        }
        with (
            patch("jobs.diarization.count_pending_chunks", return_value=2),
            patch("jobs.diarization.get_diarization_sequences", return_value=[object()]),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "error",
                    "chunks_diarized": 1,
                    "segments": 0,
                    "error": "bad opus",
                    "errorDetail": structured,
                },
            ),
        ):
            result = process_diarization_job(
                "job-errors",
                DiarizationJobData(limit=1),
                lambda _progress: None,
            )

        self.assertEqual(result["errorCount"], 1)
        self.assertEqual(result["errors"], [structured])
        self.assertEqual(result["failedSequences"], 1)

    def test_zero_progress_errors_fail_the_job(self):
        structured = {
            "message": "boom",
            "retryable": True,
            "retryAt": datetime.now(tz=UTC),
        }
        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign") as update_campaign,
            patch("jobs.diarization.count_pending_chunks", return_value=3),
            patch("jobs.diarization.get_diarization_sequences", return_value=[object()]),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={
                    "status": "error",
                    "chunks_diarized": 0,
                    "segments": 0,
                    "error": "boom",
                    "errorDetail": structured,
                },
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                process_diarization_job(
                    "job-1",
                    DiarizationJobData(limit=1),
                    lambda _progress: None,
                )

        final_update = update_campaign.call_args.args[1]
        self.assertEqual(final_update["status"], "interrupted")
        self.assertEqual(final_update["errors"], [structured])

    def test_provider_network_failure_interrupts_partial_batch_for_watchdog_retry(self):
        retry_at = datetime.now(tz=UTC)
        structured = {
            "category": "provider_network",
            "message": "connection refused",
            "retryable": True,
            "retryAt": retry_at,
        }
        sequences = [object(), object(), object()]

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign") as update_campaign,
            patch("jobs.diarization.count_pending_chunks", return_value=6),
            patch("jobs.diarization.get_diarization_sequences", return_value=sequences),
            patch(
                "jobs.diarization.diarize_sequence",
                side_effect=[
                    {"status": "diarized", "chunks_diarized": 2, "segments": 3},
                    {
                        "status": "error",
                        "chunks_diarized": 0,
                        "segments": 0,
                        "error": "connection refused",
                        "errorDetail": structured,
                    },
                    {"status": "diarized", "chunks_diarized": 2, "segments": 3},
                ],
            ) as diarize,
        ):
            result = process_diarization_job(
                "job-provider-down",
                DiarizationJobData(limit=3),
                lambda _progress: None,
            )

        self.assertEqual(diarize.call_count, 2)
        self.assertEqual(result["processed"], 2)
        self.assertFalse(result["hasMore"])
        self.assertTrue(result["retryScheduled"])
        self.assertEqual(result["successfulSequences"], 1)
        self.assertEqual(result["failedSequences"], 1)
        final_update = update_campaign.call_args.args[1]
        self.assertEqual(final_update["status"], "interrupted")
        self.assertEqual(final_update["nextRetryAt"], retry_at)
        self.assertIsNone(final_update["finishedAt"])

    def test_provider_busy_stops_following_posts_and_preserves_retry_time(self):
        retry_at = datetime.now(tz=UTC) + timedelta(seconds=1)
        structured = {
            "category": "provider_busy",
            "message": "HTTP 429: provider queue full",
            "retryable": True,
            "retryAt": retry_at,
        }
        sequences = [object(), object(), object()]

        with (
            patch("jobs.diarization._campaign_call", return_value=None),
            patch("jobs.diarization._update_campaign") as update_campaign,
            patch("jobs.diarization.count_pending_chunks", return_value=6),
            patch(
                "jobs.diarization.get_diarization_sequences",
                return_value=sequences,
            ),
            patch(
                "jobs.diarization.get_speaker_profiles_snapshot",
                return_value=[],
            ),
            patch(
                "jobs.diarization.diarize_sequence",
                side_effect=[
                    {
                        "status": "diarized",
                        "chunks_diarized": 2,
                        "segments": 3,
                    },
                    {
                        "status": "error",
                        "chunks_diarized": 0,
                        "segments": 0,
                        "error": "HTTP 429: provider queue full",
                        "errorDetail": structured,
                    },
                    {
                        "status": "diarized",
                        "chunks_diarized": 2,
                        "segments": 3,
                    },
                ],
            ) as diarize,
        ):
            result = process_diarization_job(
                "job-provider-busy",
                DiarizationJobData(limit=3),
                lambda _progress: None,
            )

        self.assertEqual(diarize.call_count, 2)
        self.assertEqual(result["processed"], 2)
        self.assertFalse(result["hasMore"])
        self.assertTrue(result["retryScheduled"])
        self.assertEqual(result["failedSequences"], 1)
        final_update = update_campaign.call_args.args[1]
        self.assertEqual(final_update["status"], "interrupted")
        self.assertEqual(final_update["nextRetryAt"], retry_at)
        self.assertIsNone(final_update["finishedAt"])


class SpeakerMatchingJobTest(TestCase):
    def test_time_range_is_applied_and_continuation_uses_camel_case(self):
        start = datetime(2026, 8, 1, tzinfo=UTC)
        end = datetime(2026, 8, 2, tzinfo=UTC)
        profile = {
            "_id": ObjectId(),
            "name": "Sky",
            "embedding": [1.0, 0.0],
            "embeddingSpaceId": "space-v1",
            "revision": 4,
        }
        segment = {
            "_id": ObjectId(),
            "embedding": [0.0, 1.0],
            "embeddingSpaceId": "space-v1",
        }

        def resource(_name, request):
            if request["action"] == "getFirstBatch":
                self.assertEqual(request["query"]["start"], {"$gte": start, "$lte": end})
                self.assertEqual(
                    request["query"]["embeddingSpaceId"],
                    {
                        "$exists": True,
                        "$nin": ["", "unknown", "legacy-unknown"],
                    },
                )
                return {"cursorId": "cursor", "hasMore": True, "data": [segment]}
            raise AssertionError(request)

        with (
            patch("jobs.speaker_matching.get_all_profiles", return_value=[profile]),
            patch("jobs.speaker_matching.call_resource", side_effect=resource),
        ):
            result = process_speaker_matching_job(
                "job-1",
                SpeakerMatchingJobData(limit=1, start=start, end=end),
                lambda _progress: None,
            )

        self.assertTrue(result["hasMore"])
        self.assertNotIn("has_more", result)
