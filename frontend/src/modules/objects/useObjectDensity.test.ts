import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineRange } from "@/stores/timelineRange";

const { callResourceMock, visibleObjectCategories } = vi.hoisted(() => ({
  callResourceMock: vi.fn(),
  visibleObjectCategories: ["person", "event"] as const,
}));

vi.mock("@/lib/api", () => ({ callResource: callResourceMock }));
vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocketSubscription: vi.fn(),
}));
vi.mock("@/stores/trackVisibilityStore", () => ({
  useTrackVisibilityStore: (selector: (state: unknown) => unknown) =>
    selector({ visibleObjectCategories }),
}));

import {
  OBJECT_DENSITY_POLL_BACKOFF_MS,
  resetObjectDensityForTests,
  selectObjectDensityResolution,
  useObjectDensity,
  useObjectDensityStore,
} from "./useObjectDensity";

function densityResponse(total: number) {
  return {
    ready: true,
    building: false,
    resolution: "1hour" as const,
    start: new Date("2026-08-01T00:00:00.000Z"),
    end: new Date("2026-08-18T00:00:00.000Z"),
    buckets: [{
      resolution: "1hour" as const,
      start: new Date("2026-08-02T00:00:00.000Z"),
      total,
      byCategory: { person: total },
      stale: false,
      calculatedAt: new Date("2026-08-18T00:00:00.000Z"),
    }],
  };
}

function buildingDensityResponse() {
  return {
    ...densityResponse(0),
    ready: false,
    building: true,
    buckets: [],
  };
}

describe("Timeline object density requests", () => {
  beforeEach(() => {
    callResourceMock.mockReset();
    resetObjectDensityForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests persisted density, not raw objects, for a wide viewport", async () => {
    callResourceMock.mockResolvedValue(densityResponse(7));
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-18T00:00:00.000Z"),
    });

    const { result } = renderHook(() => useObjectDensity({ width: 1_000 }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(callResourceMock).toHaveBeenCalledTimes(1);
    expect(callResourceMock).toHaveBeenCalledWith(
      "objects",
      expect.objectContaining({
        action: "getDensity",
        resolution: "1hour",
        categories: ["person", "event"],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      callResourceMock.mock.calls.some((call) => call[1]?.action === "list"),
    ).toBe(false);
    expect(result.current.buckets[0].total).toBe(7);
  });

  it("performs no density request while individual detail is affordable", () => {
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-02T00:00:00.000Z"),
    });

    const { result } = renderHook(() => useObjectDensity({ width: 1_000 }));
    expect(result.current.detailDeferred).toBe(false);
    expect(callResourceMock).not.toHaveBeenCalled();
  });

  it("keeps the newest result when an aborted request resolves late", async () => {
    let resolveOld!: (value: ReturnType<typeof densityResponse>) => void;
    const oldResponse = new Promise<ReturnType<typeof densityResponse>>(
      (resolve) => {
        resolveOld = resolve;
      },
    );
    callResourceMock
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(densityResponse(9));

    const old = useObjectDensityStore.getState().fetchForRange(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-18T00:00:00.000Z"),
      "1hour",
      ["person"],
    );
    await act(async () => {
      await useObjectDensityStore.getState().fetchForRange(
        new Date("2026-09-01T00:00:00.000Z"),
        new Date("2026-09-18T00:00:00.000Z"),
        "1hour",
        ["person"],
      );
    });
    resolveOld(densityResponse(1));
    await old;

    expect(useObjectDensityStore.getState().buckets[0].total).toBe(9);
  });

  it("reuses an aligned range/category response from the bounded cache", async () => {
    callResourceMock.mockResolvedValue(densityResponse(3));
    const start = new Date("2026-08-01T00:00:00.000Z");
    const end = new Date("2026-08-18T00:00:00.000Z");

    await useObjectDensityStore.getState().fetchForRange(
      start,
      end,
      "1hour",
      ["person"],
    );
    await useObjectDensityStore.getState().fetchForRange(
      start,
      end,
      "1hour",
      ["person"],
    );

    expect(callResourceMock).toHaveBeenCalledTimes(1);
  });

  it("selects a coarser bucket size before exceeding 2000 buckets", () => {
    expect(selectObjectDensityResolution(31 * 24 * 60 * 60 * 1_000)).toBe(
      "1hour",
    );
    expect(selectObjectDensityResolution(120 * 24 * 60 * 60 * 1_000)).toBe(
      "1day",
    );
    expect(selectObjectDensityResolution(10 * 365 * 24 * 60 * 60 * 1_000)).toBe(
      "1week",
    );
  });

  it("polls persisted density with backoff until a missed rebuild event is recovered", async () => {
    const mutableBackoff =
      OBJECT_DENSITY_POLL_BACKOFF_MS as unknown as number[];
    const originalBackoff = [...mutableBackoff];
    mutableBackoff.splice(0, mutableBackoff.length, 5, 10, 20, 40);
    callResourceMock
      .mockResolvedValueOnce(buildingDensityResponse())
      .mockResolvedValueOnce(buildingDensityResponse())
      .mockResolvedValueOnce(densityResponse(11));
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-18T00:00:00.000Z"),
    });

    const { result, unmount } = renderHook(() =>
      useObjectDensity({ width: 1_000 })
    );
    try {
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(callResourceMock).toHaveBeenCalledTimes(3);
      expect(result.current.buckets[0].total).toBe(11);
    } finally {
      unmount();
      mutableBackoff.splice(
        0,
        mutableBackoff.length,
        ...originalBackoff,
      );
    }
  });

  it("stops density polling when the timeline layer unmounts", async () => {
    const mutableBackoff =
      OBJECT_DENSITY_POLL_BACKOFF_MS as unknown as number[];
    const originalBackoff = [...mutableBackoff];
    mutableBackoff.splice(0, mutableBackoff.length, 500, 1_000, 2_000, 4_000);
    callResourceMock.mockResolvedValue(buildingDensityResponse());
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-18T00:00:00.000Z"),
    });

    const { result, unmount } = renderHook(() =>
      useObjectDensity({ width: 1_000 })
    );
    let unmounted = false;
    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.building).toBe(true);
      expect(callResourceMock).toHaveBeenCalledTimes(1);
      unmount();
      unmounted = true;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 550));
      expect(callResourceMock).toHaveBeenCalledTimes(1);
    } finally {
      if (!unmounted) unmount();
      mutableBackoff.splice(
        0,
        mutableBackoff.length,
        ...originalBackoff,
      );
    }
  });

  it("aborts an in-flight density read when the timeline layer unmounts", async () => {
    let signal: AbortSignal | undefined;
    callResourceMock.mockImplementation((_resource, _body, options) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-18T00:00:00.000Z"),
    });

    const { unmount } = renderHook(() => useObjectDensity({ width: 1_000 }));
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
