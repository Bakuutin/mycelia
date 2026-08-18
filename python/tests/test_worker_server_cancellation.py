import threading
from pathlib import Path
from sys import path
from unittest import IsolatedAsyncioTestCase, main

path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker_server import run_in_thread_with_context  # noqa: E402


class WorkerServerCancellationTest(IsolatedAsyncioTestCase):
    async def test_disconnected_request_signals_sync_processor(self):
        cancel_event = threading.Event()

        class DisconnectedRequest:
            async def is_disconnected(self):
                return True

        def processor():
            self.assertTrue(cancel_event.wait(timeout=2.0))
            return "cancelled"

        result = await run_in_thread_with_context(
            processor,
            request=DisconnectedRequest(),
            cancel_event=cancel_event,
        )

        self.assertEqual(result, "cancelled")
        self.assertTrue(cancel_event.is_set())


if __name__ == "__main__":
    main()
