import { describe, expect, it } from "vitest";
import type { JobInfo } from "@/types/jobs";
import { getJobTimeRange } from "./jobTimeRange";

function job(overrides: Partial<JobInfo>): JobInfo {
  return {
    id: "job-1",
    type: "diarization",
    data: {},
    state: "completed",
    progress: {},
    timestamp: 0,
    ...overrides,
  };
}

describe("getJobTimeRange", () => {
  it("prefers the actual processed audio range", () => {
    const range = getJobTimeRange(job({
      data: {
        start: "2026-08-01T00:00:00Z",
        end: "2026-08-31T00:00:00Z",
      },
      result: {
        processedRange: {
          start: "2026-08-18T08:00:00Z",
          end: "2026-08-18T08:02:30Z",
        },
      },
    }));

    expect(range?.source).toBe("processed");
    expect(range?.start.toISOString()).toBe("2026-08-18T08:00:00.000Z");
    expect(range?.end?.toISOString()).toBe("2026-08-18T08:02:30.000Z");
  });

  it("uses live progress before the worker result exists", () => {
    const range = getJobTimeRange(job({
      state: "active",
      progress: {
        processedRange: {
          start: "2026-08-18T09:00:00Z",
          end: "2026-08-18T09:01:00Z",
        },
      },
    }));

    expect(range?.source).toBe("processed");
    expect(range?.end?.toISOString()).toBe("2026-08-18T09:01:00.000Z");
  });

  it("keeps legacy requested ranges and rejects invalid intervals", () => {
    expect(
      getJobTimeRange(job({
        data: { start: "2026-08-10T00:00:00Z" },
      }))?.source,
    ).toBe("requested");
    expect(getJobTimeRange(job({
      data: {
        start: "2026-08-11T00:00:00Z",
        end: "2026-08-10T00:00:00Z",
      },
    }))).toBeNull();
  });
});
