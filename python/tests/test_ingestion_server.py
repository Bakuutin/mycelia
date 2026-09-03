import asyncio
from pathlib import Path
from sys import path
from unittest import TestCase, main
from unittest.mock import patch

path.insert(0, str(Path(__file__).resolve().parents[1]))

import ingestion_server


class IngestionServerHealthTest(TestCase):
    def setUp(self):
        ingestion_server.last_cycle.clear()
        ingestion_server.last_cycle.update({"status": "not_started"})

    def test_discovery_failure_degrades_cycle_but_still_ingests_pending(self):
        source_results = [{
            "source": "apple_voicememos",
            "status": "failed",
            "error": "permission denied",
        }]
        with (
            patch("ingestion_server.import_new_files", return_value=source_results),
            patch("ingestion_server.ingests_missing_sources") as ingest,
        ):
            result = ingestion_server.run_ingestion_cycle(limit=20)

        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["sources"], source_results)
        ingest.assert_called_once_with(limit=20)

        with patch(
            "ingestion_server.get_apple_voicememos_mode",
            return_value="staged",
        ):
            health = asyncio.run(ingestion_server.health())
        self.assertEqual(health["status"], "degraded")
        self.assertEqual(health["appleVoiceMemosMode"], "staged")
        self.assertEqual(health["lastCycle"]["status"], "degraded")

    def test_successful_discovery_reports_healthy(self):
        source_results = [{
            "source": "apple_voicememos",
            "status": "completed",
            "discovered": 0,
        }]
        with (
            patch("ingestion_server.import_new_files", return_value=source_results),
            patch("ingestion_server.ingests_missing_sources"),
        ):
            ingestion_server.run_ingestion_cycle(limit=20)

        with patch(
            "ingestion_server.get_apple_voicememos_mode",
            return_value="manual",
        ):
            health = asyncio.run(ingestion_server.health())
        self.assertEqual(health["status"], "healthy")
        self.assertEqual(health["appleVoiceMemosMode"], "manual")


if __name__ == "__main__":
    main()
