// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapTimeNavigator } from "./MapTimeNavigator";

describe("MapTimeNavigator", () => {
  it("keeps drag changes draft-only until pointer release", () => {
    const onCommitRange = vi.fn();
    render(
      <MapTimeNavigator
        summary={{
          dataRange: { start: new Date(0), end: new Date(10_000) },
          range: { start: new Date(1_000), end: new Date(9_000) },
          bucketMs: 5_000,
          buckets: [
            {
              start: new Date(0),
              end: new Date(5_000),
              dwellMs: 1_000,
              stayCount: 1,
              conversationCount: 2,
            },
            {
              start: new Date(5_000),
              end: new Date(10_000),
              dwellMs: 2_000,
              stayCount: 1,
              conversationCount: 3,
            },
          ],
          projection: { status: "ready", revision: 1, stale: false },
        }}
        start={new Date(1_000)}
        end={new Date(9_000)}
        onCommitRange={onCommitRange}
        onSelectTime={vi.fn()}
      />,
    );
    const start = screen.getByLabelText("Selected period start");
    fireEvent.change(start, { target: { value: "2000" } });
    expect(onCommitRange).not.toHaveBeenCalled();
    fireEvent.pointerUp(start);
    expect(onCommitRange).toHaveBeenCalledTimes(1);
    expect(onCommitRange.mock.calls[0][0].getTime()).toBe(2_000);
  });
});
