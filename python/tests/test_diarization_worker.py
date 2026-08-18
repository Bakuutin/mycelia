from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from sys import path
from types import SimpleNamespace
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
    _classify_diarization_error,
    _segment_identity_key,
    _failure_retry_state,
    _get_overlap_segments,
    claim_sequence,
    diarize_sequence,
    get_diarization_sequences,
    hydrate_claimed_sequence,
    mark_as_diarized,
)


def _sequence(*, partial: bool = False) -> DiarizationSequence:
    original_id = ObjectId()
    now = datetime.now(tz=UTC)
    return DiarizationSequence(
        original_id=original_id,
        is_partial=partial,
        chunks=[
            {
                "_id": ObjectId(),
                "original_id": original_id,
                "index": 0,
                "start": now,
                "data": b"opus-0",
            },
            {
                "_id": ObjectId(),
                "original_id": original_id,
                "index": 1,
                "start": now,
                "data": b"opus-1",
            },
        ],
    )


def _diarize_response(segments: int = 3) -> SimpleNamespace:
    """Minimal stand-in for the diarizator /diarize response."""
    return SimpleNamespace(
        status_code=200,
        raise_for_status=lambda: None,
        json=lambda: {
            "embeddingSpaceId": "space-1",
            "segments": [
                {
                    "start": float(index * 2),
                    "end": float(index * 2 + 2),
                    "speaker": f"SPEAKER_{index % 2:02d}",
                    "embedding": [1.0, 0.0] if index % 2 == 0 else [0.0, 1.0],
                }
                for index in range(segments)
            ],
        },
    )


class DiarizationWorkerTest(TestCase):
    def test_sequence_cursor_reads_metadata_only_with_deadline_and_hint(self):
        original_id = ObjectId()
        start = datetime(2024, 1, 1, tzinfo=UTC)
        chunk = {
            "_id": ObjectId(),
            "original_id": original_id,
            "index": 0,
            "start": start,
        }

        with patch(
            "diarization_worker.mongo_cursor",
            return_value=iter([chunk]),
        ) as cursor:
            sequences = list(get_diarization_sequences(limit=1))

        self.assertEqual(len(sequences), 1)
        options = cursor.call_args.args[2]
        self.assertNotIn("data", options["projection"])
        self.assertEqual(options["hint"], "audio_chunks_diarization_pending_v2")
        self.assertEqual(options["maxTimeMS"], 5_000)

    def test_claimed_sequence_hydrates_only_owned_ids_in_original_order(self):
        sequence = _sequence()
        metadata = DiarizationSequence(
            original_id=sequence.original_id,
            chunks=[
                {key: value for key, value in chunk.items() if key != "data"}
                for chunk in sequence.chunks
            ],
        )
        hydrated_docs = list(reversed(sequence.chunks))

        with patch(
            "diarization_worker.call_resource",
            return_value=hydrated_docs,
        ) as call:
            hydrated = hydrate_claimed_sequence(metadata, "worker-1")

        request = call.call_args.args[1]
        self.assertEqual(request["query"]["processing_by"], "worker-1")
        self.assertEqual(request["options"]["limit"], len(metadata.chunks))
        self.assertEqual(request["options"]["maxTimeMS"], 5_000)
        self.assertEqual(
            [chunk["_id"] for chunk in hydrated.chunks],
            [chunk["_id"] for chunk in metadata.chunks],
        )
        self.assertTrue(all("data" in chunk for chunk in hydrated.chunks))

    def test_lost_claim_never_hydrates_audio(self):
        sequence = _sequence()
        for chunk in sequence.chunks:
            chunk.pop("data")

        with (
            patch(
                "diarization_worker.claim_sequence",
                return_value=(False, "other-worker"),
            ),
            patch("diarization_worker.hydrate_claimed_sequence") as hydrate,
        ):
            result = diarize_sequence(sequence, "worker-1")

        self.assertEqual(result["status"], "skipped")
        hydrate.assert_not_called()

    def test_claim_rechecks_pending_state_before_hydration(self):
        sequence = _sequence()

        with patch(
            "diarization_worker.claim_chunks",
            return_value=True,
        ) as claim:
            claimed, owner = claim_sequence(sequence, "worker-1")

        self.assertTrue(claimed)
        self.assertIsNone(owner)
        required = claim.call_args.kwargs["required_filters"]
        self.assertIsNone(required["processing_by"])
        self.assertIsNone(required["diarized_at"])
        self.assertTrue(required["vad.has_speech"])

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

    def test_segments_without_embeddings_do_not_reuse_a_reserved_label(self):
        mapping = _reconcile_speaker_labels(
            [{"speaker": "SPEAKER_00", "embedding": None}],
            [],
            reserved_labels={"SPEAKER_00"},
        )

        self.assertNotEqual(mapping["SPEAKER_00"], "SPEAKER_00")

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

    def test_overlap_lookup_accepts_direct_mongo_resource_arrays(self):
        sequence = _sequence()
        sequence.is_continuation = True
        segment = {"speaker": "SPEAKER_00", "embedding": [1.0, 0.0]}

        with patch("diarization_worker.call_resource", return_value=[segment]):
            self.assertEqual(_get_overlap_segments(sequence), [segment])

    def test_timeout_errors_are_structured_and_retryable(self):
        sequence = _sequence()

        error = _classify_diarization_error(
            sequence,
            "https://diar.example",
            TimeoutError("request timed out"),
            attempt=2,
        )

        self.assertEqual(error["category"], "timeout")
        self.assertTrue(error["retryable"])
        self.assertEqual(error["attempt"], 2)
        self.assertEqual(error["originalId"], str(sequence.original_id))
        self.assertEqual(error["route"], "https://diar.example")

    def test_server_errors_are_not_reported_as_invalid_audio(self):
        detail = _classify_diarization_error(
            _sequence(),
            "https://diar.example",
            RuntimeError(
                "500 Server Error for url: https://diar.example/diarize (audio.wav)"
            ),
            http_status=500,
        )

        self.assertEqual(detail["category"], "provider_http")

    def test_generation_segment_identity_is_stable(self):
        sequence = _sequence()

        first = _segment_identity_key("run-7", sequence, 3)
        second = _segment_identity_key("run-7", sequence, 3)

        self.assertEqual(first, second)
        self.assertNotEqual(first, _segment_identity_key("run-7", sequence, 4))

    def test_failure_retry_budget_stops_after_three_attempts(self):
        first = _failure_retry_state(1)
        third = _failure_retry_state(3)

        self.assertEqual(first["status"], "will_retry")
        self.assertEqual(first["delaySeconds"], 60)
        self.assertEqual(third["status"], "needs_attention")
        self.assertIsNone(third["delaySeconds"])

    def test_generation_failure_does_not_block_missing_diarization(self):
        sequence = _sequence()

        with (
            patch("diarization_worker.claim_sequence", return_value=(True, None)),
            patch("diarization_worker.combine_chunks_to_wav", return_value=(BytesIO(b"wav"), 16000)),
            patch("diarization_worker.requests.post", side_effect=TimeoutError("timed out")),
            patch("diarization_worker.release_sequence"),
            patch("diarization_worker._record_sequence_failure") as record_failure,
        ):
            result = diarize_sequence(
                sequence,
                "worker-1",
                run_id="run-1",
                mark_chunks=False,
                server_url="https://diar.example",
            )

        self.assertEqual(result["status"], "error")
        record_failure.assert_not_called()

    def test_generation_writes_one_identity_key_per_segment(self):
        sequence = _sequence()
        segment_keys = []

        def mongo(_resource, request):
            if request.get("collection") == "diarizations":
                if request["action"] == "bulkWrite":
                    segment_keys.extend(
                        operation["updateOne"]["filter"]["segmentKey"]
                        for operation in request["operations"]
                    )
                    return {"upsertedCount": len(request["operations"])}
                return []
            if request["action"] in ("find", "aggregate"):
                return []
            if request["action"] == "count":
                return 0
            return {}

        with (
            patch("diarization_worker.claim_sequence", return_value=(True, None)),
            patch("diarization_worker.combine_chunks_to_wav", return_value=(BytesIO(b"wav"), 16000)),
            patch("diarization_worker.requests.post", return_value=_diarize_response()),
            patch("diarization_worker.release_sequence"),
            patch("diarization_worker.call_resource", side_effect=mongo),
        ):
            result = diarize_sequence(
                sequence,
                "worker-1",
                run_id="run-1",
                mark_chunks=False,
                server_url="https://diar.example",
            )

        self.assertEqual(result["status"], "diarized")
        self.assertEqual(len(segment_keys), 3)
        self.assertEqual(len(set(segment_keys)), 3)

    def test_sequences_split_on_a_long_silent_gap(self):
        original_id = ObjectId()
        base = datetime(2024, 1, 1, tzinfo=UTC)
        chunks = [
            {"_id": ObjectId(), "original_id": original_id, "index": index, "start": start}
            for index, start in enumerate([
                base,
                base + timedelta(seconds=10),
                base + timedelta(seconds=300),
            ])
        ]

        with patch("diarization_worker.mongo_cursor", return_value=iter(chunks)):
            sequences = list(
                get_diarization_sequences(limit=None, max_sequence_length=6)
            )

        self.assertEqual([len(sequence.chunks) for sequence in sequences], [2, 1])

    def test_legacy_segments_are_idempotent_and_persisted_in_one_write(self):
        sequence = _sequence()
        writes = []

        def mongo(_resource, request):
            if request.get("collection") == "diarizations":
                if request["action"] in ("find", "aggregate"):
                    return []
                writes.append(request)
                return {}
            if request["action"] in ("find", "aggregate"):
                return []
            if request["action"] == "count":
                return 0
            return {}

        with (
            patch("diarization_worker.claim_sequence", return_value=(True, None)),
            patch("diarization_worker.combine_chunks_to_wav", return_value=(BytesIO(b"wav"), 16000)),
            patch("diarization_worker.requests.post", return_value=_diarize_response()),
            patch("diarization_worker.release_sequence"),
            patch("diarization_worker.call_resource", side_effect=mongo),
        ):
            result = diarize_sequence(
                sequence,
                "worker-1",
                mark_chunks=False,
                server_url="https://diar.example",
            )

        self.assertEqual(result["segments"], 3)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["action"], "bulkWrite")
        self.assertEqual(len(writes[0]["operations"]), 3)
        for operation in writes[0]["operations"]:
            update = operation["updateOne"]
            self.assertEqual(update["filter"]["runId"], "legacy-v0")
            self.assertTrue(update["filter"]["segmentKey"])
            self.assertTrue(update["upsert"])


if __name__ == "__main__":
    main()
