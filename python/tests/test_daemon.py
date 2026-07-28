from pathlib import Path
from sys import path
from unittest import TestCase, main
from unittest.mock import patch

path.insert(0, str(Path(__file__).resolve().parents[1]))

import daemon  # noqa: E402


class DaemonCliTest(TestCase):
    def test_successful_retry_clears_cached_ingestion_error(self):
        source = {
            "_id": "source-1",
            "path": "/tmp/voice-memo.m4a",
            "platform": {"importer": "apple_voicememos"},
        }
        importer = type("Importer", (), {"upload": lambda self, value: None})()
        responses = iter([1, 0, 0, [source], {"modifiedCount": 1}])

        with (
            patch("daemon.call_resource", side_effect=lambda *_: next(responses)) as call_resource,
            patch.dict(daemon.importer_map, {"apple_voicememos": importer}, clear=True),
        ):
            daemon.ingests_missing_sources(limit=1, retry_errors=True)

        update_call = call_resource.call_args_list[-1].args[1]
        self.assertEqual(update_call["action"], "updateOne")
        self.assertTrue(update_call["update"]["$set"]["ingested"])
        self.assertEqual(update_call["update"]["$unset"], {"ingestion": ""})

    def test_vad_only_runs_vad_cycle_without_import_cycle(self):
        with (
            patch("daemon.initialize_auth") as initialize_auth,
            patch("daemon.run_vad_cycle", return_value={}) as run_vad_cycle,
            patch("daemon.main") as run_import_cycle,
        ):
            daemon.cli([
                "--vad-only",
                "--vad-limit", "12",
                "--vad-batch-size", "3",
                "--once",
            ])

        initialize_auth.assert_called_once_with()
        run_vad_cycle.assert_called_once_with(limit=12, batch_size=3)
        run_import_cycle.assert_not_called()

    def test_default_mode_still_runs_import_cycle(self):
        with (
            patch("daemon.initialize_auth"),
            patch("daemon.run_vad_cycle") as run_vad_cycle,
            patch("daemon.main") as run_import_cycle,
        ):
            daemon.cli(["--once"])

        run_import_cycle.assert_called_once_with(reset_errors=False)
        run_vad_cycle.assert_not_called()

    def test_vad_only_rejects_reset_errors(self):
        with self.assertRaises(SystemExit):
            daemon.cli(["--vad-only", "--reset-errors", "--once"])

    def test_vad_limits_must_be_positive(self):
        with self.assertRaises(SystemExit):
            daemon.cli(["--vad-only", "--vad-limit", "0", "--once"])


if __name__ == "__main__":
    main()
