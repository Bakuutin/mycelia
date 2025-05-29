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
  const density = (item.totals.audio_chunks?.has_speech || 0.1) / item.totals.seconds;
  return colorScale(Math.log(density));
}

export const TimelineItems = ({
  items,
  scale,
  transform,
}: TimelineItemsProps) => {
  const newScale = transform.rescaleX(scale);

  return (
    <g>
      {items.map((item) => {
        const startX = newScale(item.start);
        const endX = newScale(item.end);
        const width = Math.max(endX - startX + 2, 2);

        return (
          <rect
            key={item.start.getTime()}
            x={startX}
            y={50}
            width={width}
            height={20}
            fill={getFill(item)}
            className="timeline-item"
          />
        );
      })}
    </g>
  );
};
