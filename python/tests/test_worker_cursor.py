from pathlib import Path
from sys import path
from unittest import TestCase, main
from unittest.mock import patch

path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.worker import mongo_cursor  # noqa: E402


class MongoCursorTest(TestCase):
    def test_early_stop_explicitly_closes_backend_cursor(self):
        requests = []

        def resource(_name, request):
            requests.append(request)
            if request["action"] == "getFirstBatch":
                return {
                    "cursorId": "cursor-1",
                    "data": [{"_id": 1}, {"_id": 2}],
                    "hasMore": True,
                }
            if request["action"] == "closeCursor":
                return {"closed": True}
            raise AssertionError(request)

        with patch("lib.worker.call_resource", side_effect=resource):
            cursor = mongo_cursor("audio_chunks", {}, {}, batch_size=2)
            self.assertEqual(next(cursor), {"_id": 1})
            cursor.close()

        self.assertEqual(
            [request["action"] for request in requests],
            ["getFirstBatch", "closeCursor"],
        )
        self.assertEqual(requests[-1]["cursorId"], "cursor-1")

    def test_exhausted_cursor_does_not_send_redundant_close(self):
        requests = []

        def resource(_name, request):
            requests.append(request)
            return {
                "cursorId": "",
                "data": [{"_id": 1}],
                "hasMore": False,
            }

        with patch("lib.worker.call_resource", side_effect=resource):
            self.assertEqual(
                list(mongo_cursor("audio_chunks", {}, {}, batch_size=2)),
                [{"_id": 1}],
            )

        self.assertEqual(
            [request["action"] for request in requests],
            ["getFirstBatch"],
        )


if __name__ == "__main__":
    main()
