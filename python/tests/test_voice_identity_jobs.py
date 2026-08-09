from datetime import UTC, datetime
from pathlib import Path
from sys import path
from unittest import TestCase
from unittest.mock import patch

from bson import ObjectId

path.insert(0, str(Path(__file__).resolve().parents[1]))

from jobs.diarization import DiarizationJobData, process_diarization_job  # noqa: E402
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
    def test_job_limits_work_and_reports_continuation(self):
        sequence = object()

        with (
            patch("jobs.diarization.count_pending_chunks", return_value=10),
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

    def test_zero_progress_errors_fail_the_job(self):
        with (
            patch("jobs.diarization.count_pending_chunks", return_value=3),
            patch("jobs.diarization.get_diarization_sequences", return_value=[object()]),
            patch(
                "jobs.diarization.diarize_sequence",
                return_value={"status": "error", "chunks_diarized": 0, "segments": 0, "error": "boom"},
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                process_diarization_job(
                    "job-1",
                    DiarizationJobData(limit=1),
                    lambda _progress: None,
                )


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
