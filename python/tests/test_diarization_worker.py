from datetime import datetime, timedelta
from pathlib import Path
from sys import path
from unittest import TestCase, main
from unittest.mock import patch

from bson import ObjectId
from pytz import UTC

path.insert(0, str(Path(__file__).resolve().parents[1]))

from diarization_worker import (  # noqa: E402
    DiarizationSequence,
    SPEAKER_SIMILARITY_THRESHOLD,
    _build_diarization_request_fields,
    _clip_continuation_segment,
    _reconcile_speaker_labels,
    mark_as_diarized,
)


def _sequence(*, partial: bool = False) -> DiarizationSequence:
    original_id = ObjectId()
    now = datetime.now(tz=UTC)
    return DiarizationSequence(
        original_id=original_id,
        is_partial=partial,
        chunks=[
            {"_id": ObjectId(), "original_id": original_id, "index": 0, "start": now},
            {"_id": ObjectId(), "original_id": original_id, "index": 1, "start": now},
        ],
    )


class DiarizationWorkerTest(TestCase):
    def test_similarity_threshold_is_sent_as_query_parameter(self):
        data, params = _build_diarization_request_fields("[]")

        self.assertEqual(data, {"clusters": "[]"})
        self.assertEqual(
            params,
            {"similarity_threshold": str(SPEAKER_SIMILARITY_THRESHOLD)},
        )

    def test_mark_as_diarized_completes_and_releases_full_sequence_claims(self):
        sequence = _sequence()

        with (
            patch(
                "diarization_worker.call_resource",
                return_value={"modifiedCount": 2},
            ) as call,
            patch("diarization_worker.release_chunks") as release,
        ):
            self.assertEqual(mark_as_diarized(sequence, "worker-1"), 2)

        request = call.call_args.args[1]
        self.assertEqual(request["query"]["processing_by"], "worker-1")
        self.assertIsNone(request["update"]["$set"]["processing_by"])
        self.assertIsNone(request["update"]["$set"]["claimed_at"])
        release.assert_not_called()

    def test_mark_as_diarized_releases_partial_sequence_overlap(self):
        sequence = _sequence(partial=True)

        with (
            patch(
                "diarization_worker.call_resource",
                return_value={"modifiedCount": 1},
            ) as call,
            patch("diarization_worker.release_chunks") as release,
        ):
            self.assertEqual(mark_as_diarized(sequence, "worker-1"), 1)

        request = call.call_args.args[1]
        self.assertEqual(
            request["query"]["_id"]["$in"],
            [sequence.chunks[0]["_id"]],
        )
        release.assert_called_once_with([sequence.last["_id"]], "worker-1")

    def test_reconciles_local_labels_with_previous_overlap(self):
        current = [
            {"speaker": "SPEAKER_00", "embedding": [0.0, 1.0]},
            {"speaker": "SPEAKER_01", "embedding": [1.0, 0.0]},
            {"speaker": "SPEAKER_02", "embedding": [0.7, 0.7]},
        ]
        previous = [
            {"speaker": "SPEAKER_00", "embedding": [1.0, 0.0]},
            {"speaker": "SPEAKER_01", "embedding": [0.0, 1.0]},
        ]

        mapping = _reconcile_speaker_labels(
            current,
            previous,
            threshold=0.9,
            reserved_labels={"SPEAKER_00", "SPEAKER_01", "SPEAKER_02"},
        )

        self.assertEqual(mapping["SPEAKER_00"], "SPEAKER_01")
        self.assertEqual(mapping["SPEAKER_01"], "SPEAKER_00")
        self.assertEqual(mapping["SPEAKER_02"], "SPEAKER_03")

    def test_continuation_segments_are_deduplicated_and_clipped(self):
        boundary = datetime.now(tz=UTC)

        duplicate = _clip_continuation_segment(
            boundary - timedelta(seconds=2),
            boundary,
            boundary,
        )
        crossing = _clip_continuation_segment(
            boundary - timedelta(seconds=1),
            boundary + timedelta(seconds=2),
            boundary,
        )

        self.assertIsNone(duplicate)
        self.assertEqual(crossing, (boundary, boundary + timedelta(seconds=2)))


if __name__ == "__main__":
    main()
