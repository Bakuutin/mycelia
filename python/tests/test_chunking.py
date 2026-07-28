from pathlib import Path
from subprocess import CalledProcessError
from sys import path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch

path.insert(0, str(Path(__file__).resolve().parents[1]))

import chunking  # noqa: E402


class SplitToOpusChunksTest(TestCase):
    def test_retry_removes_files_left_by_an_interrupted_attempt(self):
        with TemporaryDirectory() as temp_dir:
            staging = Path(temp_dir) / "chunks"
            staging.mkdir()
            stale_chunk = staging / "0000000000.opus"
            stale_chunk.write_bytes(b"stale")

            with (
                patch("chunking.get_tmp_dir", return_value=str(staging)),
                patch("chunking.subprocess.run") as run,
            ):
                chunks = chunking.split_to_opus_chunks("recording.m4a")

            run.assert_called_once()
            self.assertEqual(chunks, [])
            self.assertFalse(stale_chunk.exists())

    def test_permission_failure_preserves_ffmpeg_diagnostic_and_guidance(self):
        failure = CalledProcessError(
            255,
            ["ffmpeg"],
            stderr="Error opening input: Operation not permitted",
        )

        with TemporaryDirectory() as temp_dir:
            with (
                patch("chunking.get_tmp_dir", return_value=temp_dir),
                patch("chunking.subprocess.run", side_effect=failure),
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "macOS denied access.*Full Disk Access",
                ):
                    chunking.split_to_opus_chunks("recording.m4a")


if __name__ == "__main__":
    main()
