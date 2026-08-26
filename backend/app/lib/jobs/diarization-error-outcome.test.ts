import { expect } from "@std/expect";
import { ObjectId } from "bson";
import { deriveDiarizationErrorOutcomes } from "./diarization-error-outcome.ts";

const originalId = new ObjectId("6a879ea7270373bd2ecff5db");

Deno.test("diarization error outcome distinguishes recovered retry and attention", () => {
  const errors = [
    {
      originalId: originalId.toString(),
      start: "2026-08-12T19:36:14.394Z",
      end: "2026-08-12T19:36:24.394Z",
    },
    {
      originalId: originalId.toString(),
      start: "2026-08-12T19:37:54.394Z",
      end: "2026-08-12T19:38:04.394Z",
    },
    {
      originalId: originalId.toString(),
      start: "2026-08-12T19:45:04.394Z",
      end: "2026-08-12T19:45:14.394Z",
    },
  ];
  const chunks = [
    {
      original_id: originalId,
      start: new Date("2026-08-12T19:36:14.394Z"),
      diarized_at: new Date("2026-08-24T08:59:14Z"),
    },
    {
      original_id: originalId,
      start: new Date("2026-08-12T19:36:24.394Z"),
      diarized_at: new Date("2026-08-24T08:59:14Z"),
    },
    {
      original_id: originalId,
      start: new Date("2026-08-12T19:37:54.394Z"),
      diarizationFailure: {
        status: "will_retry",
        category: "provider_network",
        attempt: 2,
        retryAt: new Date("2026-08-24T09:05:00Z"),
      },
    },
    {
      original_id: originalId,
      start: new Date("2026-08-12T19:45:04.394Z"),
      diarizationFailure: {
        status: "needs_attention",
        category: "provider_http",
        attempt: 3,
      },
    },
  ];

  expect(deriveDiarizationErrorOutcomes(errors, chunks)).toEqual([
    {
      index: 0,
      state: "recovered",
      matchedChunks: 2,
      diarizedChunks: 2,
      recoveredAt: new Date("2026-08-24T08:59:14Z"),
    },
    {
      index: 1,
      state: "retrying",
      matchedChunks: 1,
      diarizedChunks: 0,
      currentFailure: {
        status: "will_retry",
        category: "provider_network",
        attempt: 2,
        retryAt: new Date("2026-08-24T09:05:00Z"),
      },
    },
    {
      index: 2,
      state: "needs_attention",
      matchedChunks: 1,
      diarizedChunks: 0,
      currentFailure: {
        status: "needs_attention",
        category: "provider_http",
        attempt: 3,
      },
    },
  ]);
});

Deno.test("diarization error outcome stays unknown without a valid range", () => {
  expect(
    deriveDiarizationErrorOutcomes(
      [{ originalId: originalId.toString(), start: "invalid", end: null }],
      [],
    ),
  ).toEqual([
    { index: 0, state: "unknown", matchedChunks: 0, diarizedChunks: 0 },
  ]);
});
