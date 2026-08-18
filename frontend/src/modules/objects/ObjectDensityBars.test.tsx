import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObjectDensityBars, objectDensityP95 } from "./ObjectDensityBars";
import type { ObjectDensityBucket } from "./useObjectDensity";

function bucket(
  hour: number,
  total: number,
  stale = false,
): ObjectDensityBucket {
  return {
    resolution: "1hour",
    start: new Date(Date.UTC(2026, 7, 18, hour)),
    total,
    byCategory: { person: total },
    stale,
    calculatedAt: new Date("2026-08-18T12:00:00.000Z"),
  };
}

describe("ObjectDensityBars", () => {
  it("renders filtered interval-start counts and the zoom affordance", () => {
    render(
      <svg>
        <ObjectDensityBars
          buckets={[bucket(1, 3)]}
          xFor={(date) =>
            (date.getTime() - Date.UTC(2026, 7, 18)) / 3_600_000 * 10}
        />
      </svg>,
    );

    expect(screen.getByText(/Object density · zoom in/)).toBeTruthy();
    expect(
      screen.getByLabelText(/3 object intervals start in this period/),
    ).toBeTruthy();
    expect(screen.getByLabelText(/People: 3/)).toBeTruthy();
  });

  it("uses striped fill for stale buckets", () => {
    render(
      <svg>
        <ObjectDensityBars buckets={[bucket(1, 1, true)]} xFor={() => 10} />
      </svg>,
    );
    expect(
      screen.getByLabelText(/Density is being refreshed/).getAttribute("fill"),
    ).toBe("url(#stale-stripes-object-density)");
  });

  it("caps display scale at the 95th percentile", () => {
    const buckets = [
      ...Array.from({ length: 19 }, (_, index) => bucket(index, index + 1)),
      bucket(23, 10_000),
    ];
    expect(objectDensityP95(buckets)).toBe(19);
  });
});
