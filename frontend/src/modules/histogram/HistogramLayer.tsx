import React, { useMemo } from "react";
import * as d3 from "d3";
import type { HistogramItem } from "./useHistogramCache";

interface HistogramBarsProps {
  items: HistogramItem[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  width: number;
  height?: number;
}

export const HistogramBars = React.memo(({
  items,
  scale,
  transform,
  width,
  height = 60,
}: HistogramBarsProps) => {
  const newScale = transform.rescaleX(scale);

  // Compute bars with viewport culling in a single pass
  const { bars, maxCount } = useMemo(() => {
    let max = 1;
    const barData: Array<{
      id: string;
      x: number;
      w: number;
      count: number;
      speechRatio: number;
      stale: boolean;
    }> = [];

    for (const item of items) {
      const x = newScale(item.start);
      const endX = newScale(item.end);
      const w = Math.max(endX - x, 1);

      // Viewport culling - skip bars outside visible area
      if (x + w < 0 || x > width) continue;

      const count = item.totals.audio_chunks?.count || 0;
      if (count > max) max = count;

      const speechCount = item.totals.audio_chunks?.has_speech || 0;
      const speechRatio = count > 0 ? speechCount / count : 0;

      barData.push({
        id: item.id,
        x,
        w,
        count,
        speechRatio,
        stale: item.stale,
      });
    }

    return { bars: barData, maxCount: max };
  }, [items, newScale, width]);

  return (
    <svg className="w-full zoomable" width={width} height={height}>
      <defs>
        <pattern
          id="stale-stripes-histogram"
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
      <g>
        {bars.map((bar) => {
          const barHeight = maxCount > 0 ? (bar.count / maxCount) * height : 0;
          const baseColor = bar.stale ? "rgb(255, 182, 193)" : "rgb(59, 130, 246)";
          const opacity = 0.3 + bar.speechRatio * 0.7;

          return (
            <rect
              key={bar.id}
              x={bar.x}
              y={height - barHeight}
              width={bar.w}
              height={barHeight}
              fill={baseColor}
              opacity={opacity}
              className="histogram-bar"
            />
          );
        })}
      </g>
    </svg>
  );
});
