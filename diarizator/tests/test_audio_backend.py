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

    def test_preloaded_waveform_can_be_cropped_without_decoding_again(self):
        waveform = torch.arange(16000, dtype=torch.float32).reshape(1, 1, -1)

        cropped = self.backend.crop_waveform(
            waveform,
            start=0.4,
            end=0.6,
            min_duration=0.5,
        )

        self.assertEqual(cropped.shape, (1, 1, 8000))

    def test_embedding_batch_uses_padding_masks_and_normalizes_rows(self):
        calls = []

        def embedder(batch, masks=None):
            calls.append((batch.cpu(), masks.cpu()))
            return np.array([[3.0, 4.0], [0.0, 2.0]], dtype=np.float32)

        self.backend.device = torch.device("cpu")
        self.backend.min_embedding_samples = 8000
        self.backend.embedder = embedder

        embeddings = self.backend.embed_batch(
            [
                torch.ones((1, 1, 8000)),
                torch.ones((1, 1, 10000)),
            ]
        )

        self.assertEqual(calls[0][0].shape, (2, 1, 10000))
        self.assertEqual(calls[0][1].shape, (2, 10000))
        self.assertEqual(int(calls[0][1][0].sum()), 8000)
        np.testing.assert_allclose(
            embeddings,
            np.array([[0.6, 0.8], [0.0, 1.0]], dtype=np.float32),
        )

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

    def test_diarization_reuses_supplied_waveform(self):
        annotation = Mock()
        annotation.itertracks.return_value = []
        self.backend.diar = Mock(return_value=Mock(speaker_diarization=annotation))
        self.backend.load_wave = Mock(side_effect=AssertionError("must not decode"))

        self.backend.diarize(
            Path("unused.wav"),
            waveform=torch.zeros((1, 1, 16000)),
        )

        self.backend.load_wave.assert_not_called()
        audio_input = self.backend.diar.call_args.args[0]
        self.assertEqual(audio_input["waveform"].shape, (1, 16000))

    def test_gpu_batch_sizes_are_configurable(self):
        pipeline = Mock()
        pipeline.to.return_value = pipeline
        embedder = Mock(dimension=256)

        with (
            patch.dict(
                "os.environ",
                {
                    "DIARIZATION_SEGMENTATION_BATCH_SIZE": "12",
                    "DIARIZATION_EMBEDDING_BATCH_SIZE": "10",
                    "DIARIZATION_SEGMENT_EMBEDDING_BATCH_SIZE": "14",
                },
                clear=True,
            ),
            patch(
                "simple_speaker_recognition.core.audio_backend.Pipeline.from_pretrained",
                return_value=pipeline,
            ),
            patch(
                "simple_speaker_recognition.core.audio_backend.PretrainedSpeakerEmbedding",
                return_value=embedder,
            ),
        ):
            backend = AudioBackend("hf-token", torch.device("cuda"))

        self.assertEqual(pipeline.segmentation_batch_size, 12)
        self.assertEqual(pipeline.embedding_batch_size, 10)
        self.assertEqual(backend.segment_embedding_batch_size, 14)

    def test_diarization_does_not_format_full_model_output_for_info_logging(self):
        class DiarizationOutput:
            speaker_diarization = Mock()

            def __str__(self):
                raise AssertionError("full Pyannote output must not be formatted")

        DiarizationOutput.speaker_diarization.itertracks.return_value = []
        self.backend.diar = Mock(return_value=DiarizationOutput())

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            sf.write(path, np.zeros(8000, dtype=np.float32), 8000)

            self.backend.diarize(path)

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
