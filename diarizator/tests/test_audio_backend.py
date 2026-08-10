import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf
import torch

from simple_speaker_recognition.core.audio_backend import AudioBackend


class AudioBackendTest(unittest.TestCase):
    def setUp(self):
        self.backend = AudioBackend.__new__(AudioBackend)

    def test_short_turn_is_padded_for_embedding_without_changing_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            sf.write(path, np.zeros(16000, dtype=np.float32), 16000)

            wave = self.backend.load_wave(
                path,
                start=0.4,
                end=0.6,
                min_duration=0.5,
            )

            self.assertEqual(wave.shape, (1, 1, 8000))

    def test_community_one_is_default_without_legacy_pipeline_tuning(self):
        pipeline = Mock()
        pipeline.to.return_value = pipeline
        embedder = Mock(dimension=256)

        with (
            patch.dict("os.environ", {}, clear=True),
            patch(
                "simple_speaker_recognition.core.audio_backend.Pipeline.from_pretrained",
                return_value=pipeline,
            ) as load_pipeline,
            patch(
                "simple_speaker_recognition.core.audio_backend.PretrainedSpeakerEmbedding",
                return_value=embedder,
            ),
        ):
            AudioBackend("hf-token", torch.device("cpu"))

        load_pipeline.assert_called_once_with(
            "pyannote/speaker-diarization-community-1",
            token="hf-token",
        )
        pipeline.instantiate.assert_not_called()

    def test_short_turn_at_file_edge_uses_context_from_other_side(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            sf.write(path, np.zeros(16000, dtype=np.float32), 16000)

            wave = self.backend.load_wave(
                path,
                start=0.0,
                end=0.1,
                min_duration=0.5,
            )

            self.assertEqual(wave.shape, (1, 1, 8000))

    def test_diarization_passes_preloaded_waveform_to_pyannote(self):
        """CPU diarization must not depend on Pyannote's TorchCodec loader."""
        annotation = Mock()
        annotation.itertracks.return_value = []
        output = Mock(speaker_diarization=annotation)
        self.backend.diar = Mock(return_value=output)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            sf.write(path, np.zeros(8000, dtype=np.float32), 8000)

            self.backend.diarize(path)

        audio_input = self.backend.diar.call_args.args[0]
        self.assertIsInstance(audio_input, dict)
        self.assertEqual(audio_input["sample_rate"], 16000)
        self.assertEqual(audio_input["waveform"].shape, (1, 16000))

    def test_cluster_matching_skips_invalid_embeddings(self):
        match = self.backend.match_clusters(
            np.array([1.0, 0.0], dtype=np.float32),
            [
                {"id": "zero", "embedding": [0.0, 0.0]},
                {"id": "wrong-dimension", "embedding": [1.0]},
                {"id": "valid", "name": "Alice", "embedding": [0.9, 0.1]},
            ],
            threshold=0.8,
        )

        self.assertEqual(match["cluster_id"], "valid")
        self.assertEqual(match["cluster_name"], "Alice")


if __name__ == "__main__":
    unittest.main()
