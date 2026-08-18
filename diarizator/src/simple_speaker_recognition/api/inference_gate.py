"""Bounded concurrency gate shared by model inference endpoints."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator


class InferenceGateFull(RuntimeError):
    """Raised when every inference slot and the bounded wait slot are occupied."""


@dataclass(frozen=True)
class InferenceLease:
    """Metadata for one acquired inference slot."""

    queue_seconds: float


@dataclass(frozen=True)
class InferenceGateSnapshot:
    """Current gate load exposed through health endpoints."""

    concurrency: int
    inflight: int
    queued: int
    max_queued: int


class InferenceGate:
    """Allow bounded model concurrency with at most one waiting request."""

    def __init__(self, concurrency: int = 1, max_queued: int = 1):
        if concurrency < 1:
            raise ValueError("concurrency must be positive")
        if max_queued < 0:
            raise ValueError("max_queued must not be negative")

        self.concurrency = concurrency
        self.max_queued = max_queued
        self._inflight = 0
        self._queued = 0
        self._condition = asyncio.Condition()

    async def snapshot(self) -> InferenceGateSnapshot:
        async with self._condition:
            return InferenceGateSnapshot(
                concurrency=self.concurrency,
                inflight=self._inflight,
                queued=self._queued,
                max_queued=self.max_queued,
            )

    async def acquire(self) -> InferenceLease:
        """Acquire an inference slot or join the single bounded wait position."""
        queued = False
        queued_at = time.monotonic()

        async with self._condition:
            # A queued request owns the next free slot. New arrivals must not
            # jump ahead between notification and lock reacquisition.
            if self._inflight >= self.concurrency or self._queued > 0:
                if self._queued >= self.max_queued:
                    raise InferenceGateFull("Inference capacity is exhausted")
                self._queued += 1
                queued = True

                try:
                    while self._inflight >= self.concurrency:
                        await self._condition.wait()
                except BaseException:
                    self._queued -= 1
                    self._condition.notify(1)
                    raise

                self._queued -= 1

            self._inflight += 1

        queue_seconds = time.monotonic() - queued_at if queued else 0.0
        return InferenceLease(queue_seconds=queue_seconds)

    async def release(self) -> None:
        """Release one acquired inference slot."""
        async with self._condition:
            if self._inflight < 1:
                raise RuntimeError("Cannot release an inference slot that is not held")
            self._inflight -= 1
            self._condition.notify(1)

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[InferenceLease]:
        lease = await self.acquire()
        try:
            yield lease
        finally:
            await self.release()
