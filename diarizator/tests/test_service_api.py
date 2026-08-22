import asyncio
import io
import json
import os
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest
import torch
from fastapi import UploadFile

os.environ.setdefault("HF_TOKEN", "test-token")

from simple_speaker_recognition.api import service
from simple_speaker_recognition.api.inference_gate import (
    InferenceGate,
    InferenceGateFull,
)
from simple_speaker_recognition.core.audio_backend import (
    _run_in_executor_to_completion,
)


class FakeAudioBackend:
    diarization_model = "test/diarization"
    embedding_model = "test/embedding"
    segmentation_batch_size = 8
    embedding_batch_size = 8
    segment_embedding_batch_size = 4
    min_embedding_samples = 8000
    embedder = SimpleNamespace(dimension=2)

    def __init__(self) -> None:
        self.decoded_payloads: list[bytes] = []

    async def async_load_wave_bytes(
        self,
        audio_data: bytes,
        start=None,
        end=None,
        min_duration=None,
    ) -> torch.Tensor:
        self.decoded_payloads.append(audio_data)
        waveform = torch.ones((1, 1, 16000), dtype=torch.float32)
        if start is None and end is None:
            return waveform
        return self.crop_waveform(waveform, start=start, end=end)

    async def async_embed(self, _waveform: torch.Tensor) -> np.ndarray:
        return np.array([[3.0, 4.0]], dtype=np.float32)

    async def async_diarize(self, _path, **_kwargs):
        return [
            {
                "start": 0.0,
                "end": 1.0,
                "duration": 1.0,
                "speaker": "SPEAKER_00",
            }
        ]

    async def async_embed_batch(self, waves):
        return np.array([[0.6, 0.8] for _waveform in waves], dtype=np.float32)

    def crop_waveform(self, waveform, start=None, end=None, min_duration=None):
        start_sample = int((start or 0.0) * 16000)
        end_sample = int((end if end is not None else 1.0) * 16000)
        return waveform[..., start_sample:end_sample]

    def match_clusters(self, *_args, **_kwargs):
        return None


@pytest.fixture(autouse=True)
def isolated_service_state():
    previous_backend = service.audio_backend
    previous_gate = service.inference_gate
    previous_compute_mode = service.compute_mode
    previous_device = service.device
    previous_model_lock = service.model_lock
    previous_model_state = service.model_state
    previous_model_error = service.model_error
    previous_last_activity = service.last_model_activity
    previous_idle_timeout = service.idle_timeout_seconds
    previous_fingerprint = service.cached_runtime_fingerprint
    previous_batching = service.cached_batching
    service.audio_backend = FakeAudioBackend()
    service.inference_gate = InferenceGate(concurrency=1, max_queued=1)
    service.model_lock = None
    service.model_state = "ready"
    service.model_error = None
    service.last_model_activity = 100.0
    service.idle_timeout_seconds = 120
    service.cached_runtime_fingerprint = service._runtime_fingerprint(
        service.audio_backend
    )
    service.cached_batching = service._backend_batching(service.audio_backend)
    try:
        yield
    finally:
        service.audio_backend = previous_backend
        service.inference_gate = previous_gate
        service.compute_mode = previous_compute_mode
        service.device = previous_device
        service.model_lock = previous_model_lock
        service.model_state = previous_model_state
        service.model_error = previous_model_error
        service.last_model_activity = previous_last_activity
        service.idle_timeout_seconds = previous_idle_timeout
        service.cached_runtime_fingerprint = previous_fingerprint
        service.cached_batching = previous_batching


def _upload(payload: bytes = b"RIFF-test-wav") -> UploadFile:
    return UploadFile(file=io.BytesIO(payload), filename="audio.wav")


async def _wait_for_gate(*, inflight: int, queued: int) -> None:
    for _ in range(1_000):
        snapshot = await service.inference_gate.snapshot()
        if snapshot.inflight == inflight and snapshot.queued == queued:
            return
        await asyncio.sleep(0.001)
    raise AssertionError(f"gate never reached inflight={inflight}, queued={queued}")


def test_embed_decodes_upload_in_memory_and_reports_stage_timings() -> None:
    async def scenario() -> None:
        result = await service.embed(_upload(), start=0.0, end=1.0)

        assert service.audio_backend.decoded_payloads == [b"RIFF-test-wav"]
        assert result["embedding"] == pytest.approx([0.6, 0.8])
        assert result["dimension"] == 2
        assert set(result["timings"]) == {
            "upload_read_ms",
            "queue_ms",
            "model_load_ms",
            "decode_ms",
            "embedding_ms",
            "total_ms",
        }

    asyncio.run(scenario())


def test_diarize_reuses_in_memory_waveform_and_reports_stage_timings() -> None:
    async def scenario() -> None:
        result = await service.diarize(
            _upload(),
            min_speakers=None,
            max_speakers=None,
            collar=None,
            min_duration_off=None,
            clusters=None,
            similarity_threshold=0.15,
        )

        assert service.audio_backend.decoded_payloads == [b"RIFF-test-wav"]
        assert result["segments"][0]["speaker"] == "SPEAKER_00"
        assert result["segments"][0]["embedding"] == pytest.approx([0.6, 0.8])
        assert set(result["timings"]) == {
            "upload_read_ms",
            "queue_ms",
            "model_load_ms",
            "decode_ms",
            "diarization_ms",
            "segment_embedding_ms",
            "cluster_matching_ms",
            "total_ms",
        }

    asyncio.run(scenario())


def test_idle_timeout_unloads_models_but_keeps_route_ready() -> None:
    async def scenario() -> None:
        unloaded = await service._unload_audio_backend_if_idle(now=220.0)
        payload = await service.health()

        assert unloaded is True
        assert service.audio_backend is None
        assert payload["ready"] is True
        assert payload["modelsLoaded"] is False
        assert payload["modelState"] == "idle"
        assert payload["idleTimeoutSeconds"] == 120
        assert (await service.ready())["ready"] is True

    asyncio.run(scenario())


def test_request_after_idle_single_flight_reloads_models(monkeypatch) -> None:
    async def scenario() -> None:
        service.audio_backend = None
        service.model_state = "idle"
        created = []

        def create_backend():
            backend = FakeAudioBackend()
            created.append(backend)
            return backend

        monkeypatch.setattr(service, "_create_audio_backend", create_backend)

        first = await service.embed(_upload(), start=None, end=None)
        second = await service.embed(_upload(), start=None, end=None)

        assert len(created) == 1
        assert service.audio_backend is created[0]
        assert first["embedding"] == pytest.approx([0.6, 0.8])
        assert second["embedding"] == pytest.approx([0.6, 0.8])
        assert (await service.health())["modelState"] == "ready"

    asyncio.run(scenario())


def test_idle_timeout_does_not_unload_during_inference() -> None:
    async def scenario() -> None:
        await service.inference_gate.acquire()
        try:
            unloaded = await service._unload_audio_backend_if_idle(now=220.0)
            assert unloaded is False
            assert service.audio_backend is not None
        finally:
            await service.inference_gate.release()

    asyncio.run(scenario())


def test_reload_failure_marks_service_not_ready(monkeypatch) -> None:
    async def scenario() -> None:
        service.audio_backend = None
        service.model_state = "idle"

        def fail_load():
            raise RuntimeError("model cache is unavailable")

        monkeypatch.setattr(service, "_create_audio_backend", fail_load)

        with pytest.raises(HTTPException, match="model load failed") as error:
            await service.embed(_upload(), start=None, end=None)

        assert error.value.status_code == 503
        payload = await service.health()
        assert payload["ready"] is False
        assert payload["modelState"] == "error"
        assert payload["modelsLoaded"] is False
        assert "model cache is unavailable" in payload["modelError"]

    from fastapi import HTTPException

    asyncio.run(scenario())


def test_health_and_ready_expose_gate_load() -> None:
    async def scenario() -> None:
        await service.inference_gate.acquire()
        waiting = asyncio.create_task(service.inference_gate.acquire())
        for _ in range(100):
            if (await service.inference_gate.snapshot()).queued == 1:
                break
            await asyncio.sleep(0)

        payload = await service.health()
        assert payload["ready"] is True
        assert payload["concurrency"] == 1
        assert payload["inflight"] == 1
        assert payload["queued"] == 1
        assert payload["maxQueued"] == 1
        assert (await service.ready())["ready"] is True

        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        await service.inference_gate.release()

        service.audio_backend = None
        response = await service.ready()
        assert response.status_code == 503
        assert json.loads(response.body)["ready"] is False

    asyncio.run(scenario())


def test_gpu_mode_is_not_ready_after_cpu_fallback() -> None:
    async def scenario() -> None:
        service.compute_mode = "gpu"
        service.device = torch.device("cpu")

        payload = await service.health()
        response = await service.ready()

        assert payload["computeMode"] == "gpu"
        assert payload["device"] == "cpu"
        assert payload["ready"] is False
        assert response.status_code == 503
        assert json.loads(response.body)["ready"] is False

        service.device = torch.device("cuda")
        assert (await service.ready())["ready"] is True

    asyncio.run(scenario())


def test_max_queued_requests_env_is_capped_at_one(monkeypatch) -> None:
    monkeypatch.setenv("TEST_MAX_QUEUED", "0")
    assert service._bounded_int_env("TEST_MAX_QUEUED", 1, minimum=0, maximum=1) == 0

    monkeypatch.setenv("TEST_MAX_QUEUED", "2")
    with pytest.raises(ValueError, match="between 0 and 1"):
        service._bounded_int_env("TEST_MAX_QUEUED", 1, minimum=0, maximum=1)


@pytest.mark.parametrize("endpoint", ["embed", "diarize"])
def test_capacity_rejection_does_not_read_upload(endpoint: str) -> None:
    async def scenario() -> None:
        service.inference_gate = InferenceGate(concurrency=1, max_queued=0)
        await service.inference_gate.acquire()
        upload = _upload()
        upload.read = AsyncMock(wraps=upload.read)

        try:
            with pytest.raises(InferenceGateFull):
                if endpoint == "embed":
                    await service.embed(upload, start=None, end=None)
                else:
                    await service.diarize(
                        upload,
                        min_speakers=None,
                        max_speakers=None,
                        collar=None,
                        min_duration_off=None,
                        clusters=None,
                        similarity_threshold=0.15,
                    )
            upload.read.assert_not_awaited()
        finally:
            await service.inference_gate.release()

    asyncio.run(scenario())


def test_cancelled_executor_inference_keeps_gate_until_thread_finishes() -> None:
    async def scenario() -> None:
        started = threading.Event()
        release = threading.Event()

        class BlockingBackend(FakeAudioBackend):
            async def async_embed(self, _waveform: torch.Tensor) -> np.ndarray:
                def blocking_embed() -> np.ndarray:
                    started.set()
                    if not release.wait(timeout=5):
                        raise TimeoutError("test did not release blocking inference")
                    return np.array([[3.0, 4.0]], dtype=np.float32)

                return await _run_in_executor_to_completion(blocking_embed)

        service.audio_backend = BlockingBackend()
        first = asyncio.create_task(service.embed(_upload(), start=None, end=None))
        for _ in range(1_000):
            if started.is_set():
                break
            await asyncio.sleep(0.001)
        assert started.is_set()

        first.cancel()
        await asyncio.sleep(0)
        await _wait_for_gate(inflight=1, queued=0)
        assert not first.done()

        second_upload = _upload()
        second_upload.read = AsyncMock(wraps=second_upload.read)
        second = asyncio.create_task(service.embed(second_upload, start=None, end=None))
        await _wait_for_gate(inflight=1, queued=1)
        second_upload.read.assert_not_awaited()

        rejected_upload = _upload()
        rejected_upload.read = AsyncMock(wraps=rejected_upload.read)
        with pytest.raises(InferenceGateFull):
            await service.embed(rejected_upload, start=None, end=None)
        rejected_upload.read.assert_not_awaited()

        release.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        result = await second
        assert result["embedding"] == pytest.approx([0.6, 0.8])
        await _wait_for_gate(inflight=0, queued=0)

    asyncio.run(scenario())


def test_capacity_error_is_retryable_429() -> None:
    async def scenario() -> None:
        response = await service.inference_capacity_exhausted(
            None,
            InferenceGateFull("full"),
        )
        body = json.loads(response.body)

        assert response.status_code == 429
        assert response.headers["retry-after"] == "1"
        assert body["error"] == "inference_capacity_exhausted"
        assert body["retryable"] is True

    asyncio.run(scenario())
