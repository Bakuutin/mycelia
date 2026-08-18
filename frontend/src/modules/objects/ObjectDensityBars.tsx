import React from "react";
import { OBJECT_CATEGORIES, type ObjectCategory } from "@/types/tracks";
import {
  OBJECT_DENSITY_RESOLUTION_MS,
  type ObjectDensityBucket,
} from "./useObjectDensity";

const CATEGORY_LABELS = new Map<ObjectCategory, string>(
  OBJECT_CATEGORIES.map((category) => [category.id, category.label]),
);

export function objectDensityP95(buckets: ObjectDensityBucket[]): number {
  const counts = buckets.map((bucket) => bucket.total).filter((count) =>
    count > 0
  ).sort((left, right) => left - right);
  if (counts.length === 0) return 1;
  const index = Math.max(0, Math.ceil(counts.length * 0.95) - 1);
  return Math.max(1, counts[index]);
}

function densityTooltip(bucket: ObjectDensityBucket): string {
  const breakdown = Object.entries(bucket.byCategory)
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .map(([category, count]) =>
      `${CATEGORY_LABELS.get(category as ObjectCategory) ?? category}: ${count}`
    );
  return [
    `${bucket.total} object interval${
      bucket.total === 1 ? "" : "s"
    } start in this period`,
    ...breakdown,
    ...(bucket.stale ? ["Density is being refreshed"] : []),
  ].join("\n");
}

export function ObjectDensityBars({
  buckets,
  xFor,
  height = 50,
}: {
  buckets: ObjectDensityBucket[];
  xFor: (date: Date) => number;
  height?: number;
}) {
  const chartTop = 5;
  const chartBottom = Math.max(chartTop + 1, height - 13);
  const chartHeight = chartBottom - chartTop;
  const p95 = objectDensityP95(buckets);

  return (
    <g data-testid="object-density-bars">
      <defs>
        <pattern
          id="stale-stripes-object-density"
          patternUnits="userSpaceOnUse"
          width="5"
          height="5"
        >
          <rect width="5" height="5" fill="#7c3aed" opacity={0.45} />
          <path
            d="M-1,1 l2,-2 M0,5 l5,-5 M4,6 l2,-2"
            stroke="#d8b4fe"
            strokeWidth={1}
          />
        </pattern>
      </defs>
      {buckets.filter((bucket) => bucket.total > 0).map((bucket) => {
        const startX = xFor(bucket.start);
        const end = new Date(
          bucket.start.getTime() +
            OBJECT_DENSITY_RESOLUTION_MS[bucket.resolution],
        );
        const width = Math.max(1, xFor(end) - startX - 0.5);
        const normalized = Math.min(1, bucket.total / p95);
        const barHeight = Math.max(2, normalized * chartHeight);
        return (
          <rect
            key={`${bucket.resolution}:${bucket.start.getTime()}`}
            x={startX}
            y={chartBottom - barHeight}
            width={width}
            height={barHeight}
            rx={1}
            fill={bucket.stale
              ? "url(#stale-stripes-object-density)"
              : "#7c3aed"}
            opacity={bucket.stale ? 0.85 : 0.68}
            aria-label={densityTooltip(bucket)}
          >
            <title>{densityTooltip(bucket)}</title>
          </rect>
        );
      })}
      <text x={8} y={height - 2} fontSize={9} fill="#6b7280" opacity={0.8}>
        Object density · zoom in for individual objects
      </text>
    </g>
  );
}
