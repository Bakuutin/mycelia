import React, { useEffect, useMemo, useState } from "react";
import type { Layer, LayerComponentProps, Tool } from "@/core/core.ts";
import { useObjects, useObjectsStore } from "./useObjects.ts";
import { Button } from "@/components/ui/button.tsx";
import type { Object } from "@/types/objects.ts";
import { PlusIcon, RefreshCw, ArrowRight, ArrowLeft, ArrowLeftRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTimelineRange } from "../../stores/timelineRange.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatTime, formatTimeRangeDuration } from "@/lib/formatTime.ts";
import { useSettingsStore } from "@/stores/settingsStore.ts";
import { getRelationships } from "@/hooks/useObjectQueries.ts";

const laneHeight = 40; // Half the previous height for more compact display
const topMargin = 4;


type ExtractedObjectRange = {
  object: Object & {
    subjectObject?: Object;
    objectObject?: Object;
  };
  rangeIndex: number;
  start: Date;
  end?: Date;
};

type PlacedObjectRange = {
  startX: number;
  endX: number;
  lane: number;
} & ExtractedObjectRange;



function RangeBox({ range }: { range: PlacedObjectRange }) {
  const navigate = useNavigate();
  const { start, end, startX, endX, lane, object } = range;
  const { timeFormat } = useSettingsStore();
  const now = useNow();

  const handleClick = () => {
    navigate(`/objects/${object._id.toString()}`);
  };

  const renderIcon = (icon: any) => {
    if (!icon) return '';
    if (typeof icon === 'string') return icon;
    if (icon.text) return icon.text;
    if (icon.base64) return '📷';
    return '';
  };

  const isRelationship = object.isRelationship;
  const hasRelationshipData = object.relationship && object.subjectObject && object.objectObject;

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={handleClick}
    >
      {/* Background rectangle */}
      <rect
        width={endX - startX}
        height={laneHeight - 2}
        fill={ object.color as string || '#6b7280'}
        x={startX}
        y={topMargin + lane * laneHeight}
        rx="4"
        ry="4"
      />
      
      {/* Content container */}
      <foreignObject
        width={endX - startX}
        height={laneHeight - 2}
        x={startX}
        y={topMargin + lane * laneHeight}
        className="p-2"
      >
        <div className="h-full flex flex-col justify-center items-start text-white">
          {isRelationship && hasRelationshipData ? (
            // Relationship display
            <div className="space-y-0.5 w-full">
              {/* Relationship name and icon */}
              <div className="flex items-center gap-1 text-xs font-medium justify-start">
                <span className="text-sm">{renderIcon(object.icon)}</span>
                <span className="truncate">{object.name}</span>
              </div>
              
              {/* Subject and Object with arrow - keep them close together */}
              <div className="flex items-center gap-1 text-xs justify-start min-w-0 w-full">
                <div className="flex items-center gap-0.5 min-w-0 max-w-full overflow-hidden justify-start">
                  <span className="text-sm flex-shrink-0">{renderIcon(object.subjectObject?.icon)}</span>
                  <span className="font-medium truncate min-w-0">{object.subjectObject?.name}</span>
                </div>
                
                <div className="flex-shrink-0">
                  {object.relationship?.symmetrical ? (
                    <ArrowLeftRight className="w-2.5 h-2.5" />
                  ) : (
                    <ArrowRight className="w-2.5 h-2.5" />
                  )}
                </div>
                
                <div className="flex items-center gap-0.5 min-w-0 max-w-full overflow-hidden justify-start">
                  <span className="text-sm flex-shrink-0">{renderIcon(object.objectObject?.icon)}</span>
                  <span className="font-medium truncate min-w-0">{object.objectObject?.name}</span>
                </div>
              </div>
              
            </div>
          ) : (
            // Regular object display
            <div className="space-y-0.5 w-full">
              <div className="flex items-center gap-1 text-xs font-medium justify-start">
                <span className="text-sm">{renderIcon(object.icon)}</span>
                <span className="truncate">{object.name}</span>
              </div>
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}


function flattenObjectsToRanges(objects: Object[]): ExtractedObjectRange[] {
  const ranges: ExtractedObjectRange[] = [];

  for (const object of objects) {
    if (!object.timeRanges || object.timeRanges.length === 0) continue;

    object.timeRanges.forEach((range, index) => {
      ranges.push({
        object,
        rangeIndex: index,
        start: range.start,
        end: range.end,
      });
    });
  }

  return ranges;
}

function useLaneLayout(ranges: ExtractedObjectRange[], xFor: (d: Date) => number) {
  const now = useNow(100);

  return useMemo(() => {
    const placed: PlacedObjectRange[] = [];

    const sorted = [...ranges].sort((a, b) => {
      return a.start.getTime() - b.start.getTime();
    });

    const laneEnds: number[] = [];

    for (const range of sorted) {
      const startX = xFor(range.start);
      const endX = xFor(range.end ?? now);

      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] > startX) lane++;

      if (lane === laneEnds.length) laneEnds.push(endX);
      else laneEnds[lane] = endX;

      placed.push({
        startX,
        endX,
        lane,
        ...range,
      });
    }

    return { placed, lanes: laneEnds.length };
  }, [ranges, xFor, now]);
}

const renderIcon = (icon: any) => {
  if (!icon) return
  if ('text' in icon) return icon.text;
  if ('base64' in icon) return '📷';
};


export const ObjectsLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { objects } = useObjects();
      const { timeFormat } = useSettingsStore();
      
      const ranges = useMemo(() => flattenObjectsToRanges(objects), [objects]);
      const { start, end } = useTimelineRange();

      const xFor = useMemo(() => {
        return (d: Date) => transform.applyX(scale(d));
      }, [scale, transform]);

      const visibleItems = useMemo(() => {
        return ranges.filter(range =>
          range.start < end && // not in the future
          (range.end ?? range.start) > start  && // not in the past
          !(range.end &&  xFor(range.end) - xFor(start) < 4) // Wide enough to see
        );
      }, [ranges, start, end]);

      const layout = useLaneLayout(visibleItems, xFor);

      const height = topMargin + layout.lanes * laneHeight + 10;

      return (
        <svg className="w-full h-full zoomable" width={width} height={height}>
          {layout.placed.map(
              (range: PlacedObjectRange) => (
                <RangeBox key={`${range.object._id.toString()}-${range.rangeIndex}`} range={range} />
              )
          )}
        </svg>
      );
    },
  } as Layer;
};

export const CreateObjectTool: Tool = {
  component: () => {
    const navigate = useNavigate();
    return (
      <Button onClick={() => navigate("/objects/create")}>
        <PlusIcon className="w-4 h-4" />
      </Button>
    );
  },
};

export const RefreshObjectsTool: Tool = {
  component: () => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const refresh = useObjectsStore((state) => state.refresh);

    const handleRefresh = async () => {
      setIsRefreshing(true);
      try {
        await refresh();
      } finally {
        setIsRefreshing(false);
      }
    };

    return (
      <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline">
        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
    );
  },
};
