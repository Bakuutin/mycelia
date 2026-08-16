import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineRange } from "@/stores/timelineRange";

const { callResourceMock } = vi.hoisted(() => ({
  callResourceMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  callResource: callResourceMock,
}));

import { useObjects, useObjectsStore } from "./useObjects";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function resetObjectsStore() {
  useObjectsStore.setState({
    objects: [],
    loading: false,
    error: null,
    currentRange: null,
    requestedRange: null,
    requestedLimit: null,
    truncated: false,
  } as any);
}

describe("Timeline object requests", () => {
  beforeEach(() => {
    callResourceMock.mockReset();
    resetObjectsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the newest response when an older request finishes last", async () => {
    const older = deferred<any>();
    const newer = deferred<any>();
    callResourceMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const rangeA = {
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-02T00:00:00.000Z"),
    };
    const rangeB = {
      start: new Date("2026-08-03T00:00:00.000Z"),
      end: new Date("2026-08-04T00:00:00.000Z"),
    };

    const requestA = useObjectsStore.getState().fetchForRange(
      rangeA.start,
      rangeA.end,
    );
    const requestB = useObjectsStore.getState().fetchForRange(
      rangeB.start,
      rangeB.end,
    );

    newer.resolve({
      objects: [{ name: "newest" }],
      truncated: false,
    });
    await requestB;
    older.resolve({
      objects: [{ name: "stale" }],
      truncated: false,
    });
    await requestA;

    expect(useObjectsStore.getState().objects[0].name).toBe("newest");
    expect(useObjectsStore.getState().currentRange).toEqual(rangeB);
  });

  it("stores Timeline truncation metadata", async () => {
    callResourceMock.mockResolvedValue({
      objects: [{ name: "bounded" }],
      truncated: true,
    });

    await useObjectsStore.getState().fetchForRange(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
    );

    expect((useObjectsStore.getState() as any).truncated).toBe(true);
    expect(useObjectsStore.getState().objects).toEqual([{ name: "bounded" }]);
    expect(callResourceMock).toHaveBeenCalledWith(
      "objects",
      expect.objectContaining({
        action: "list",
        view: "timeline",
        options: expect.objectContaining({ limit: 2_048 }),
      }),
    );
  });

  it("does not request individual objects for a wide viewport", () => {
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-17T00:00:00.000Z"),
    });

    const { result } = renderHook(() => useObjects({ width: 1_000 }));

    expect(result.current.detailDeferred).toBe(true);
    expect(callResourceMock).not.toHaveBeenCalled();
    expect(useObjectsStore.getState().objects).toEqual([]);
  });

  it("coalesces rapid viewport changes before requesting a replacement", async () => {
    vi.useFakeTimers();
    callResourceMock.mockReturnValue(new Promise(() => {}));
    useTimelineRange.setState({
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-08-02T00:00:00.000Z"),
    });

    renderHook(() => useObjects());
    expect(callResourceMock).toHaveBeenCalledTimes(1);
    callResourceMock.mockClear();

    act(() => {
      useTimelineRange.setState({
        start: new Date("2026-09-01T00:00:00.000Z"),
        end: new Date("2026-09-02T00:00:00.000Z"),
      });
      useTimelineRange.setState({
        start: new Date("2026-10-01T00:00:00.000Z"),
        end: new Date("2026-10-02T00:00:00.000Z"),
      });
    });

    act(() => {
      vi.advanceTimersByTime(649);
    });
    expect(callResourceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callResourceMock).toHaveBeenCalledTimes(1);
  });
});
