import React from "react";
import type { Layer, LayerComponentProps } from "@/core/core.ts";
import { useTimelineRecalc } from "@/hooks/useTimelineRecalc";

export const ProcessingLayer = (): Layer => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { activeRanges } = useTimelineRecalc();

      if (!activeRanges || activeRanges.size === 0) {
        return null;
      }

      const ranges = activeRanges.map((range) => {
        return {
          resolution: range.resolution,
          start: new Date(range.start),
          end: new Date(range.end),
          addedAt: range.addedAt,
        };
      });

      return (
        <svg className="w-full h-full pointer-events-none absolute top-0 left-0 z-50" width={width} height={40}>
          {ranges.map((range) => {
            const transformedScale = transform.rescaleX(scale);
            const x = transformedScale(range.start);
            const x2 = transformedScale(range.end);
            let width = x2 - x;

            if (isNaN(x) || isNaN(x2) || isNaN(width)) return null;

            let renderX = x;
            let renderWidth = width;

            // Ensure minimum visibility (1px)
            if (renderWidth < 1) {
              const center = x + width / 2;
              renderWidth = 1;
              renderX = center - 0.5;
            }

            return (
              <rect
                key={`${range.start.toISOString()}-${range.end.toISOString()}`}
                x={renderX}
                y={0}
                width={renderWidth}
                height={20}
                fill="pink"
                opacity="0.5"
              />
            );
          })}
        </svg>
      );
    },
  } as Layer;
};
