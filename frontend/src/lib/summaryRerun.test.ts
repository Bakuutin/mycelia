// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { queueSummaryRerunRange, summaryDateBounds } from "./summaryRerun";

describe("summary rerun range", () => {
  it("uses inclusive calendar dates in the selected timezone", () => {
    expect(summaryDateBounds("2026-08-24", "2026-08-30", "Asia/Yerevan"))
      .toEqual({
        start: "2026-08-23T20:00:00.000Z",
        end: "2026-08-30T20:00:00.000Z",
      });
    expect(summaryDateBounds("2026-03-08", "2026-03-08", "America/New_York"))
      .toEqual({
        start: "2026-03-08T05:00:00.000Z",
        end: "2026-03-09T04:00:00.000Z",
      });
    expect(summaryDateBounds("", "2026-08-30", "UTC")).toBeNull();
    expect(summaryDateBounds("2026-08-31", "2026-08-30", "UTC")).toBeNull();
  });

  it("continues beyond 100, including a batch entirely already queued", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({
        queued: Array(100).fill({}),
        nextCursor: "000000000000000000000100",
      })
      .mockResolvedValueOnce({
        queued: [],
        skippedAlreadyQueued: 100,
        nextCursor: "000000000000000000000200",
      })
      .mockResolvedValueOnce({ queued: [{}, {}], nextCursor: null });
    const request = {
      start: "2026-08-24T00:00:00Z",
      end: "2026-08-31T00:00:00Z",
      targetModel: "qwen-unc",
      targetProviderProfileId: "local",
    };
    expect(await queueSummaryRerunRange(request, call, () => {}))
      .toEqual({ queued: 102, skipped: 100 });
    expect(call).toHaveBeenCalledTimes(3);
    for (const [input] of call.mock.calls) {
      expect(input).toMatchObject({ ...request, limit: 100 });
      expect(input).not.toHaveProperty("sourceModel");
    }
    expect(call.mock.calls[2][0].afterObjectId).toBe(
      "000000000000000000000200",
    );
  });

  it("stops on failure without silently reporting completion", async () => {
    const call = vi.fn().mockRejectedValue(new Error("unavailable"));
    await expect(queueSummaryRerunRange(
      {
        start: "2026-08-24T00:00:00Z",
        end: "2026-08-31T00:00:00Z",
        targetModel: "qwen-unc",
      },
      call,
      () => {},
    )).rejects.toThrow("unavailable");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
