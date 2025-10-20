import React, { useMemo } from "react";
import type { Layer } from "@/core/core";
import { useTimeline } from "@/hooks/useTimeline";
import { TimeLayer } from "@/modules/time";
import { EventsLayer } from "@/modules/events";

interface TimelineChartProps {
  layers?: Layer[];
  className?: string;
}

export const TimelineChart: React.FC<TimelineChartProps> = ({ layers, className }) => {
  const { containerRef, width, timeScale, transform } = useTimeline();

  const resolvedLayers = useMemo<Layer[]>(() => {
    if (layers && layers.length > 0) return layers;
    return [TimeLayer(), EventsLayer()];
  }, [layers]);

  return (
    <div ref={containerRef} className={className}>
      <div className="flex flex-col gap-1">
        {resolvedLayers.map((layer, idx) => {
          const Component = layer.component;
          return (
            <Component
              key={idx}
              scale={timeScale}
              transform={transform}
              width={width}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TimelineChart;


