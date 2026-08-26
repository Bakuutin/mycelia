// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getMediaRecognitionBatchProgress } from "./mediaRecognitionBatchProgress";

describe("getMediaRecognitionBatchProgress", () => {
  it("normalizes live flat coordinator progress", () => {
    expect(getMediaRecognitionBatchProgress({
      status: "active",
      progress: {
        stage: "processing",
        processed: 72,
        total: 100,
        remaining: 28,
        percent: 72,
        pending: 12,
        queued: 10,
        processing: 6,
        ready: 70,
        skipped: 1,
        failed: 1,
      },
    })).toEqual({
      stage: "processing",
      done: 72,
      total: 100,
      remaining: 28,
      percent: 72,
      pending: 12,
      queued: 10,
      processing: 6,
      ready: 70,
      skipped: 1,
      failed: 1,
      cancelled: 0,
    });
  });

  it("derives terminal progress from a stored batch count snapshot", () => {
    expect(getMediaRecognitionBatchProgress({
      status: "completed_with_errors",
      counts: {
        total: 10,
        ready: 7,
        skipped: 1,
        failed: 2,
      },
    })).toMatchObject({
      stage: "completed_with_errors",
      done: 10,
      total: 10,
      remaining: 0,
      percent: 100,
      failed: 2,
    });
  });
});
