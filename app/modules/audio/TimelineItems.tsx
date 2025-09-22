import React, { useMemo } from "react";
import * as d3 from "d3";
import _ from "lodash";
import { TimelineItem } from "@/types/timeline.ts";
import type { BucketResult, Resolution } from "@/modules/ranges/index.ts";

interface TimelineItemsProps {
  items: TimelineItem[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
}

const colorScale = d3.scaleSequential()
  .domain([-15, -2])
  .interpolator(d3.interpolateRdYlBu);

const getFill = (item: TimelineItem) => {
  const density = (item.totals.audio_chunks?.has_speech || 0.1) /
    item.totals.seconds;
  return colorScale(Math.log(density));
};

const getPattern = (item: TimelineItem) => {
  if (item.stale) {
    return "url(#stale-stripes)";
  }
  return getFill(item);
};

const HeatmapBlock = ({ intensity, x, y, width }: { intensity: number, x: number, y: number, width: number }) => {
  return intensity > 0 ? (
    <rect
      x={x}
      y={y}
      width={width}
      height={10}
      fill={colorScale(Math.log(intensity))}
      className="timeline-item"
    />
  ) : null;
};

interface BucketedTimelineItemsProps {
  buckets: BucketResult[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  resolution: Resolution;
}

const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": 5 * 60 * 1000,
  "1hour": 60 * 60 * 1000,
  "1day": 24 * 60 * 60 * 1000,
  "1week": 7 * 24 * 60 * 60 * 1000,
};

const getBucketFill = (bucket: BucketResult) => {
  const speechDensity = bucket.value.hasSpeech / Math.max(bucket.value.count, 1);
  return colorScale(Math.log(speechDensity + 0.01));
};

export const BucketedTimelineItems = ({
  buckets,
  scale,
  transform,
  resolution,
}: BucketedTimelineItemsProps) => {
  const newScale = transform.rescaleX(scale);
  const bucketDurationMs = RESOLUTION_TO_MS[resolution];

  return (
    <g>
      <defs>
        <pattern
          id="stale-stripes"
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
        >
          <rect width="4" height="4" fill="pink" opacity="1" />
          <path
            d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
            stroke="rgb(255,20,147)"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      {buckets.map((bucket) => {
        const bucketStart = new Date(bucket.key);
        const bucketEnd = new Date(bucket.key + bucketDurationMs);
        const startX = newScale(bucketStart);
        const endX = newScale(bucketEnd);
        const width = Math.max(endX - startX + 1, 1);

        const transcriptDensity = bucket.value.count / Math.max(bucketDurationMs / 1000, 1);

        return (
          <g key={bucket.key}>
            <rect
              x={startX}
              y={0}
              width={width}
              height={10}
              fill={getBucketFill(bucket)}
              className="timeline-bucket"
            />
            <HeatmapBlock
              x={startX}
              y={10}
              width={width}
              intensity={transcriptDensity}
            />
          </g>
        );
      })}
    </g>
  );
};

export const TimelineItems = ({
  items,
  scale,
  transform,
}: TimelineItemsProps) => {
  const newScale = transform.rescaleX(scale);

  return (
    <g>
      <defs>
        <pattern
          id="stale-stripes"
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
        >
          <rect width="4" height="4" fill="pink" opacity="1" />
          <path
            d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
            stroke="rgb(255,20,147)"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      {items.map((item) => {
        const startX = newScale(item.start);
        const endX = newScale(item.end);
        const width = Math.max(endX - startX + 2, 2);

        return (
          <g key={item.id}>
            <rect
              x={startX}
              y={0}
              width={width}
              height={10}
              fill={getPattern(item)}
              className="timeline-item"
            />
            <HeatmapBlock
              x={startX}
              y={10}
              width={width}
              intensity={(item.totals?.transcriptions?.count || 0) / item.totals.seconds}
            />
          </g>
        );
      })}
    </g>
  );
};
