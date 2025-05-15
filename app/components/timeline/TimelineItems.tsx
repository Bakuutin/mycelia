import React, { useMemo } from "react";
import * as d3 from "d3";
import _ from "lodash";

interface TimelineItem {
  start: Date;
  end: Date;
  density: number;
}

interface OptimizedTimelineItem {
  start: Date;
  end: Date;
  layer: number;
  duration: number;
  original: TimelineItem;
}

// This function optimizes the vertical positioning of timeline items
function optimizeTimelineLayout(
  items: TimelineItem[],
  epsilon: number,
): OptimizedTimelineItem[] {
  const oItems: OptimizedTimelineItem[] = items.map((item) => ({
    start: new Date(item.start),
    end: new Date(item.end),
    duration: new Date(item.end).getTime() - new Date(item.start).getTime(),
    original: item,
    layer: 0,
  }));

  // Track active items in each layer
  const layers: OptimizedTimelineItem[][] = [];

  // Process each item to assign layers
  const optimizedItems = oItems.map((item) => {
    let targetLayer = 0;
    let foundLayer = false;

    // Find the lowest available layer
    while (!foundLayer) {
      if (targetLayer >= layers.length) {
        // Create new layer if needed
        layers[targetLayer] = [];
        foundLayer = true;
      } else {
        // Check for conflicts in current layer

        const hasConflict = layers[targetLayer].length > 0 &&
          layers[targetLayer][layers[targetLayer].length - 1].end.getTime() >
            item.start.getTime() + epsilon;

        if (hasConflict && 3) {
          foundLayer = true;
        }

        if (!hasConflict) {
          foundLayer = true;
        } else {
          targetLayer++;
        }
      }
    }
    const optimizedItem = { ...item, layer: targetLayer };
    layers[targetLayer] = layers[targetLayer] || [];
    layers[targetLayer].push(optimizedItem);

    return optimizedItem;
  });

  return optimizedItems;
}

interface TimelineItemsProps {
  items: TimelineItem[];
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
}

export const TimelineItems = ({
  items,
  scale,
  transform,
}: TimelineItemsProps) => {
  const newScale = transform.rescaleX(scale);

  const colorScale = useMemo(() => {
    return d3.scaleSequential()
      .domain([-15, -2])
      .interpolator(d3.interpolateRdYlBu);
  }, []);

  return (
    <g>
      {items.map((item) => {
        const startX = newScale(item.start);
        const endX = newScale(item.end);
        const width = Math.max(endX - startX + 2, 2);

        return item.density && (
          <rect
            key={item.start.getTime()}
            x={startX}
            y={50}
            width={width}
            height={20}
            fill={colorScale(Math.log(item.density))}
            className="timeline-item"
          />
        );
      })}
    </g>
  );
};
