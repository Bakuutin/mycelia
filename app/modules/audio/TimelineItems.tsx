import React, { useMemo } from "react";
import * as d3 from "d3";
import _ from "lodash";
import { TimelineItem } from "@/types/timeline.ts";

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

export const TimelineItems = ({
  items,
  scale,
  transform,
}: TimelineItemsProps) => {
  const newScale = transform.rescaleX(scale);

  return (
    <g>
      <defs>
        <pattern id="stale-stripes" patternUnits="userSpaceOnUse" width="4" height="4">
          <rect width="4" height="4" fill="pink" opacity="0.7" />
          <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="rgba(255,20,147,0.8)" strokeWidth="0.5" />
        </pattern>
      </defs>
      {items.map((item) => {
        const startX = newScale(item.start);
        const endX = newScale(item.end);
        const width = Math.max(endX - startX + 2, 2);

        return (
          <rect
            key={item.id}
            x={startX}
            width={width}
            height={20}
            fill={getPattern(item)}
            className="timeline-item"
          />
        );
      })}
    </g>
  );
};
