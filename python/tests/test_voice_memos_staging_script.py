import json
import os
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from unittest import TestCase, main

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPOSITORY_ROOT / "scripts/refresh-voice-memos-staging.sh"


class VoiceMemosStagingScriptTest(TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.archive_tool = self.root / "archive-tool"
        self.archive_root = self.root / "archive"
        self.staging_root = self.root / "staging"
        self.command_log = self.root / "commands.log"

        scripts = self.archive_tool / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "run.sh").write_text(
            '#!/usr/bin/env bash\nprintf "run:%s\\n" "$*" >> "$VOICE_TEST_LOG"\n',
            encoding="utf-8",
        )
        (scripts / "verify.sh").write_text(
            '#!/usr/bin/env bash\nprintf "verify:%s\\n" "$*" >> "$VOICE_TEST_LOG"\n',
            encoding="utf-8",
        )
        (
            self.archive_root / "data/voice-memos/audio-original"
        ).mkdir(parents=True)

        self.environment = {
            **os.environ,
            "HOME": str(self.root / "home"),
            "ICLOUD_ARCHIVE_TOOL_ROOT": str(self.archive_tool),
            "MYCELIA_VOICE_MEMOS_ARCHIVE_ROOT": str(self.archive_root),
            "MYCELIA_VOICE_MEMOS_STAGING_ROOT": str(self.staging_root),
            "MYCELIA_APPLE_VOICEMEMOS_NOT_BEFORE": "2001-01-01T00:00:00+00:00",
            "VOICE_TEST_LOG": str(self.command_log),
        }

    def tearDown(self):
        self.temporary_directory.cleanup()

    def add_completed_snapshot(self, run_id: str, *, valid: bool = True) -> Path:
        manifest = self.archive_root / "manifests" / run_id
        manifest.mkdir(parents=True)
        (manifest / "run.json").write_text(
            json.dumps({"completed": True, "components": ["voice-memos"]}),
            encoding="utf-8",
        )
        (manifest / "voice-memos.json").write_text(
            json.dumps({"sqlite_snapshots": ["CloudRecordings.snapshot.db"]}),
            encoding="utf-8",
        )
        snapshot = (
            self.archive_root
            / "data/voice-memos/native-metadata/snapshots"
            / run_id
            / "CloudRecordings.snapshot.db"
        )
        snapshot.parent.mkdir(parents=True)
        if valid:
            with sqlite3.connect(snapshot) as database:
                database.execute("CREATE TABLE marker (value TEXT NOT NULL)")
                database.execute("INSERT INTO marker VALUES (?)", (run_id,))
                database.execute(
                    "CREATE TABLE ZCLOUDRECORDING (ZPATH TEXT, ZDATE REAL)"
                )
                database.execute(
                    "INSERT INTO ZCLOUDRECORDING VALUES (?, ?)",
                    ("memo.m4a", 1.0),
                )
            (
                self.archive_root
                / "data/voice-memos/audio-original/memo.m4a"
            ).write_bytes(b"voice memo fixture")
        else:
            snapshot.write_bytes(b"not a SQLite database")
        return snapshot

    def run_script(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), *arguments],
            cwd=REPOSITORY_ROOT,
            env=self.environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_publish_latest_verifies_and_atomically_publishes_snapshot(self):
        source = self.add_completed_snapshot("20260901T120000Z-1")

        result = self.run_script("--publish-latest")

        self.assertEqual(result.returncode, 0, result.stderr)
        published = self.staging_root / "CloudRecordings.snapshot.db"
        self.assertTrue(published.is_file())
        self.assertEqual(
            (self.staging_root / "audio-original/memo.m4a").read_bytes(),
            b"voice memo fixture",
        )
        with sqlite3.connect(published) as database:
            self.assertEqual(
                database.execute("SELECT value FROM marker").fetchone(),
                ("20260901T120000Z-1",),
            )
        status = json.loads(
            (self.staging_root / "sync-status.json").read_text(encoding="utf-8")
        )
        self.assertEqual(status["source_snapshot"], str(source))
        self.assertEqual(status["staged_audio_files"], 1)
        self.assertEqual(len(status["snapshot_sha256"]), 64)
        self.assertEqual(
            self.command_log.read_text(encoding="utf-8").strip(),
            "verify:--components voice-memos --full",
        )

    def test_invalid_new_snapshot_does_not_replace_last_good_database(self):
        self.add_completed_snapshot("20260901T120000Z-1")
        first = self.run_script("--publish-latest")
        self.assertEqual(first.returncode, 0, first.stderr)
        published = self.staging_root / "CloudRecordings.snapshot.db"
        original_bytes = published.read_bytes()

        self.add_completed_snapshot("20260901T130000Z-2", valid=False)
        second = self.run_script("--publish-latest")

        self.assertNotEqual(second.returncode, 0)
        self.assertIn("not a database", second.stderr)
        self.assertEqual(published.read_bytes(), original_bytes)


if __name__ == "__main__":
    main()
