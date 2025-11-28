import React, { useEffect, useMemo, useState } from "react";
import type { Layer, LayerComponentProps, Tool } from "@/core/core.ts";
import { useObjects, useObjectsStore } from "./useObjects.ts";
import { Button } from "@/components/ui/button.tsx";
import type { Object } from "@/types/objects.ts";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  PlusIcon,
  RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTimelineRange } from "../../stores/timelineRange.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatTime, formatTimeRangeDuration } from "@/lib/formatTime.ts";
import { useSettingsStore } from "@/stores/settingsStore.ts";
import { getRelationships } from "@/hooks/useObjectQueries.ts";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore.ts";

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
  startOffScreen: boolean;
  endOffScreen: boolean;
  hasNoEnd: boolean;
} & ExtractedObjectRange;

function getLeftBoundaryPath(
  x: number,
  y: number,
  width: number,
  height: number,
  startOffScreen: boolean,
  cornerRadius: number,
  chevronOffset: number,
): string {
  if (startOffScreen) {
    return `M ${x + chevronOffset} ${y}
      L ${x + chevronOffset / 2} ${y + height / 2}
      L ${x + chevronOffset} ${y + height}
      L ${x + width} ${y + height}
      L ${x + width} ${y}
      Z`;
  } else {
    return `M ${x + cornerRadius} ${y}
      Q ${x} ${y} ${x} ${y + cornerRadius}
      L ${x} ${y + height - cornerRadius}
      Q ${x} ${y + height} ${x + cornerRadius} ${y + height}
      L ${x + width} ${y + height}
      L ${x + width} ${y}
      Z`;
  }
}

function getRightBoundaryPath(
  x: number,
  y: number,
  width: number,
  height: number,
  showEndChevron: boolean,
  cornerRadius: number,
  chevronOffset: number,
): string {
  const rightX = x + width;
  if (showEndChevron) {
    return `M ${rightX - chevronOffset} ${y}
      L ${rightX - chevronOffset / 2} ${y + height / 2}
      L ${rightX - chevronOffset} ${y + height}
      L ${x} ${y + height}
      L ${x} ${y}
      Z`;
  } else {
    return `M ${rightX - cornerRadius} ${y}
      Q ${rightX} ${y} ${rightX} ${y + cornerRadius}
      L ${rightX} ${y + height - cornerRadius}
      Q ${rightX} ${y + height} ${rightX - cornerRadius} ${y + height}
      L ${x} ${y + height}
      L ${x} ${y}
      Z`;
  }
}

function RangeBox({ range, width }: { range: PlacedObjectRange; width: number }) {
  const navigate = useNavigate();
  const { start, end, startX, endX, lane, object, startOffScreen, endOffScreen } = range;
  const { timeFormat } = useSettingsStore();
  const now = useNow();
  const { toggleSelection, isSelected } = useObjectSelectionStore();

  const selected = isSelected(object._id);

  const handleClick = (e: React.MouseEvent) => {
    // Check for command-click (Cmd on Mac, Ctrl on Windows/Linux)
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelection(object._id);
    } else {
      navigate(`/objects/${object._id.toString()}`);
    }
  };

  const renderIcon = (icon: any) => {
    if (!icon) return "";
    if (typeof icon === "string") return icon;
    if (icon.text) return icon.text;
    if (icon.base64) return "📷";
    return "";
  };

  const isRelationship = object.isRelationship;
  const hasRelationshipData = object.relationship && object.subjectObject &&
    object.objectObject;

  const rangeWidth = endX - startX;
  const height = laneHeight - 2;
  const x = startX;
  const y = topMargin + lane * laneHeight;
  const cornerRadius = 4;
  const chevronOffset = 8;
  const actualEndX = endOffScreen ? width : endX;
  const showEndChevron = range.hasNoEnd || endOffScreen;

  const clipPathId = `clip-${range.object._id.toString()}-${range.rangeIndex}`;
  
  const leftBoundaryPath = getLeftBoundaryPath(x, y, rangeWidth, height, startOffScreen, cornerRadius, chevronOffset);
  const rightBoundaryPath = getRightBoundaryPath(x, y, rangeWidth, height, showEndChevron, cornerRadius, chevronOffset);

  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={handleClick}
    >
      <defs>
        <clipPath id={`${clipPathId}-left`}>
          <path d={leftBoundaryPath} />
        </clipPath>
        <clipPath id={clipPathId}>
          <path d={rightBoundaryPath} clipPath={`url(#${clipPathId}-left)`} />
        </clipPath>
      </defs>

      {/* Background rectangle */}
      <rect
        x={x}
        y={y}
        width={rangeWidth}
        height={height}
        fill={object.color as string || "#6b7280"}
        stroke={selected ? "#2563eb" : "none"}
        strokeWidth={selected ? 3 : 0}
        clipPath={`url(#${clipPathId})`}
      />

      {/* Content container */}
      <foreignObject
        width={rangeWidth}
        height={laneHeight - 2}
        x={startX}
        y={topMargin + lane * laneHeight}
        className="p-2"
        clipPath={`url(#${clipPathId})`}
      >
        <div className="h-full flex flex-col justify-center items-start text-white">
          {isRelationship && hasRelationshipData
            ? (
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
                    <span className="text-sm flex-shrink-0">
                      {renderIcon(object.subjectObject?.icon)}
                    </span>
                    <span className="font-medium truncate min-w-0">
                      {object.subjectObject?.name}
                    </span>
                  </div>

                  <div className="flex-shrink-0">
                    {object.relationship?.symmetrical
                      ? <ArrowLeftRight className="w-2.5 h-2.5" />
                      : <ArrowRight className="w-2.5 h-2.5" />}
                  </div>

                  <div className="flex items-center gap-0.5 min-w-0 max-w-full overflow-hidden justify-start">
                    <span className="text-sm flex-shrink-0">
                      {renderIcon(object.objectObject?.icon)}
                    </span>
                    <span className="font-medium truncate min-w-0">
                      {object.objectObject?.name}
                    </span>
                  </div>
                </div>
              </div>
            )
            : (
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

function useLaneLayout(
  ranges: ExtractedObjectRange[],
  xFor: (d: Date) => number,
  width: number,
) {
  const now = useNow(100);

  return useMemo(() => {
    const conversationRanges: ExtractedObjectRange[] = [];
    const regularRanges: ExtractedObjectRange[] = [];

    for (const range of ranges) {
      const originalStartX = xFor(range.start);
      const endX = xFor(range.end ?? now);
      const startX = originalStartX < 0 ? 0 : originalStartX;

      if (endX - startX < 0.5) continue;

      if (range.object.isConversation) {
        conversationRanges.push(range);
      } else {
        regularRanges.push(range);
      }
    }

    const sortedRegular = [...regularRanges].sort((a, b) =>
      a.start.getTime() - b.start.getTime()
    );
    const sortedConversations = [...conversationRanges].sort((a, b) =>
      a.start.getTime() - b.start.getTime()
    );

    const regularLaneEnds: number[] = [];
    const conversationLaneEnds: number[] = [];
    const placed: PlacedObjectRange[] = [];

    for (const range of sortedRegular) {
      const originalStartX = xFor(range.start);
      const originalEndX = xFor(range.end ?? now);
      const startOffScreen = originalStartX < 0;
      const endOffScreen = originalEndX > width;
      const startX = startOffScreen ? 0 : originalStartX;
      const endX = endOffScreen ? width : originalEndX;

      let lane = 0;
      while (lane < regularLaneEnds.length && regularLaneEnds[lane] > startX) {
        lane++;
      }

      if (lane === regularLaneEnds.length) regularLaneEnds.push(endX);
      else regularLaneEnds[lane] = endX;

      placed.push({
        startX,
        endX,
        lane,
        startOffScreen,
        endOffScreen,
        hasNoEnd: range.end === null,
        ...range,
      });
    }

    const regularLaneCount = regularLaneEnds.length;

    for (const range of sortedConversations) {
      const originalStartX = xFor(range.start);
      const originalEndX = xFor(range.end ?? now);
      const startOffScreen = originalStartX < 0;
      const endOffScreen = originalEndX > width;
      const startX = startOffScreen ? 0 : originalStartX;
      const endX = endOffScreen ? width : originalEndX;

      let lane = 0;
      while (
        lane < conversationLaneEnds.length && conversationLaneEnds[lane] > startX
      ) lane++;

      if (lane === conversationLaneEnds.length) {
        conversationLaneEnds.push(endX);
      } else conversationLaneEnds[lane] = endX;

      placed.push({
        startX,
        endX,
        lane: lane + regularLaneCount,
        startOffScreen,
        endOffScreen,
        hasNoEnd: range.end === null,
        ...range,
      });
    }

    return { placed, lanes: regularLaneCount + conversationLaneEnds.length };
  }, [ranges, xFor, width, now]);
}

const renderIcon = (icon: any) => {
  if (!icon) return;
  if ("text" in icon) return icon.text;
  if ("base64" in icon) return "📷";
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
        return ranges.filter((range) => {
          if (range.end) {
            return range.start < end && range.end > start;
          } else {
            return range.start < end;
          }
        });
      }, [ranges, start, end]);

      const layout = useLaneLayout(visibleItems, xFor, width);

      const height = topMargin + layout.lanes * laneHeight + 10;

      return (
        <svg className="w-full h-full zoomable" width={width} height={height}>
          {layout.placed.map(
            (range: PlacedObjectRange) => (
              <RangeBox
                key={`${range.object._id.toString()}-${range.rangeIndex}`}
                range={range}
                width={width}
              />
            ),
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
        <RefreshCw
          className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
        />
      </Button>
    );
  },
};
