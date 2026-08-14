from datetime import UTC, datetime
from pathlib import Path
from sys import path
from unittest import TestCase
from unittest.mock import patch

from bson import ObjectId

path.insert(0, str(Path(__file__).resolve().parents[1]))

from jobs.diarization import (  # noqa: E402
    DiarizationJobData,
    campaign_rate_estimate,
    process_diarization_job,
)
from jobs.enrollment import EnrollmentJobData, process_enrollment_job  # noqa: E402
from jobs.speaker_matching import (  # noqa: E402
    SpeakerMatchingJobData,
    process_speaker_matching_job,
)


class EnrollmentJobTest(TestCase):
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

        self.assertEqual(get_sequences.call_args.kwargs["limit"], 1)
        self.assertTrue(result["hasMore"])
        self.assertEqual(result["processed"], 2)
        self.assertTrue(result["campaignId"].startswith("diarization-"))
        campaign_updates = [call.args[1] for call in update_campaign.call_args_list]
        self.assertTrue(any(update.get("batchNumber") == 1 for update in campaign_updates))
        self.assertTrue(any(update.get("estimatedBatches") == 2 for update in campaign_updates))

    def test_continuation_recounts_ready_backlog_and_replaces_stale_total(self):
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
            patch("jobs.diarization.count_pending_chunks", return_value=8) as count,
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

        count.assert_called_once_with(None)
        processing = [update for update in updates if update.get("stage") == "processing"]
        self.assertEqual(processing[0]["total_chunks"], 20)
        self.assertEqual(processing[0]["chunks_remaining"], 8)
        self.assertEqual(processing[-1]["chunks_processed"], 14)
        self.assertEqual(processing[-1]["chunks_remaining"], 6)
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
        self.assertIsNone(progress["eta_seconds"])
        self.assertEqual(progress["eta_confidence"], "low")

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


class SpeakerMatchingJobTest(TestCase):
    def test_time_range_is_applied_and_continuation_uses_camel_case(self):
        start = datetime(2026, 8, 1, tzinfo=UTC)
        end = datetime(2026, 8, 2, tzinfo=UTC)
        profile = {"_id": ObjectId(), "name": "Sky", "embedding": [1.0, 0.0]}
        segment = {"_id": ObjectId(), "embedding": [0.0, 1.0]}

        def resource(_name, request):
            if request["action"] == "getFirstBatch":
                self.assertEqual(request["query"]["start"], {"$gte": start, "$lte": end})
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
