from datetime import UTC, datetime, timedelta
from pathlib import Path
from sys import path
from unittest import TestCase

from bson import ObjectId

path.insert(0, str(Path(__file__).resolve().parents[1]))

from debug.dedupe_diarization_segments import (  # noqa: E402
    duplicate_ids,
    keeper_and_duplicates,
)


class DiarizationDedupeTest(TestCase):
    def test_keeper_prefers_matched_segment_then_earliest(self):
        now = datetime.now(tz=UTC)
        unmatched = ObjectId()
        later_matched = ObjectId()
        earlier_matched = ObjectId()
        group = {
            "documents": [
                {
                    "id": unmatched,
                    "createdAt": now - timedelta(minutes=10),
                    "matched": False,
                    "similarity": -1,
                },
                {
                    "id": later_matched,
                    "createdAt": now,
                    "matched": True,
                    "similarity": 0.9,
                },
                {
                    "id": earlier_matched,
                    "createdAt": now - timedelta(minutes=1),
                    "matched": True,
                    "similarity": 0.9,
                },
            ]
        }

        keeper, duplicates = keeper_and_duplicates(group)

        self.assertEqual(keeper, earlier_matched)
        self.assertEqual(set(duplicates), {unmatched, later_matched})
        self.assertEqual(set(duplicate_ids([group])), set(duplicates))
