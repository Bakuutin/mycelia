import React, { useMemo } from "react";
import * as d3 from "d3";
import _ from "lodash";

interface TimelineItem {
  start: Date;
  end: Date;
  id: string;
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
  const [start, end] = newScale.domain();
  const duration = end.getTime() - start.getTime();

  const MARGIN = 14;
  const ITEM_HEIGHT = 20;
  const LAYER_GAP = 4;
  const TOTAL_HEIGHT = ITEM_HEIGHT + LAYER_GAP;

  const optimizedItems = useMemo(
    () => optimizeTimelineLayout(items, duration * 0.01),
    [items, duration],
  );

  return (
    <g>
      {optimizedItems.map((item) => {
        const startX = newScale(item.start);
        const endX = newScale(item.end);
        const width = duration < 1000 * 365 * 24 * 60 * 60 * 1000
          ? Math.max(endX - startX, 2)
          : 2;

        return (
          <rect
            key={item.original.id}
            x={startX}
            y={item.layer * TOTAL_HEIGHT + MARGIN}
            width={width}
            height={ITEM_HEIGHT}
            className="fill-chart-1"
          >
            <title>{item.original.id}</title>
          </rect>
        );
      })}
    </g>
  );
};
