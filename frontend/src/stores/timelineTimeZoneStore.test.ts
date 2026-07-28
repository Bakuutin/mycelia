import { beforeEach, describe, expect, it, vi } from "vitest";
import { callResource } from "@/lib/api";
import { useTimelineTimeZoneStore } from "./timelineTimeZoneStore";

vi.mock("@/lib/api", () => ({ callResource: vi.fn() }));

const mockCallResource = vi.mocked(callResource);

describe("timelineTimeZoneStore", () => {
  beforeEach(() => {
    mockCallResource.mockReset();
    useTimelineTimeZoneStore.setState({
      periods: [],
      saving: false,
      error: null,
    });
  });

  it("omits an empty location instead of serializing it as null", async () => {
    mockCallResource.mockResolvedValue({
      _id: "period-1",
      start: new Date("2026-07-28T10:00:00.000Z"),
      end: new Date("2026-07-28T11:00:00.000Z"),
      timeZone: "Asia/Bangkok",
      source: "manual",
    });

    await useTimelineTimeZoneStore.getState().createPeriod({
      start: new Date("2026-07-28T10:00:00.000Z"),
      end: new Date("2026-07-28T11:00:00.000Z"),
      timeZone: "Asia/Bangkok",
      location: undefined,
    });

    const request = mockCallResource.mock.calls[0]?.[1] as {
      period: Record<string, unknown>;
    };
    expect(request.period).not.toHaveProperty("location");
  });
});
