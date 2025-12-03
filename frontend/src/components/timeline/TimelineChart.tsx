import React, { useMemo } from "react";
import type { Layer } from "@/core/core";
import { useTimeline } from "@/hooks/useTimeline";
import { TimeLayer } from "@/modules/time";
import { ObjectsLayer } from "@/modules/objects";
import { AudioLayer } from "@/modules/audio/index.tsx";

interface TimelineChartProps {
  layers?: Layer[];
  className?: string;
  timeline?: ReturnType<typeof useTimeline>;
}

export const TimelineChart: React.FC<TimelineChartProps> = (
  { layers, className, timeline: providedTimeline },
) => {
  const internalTimeline = useTimeline();
  const timeline = providedTimeline || internalTimeline;
  const { containerRef, width, timeScale, transform } = timeline;

  const resolvedLayers = useMemo<Layer[]>(() => {
    if (layers && layers.length > 0) return layers;
    return [TimeLayer(), ObjectsLayer(), AudioLayer()];
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
