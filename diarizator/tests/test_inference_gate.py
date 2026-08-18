import asyncio

import pytest

from simple_speaker_recognition.api.inference_gate import (
    InferenceGate,
    InferenceGateFull,
)


async def _wait_for_queued(gate: InferenceGate, expected: int) -> None:
    for _ in range(100):
        if (await gate.snapshot()).queued == expected:
            return
        await asyncio.sleep(0)
    raise AssertionError(f"gate never reached queued={expected}")


def test_gate_allows_one_inflight_one_queued_and_rejects_the_third() -> None:
    async def scenario() -> None:
        gate = InferenceGate(concurrency=1, max_queued=1)
        first = await gate.acquire()
        assert first.queue_seconds == 0

        queued_task = asyncio.create_task(gate.acquire())
        await _wait_for_queued(gate, 1)

        with pytest.raises(InferenceGateFull):
            await gate.acquire()

        snapshot = await gate.snapshot()
        assert snapshot.inflight == 1
        assert snapshot.queued == 1
        assert snapshot.concurrency == 1
        assert snapshot.max_queued == 1

        await gate.release()
        second = await queued_task
        assert second.queue_seconds >= 0
        assert (await gate.snapshot()).inflight == 1
        assert (await gate.snapshot()).queued == 0

        await gate.release()
        assert (await gate.snapshot()).inflight == 0

    asyncio.run(scenario())


def test_cancelled_waiter_releases_the_queue_position() -> None:
    async def scenario() -> None:
        gate = InferenceGate(concurrency=1, max_queued=1)
        await gate.acquire()
        queued_task = asyncio.create_task(gate.acquire())
        await _wait_for_queued(gate, 1)

        queued_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await queued_task
        assert (await gate.snapshot()).queued == 0

        replacement_task = asyncio.create_task(gate.acquire())
        await _wait_for_queued(gate, 1)
        await gate.release()
        await replacement_task
        await gate.release()

    asyncio.run(scenario())


def test_configured_concurrency_is_shared_before_queueing() -> None:
    async def scenario() -> None:
        gate = InferenceGate(concurrency=2, max_queued=1)
        await gate.acquire()
        await gate.acquire()

        queued_task = asyncio.create_task(gate.acquire())
        await _wait_for_queued(gate, 1)
        with pytest.raises(InferenceGateFull):
            await gate.acquire()

        await gate.release()
        await queued_task
        assert (await gate.snapshot()).inflight == 2
        await gate.release()
        await gate.release()

    asyncio.run(scenario())
