import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Layer, LayerComponentProps, Tool } from "@/core/core.ts";
import { useObjects, useObjectsStore } from "./useObjects.ts";
import { Button } from "@/components/ui/button.tsx";
import type { Object } from "@/types/objects.ts";
import {
  ArrowLeftRight,
  ArrowRight,
  PlusIcon,
  RefreshCw,
} from "lucide-react";
import { useTimelineRange } from "../../stores/timelineRange.ts";
import { useNow } from "@/hooks/useNow.ts";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore.ts";
import { useSpanningObjectsStore } from "@/stores/spanningObjectsStore.ts";

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
  isSmall: boolean;
} & ExtractedObjectRange;

const SMALL_OBJECT_THRESHOLD = 50;

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
  const { startX: rawStartX, endX, lane, object, startOffScreen, endOffScreen, isSmall } = range;
  const startX = rawStartX < 0 ? 0 : rawStartX;
  const { toggleSelection, isSelected, addToSelection, clearSelection } =
    useObjectSelectionStore();

  const selected = isSelected(object._id);

  const handleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelection(object._id);
    } else {
      clearSelection();
      addToSelection(object._id);
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

  let rangeWidth = endX - startX;

  if (Number.isNaN(rangeWidth) || rangeWidth <= 0) return null;
  if (rangeWidth < 2) rangeWidth = 2;

  const height = laneHeight - 2;
  const x = startX;
  const y = topMargin + lane * laneHeight;
  const cornerRadius = 4;
  const chevronOffset = 8;
  const showEndChevron = range.hasNoEnd || endOffScreen;

  const clipPathId = `clip-${range.object._id.toString()}-${range.rangeIndex}`;
  const filterId = `blur-${range.object._id.toString()}-${range.rangeIndex}`;
  
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
        {isSmall && (
          <filter id={filterId}>
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        )}
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
        filter={isSmall ? `url(#${filterId})` : undefined}
        opacity={isSmall ? 0.7 : 1}
      />

      {/* Content container - only show for non-small objects */}
      {!isSmall && (
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
      )}
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
  visibleStart: Date,
  visibleEnd: Date,
) {
  const now = useNow(100);

  return useMemo(() => {
    const bigRanges: ExtractedObjectRange[] = [];
    const smallRanges: ExtractedObjectRange[] = [];
    const spanningObjects: Object[] = [];
    const ongoingObjects: Object[] = [];

    const nowIsVisible = now >= visibleStart && now <= visibleEnd;

    for (const range of ranges) {
      const originalStartX = xFor(range.start);
      const originalEndX = xFor(range.end ?? now);
      const startX = originalStartX < 0 ? 0 : originalStartX;
      const endX = originalEndX > width ? width : originalEndX;
      const rangeWidth = endX - startX;

      if (rangeWidth < 0.5) continue;

      const startOffScreen = originalStartX < 0;
      const endOffScreen = originalEndX > width;
      const isOngoing = range.end === null || range.end === undefined;

      if (nowIsVisible && isOngoing) {
        if (!ongoingObjects.some((o) => o._id === range.object._id)) {
          ongoingObjects.push(range.object);
        }
        continue;
      }

      if (startOffScreen && endOffScreen) {
        if (!spanningObjects.some((o) => o._id === range.object._id)) {
          spanningObjects.push(range.object);
        }
        continue;
      }

      if (rangeWidth <= SMALL_OBJECT_THRESHOLD) {
        smallRanges.push(range);
      } else {
        bigRanges.push(range);
      }
    }

    const sortedBig = [...bigRanges].sort((a, b) =>
      a.start.getTime() - b.start.getTime()
    );
    const sortedSmall = [...smallRanges].sort((a, b) =>
      a.start.getTime() - b.start.getTime()
    );

    const bigLaneEnds: number[] = [];
    const placed: PlacedObjectRange[] = [];

    for (const range of sortedBig) {
      const originalStartX = xFor(range.start);
      const originalEndX = xFor(range.end ?? now);
      const startOffScreen = originalStartX < 0;
      const endOffScreen = originalEndX > width;
      const startX = startOffScreen ? 0 : originalStartX;
      const endX = endOffScreen ? width : originalEndX;

      let lane = 0;
      while (lane < bigLaneEnds.length && bigLaneEnds[lane] > startX) {
        lane++;
      }

      if (lane === bigLaneEnds.length) bigLaneEnds.push(endX);
      else bigLaneEnds[lane] = endX;

      placed.push({
        startX,
        endX,
        lane,
        startOffScreen,
        endOffScreen,
        hasNoEnd: range.end === null,
        isSmall: false,
        ...range,
      });
    }

    const bigLaneCount = bigLaneEnds.length;
    const smallLane = bigLaneCount;

    for (const range of sortedSmall) {
      const originalStartX = xFor(range.start);
      const originalEndX = xFor(range.end ?? now);
      const startOffScreen = originalStartX < 0;
      const endOffScreen = originalEndX > width;
      const startX = startOffScreen ? 0 : originalStartX;
      const endX = endOffScreen ? width : originalEndX;

      placed.push({
        startX,
        endX,
        lane: smallLane,
        startOffScreen,
        endOffScreen,
        hasNoEnd: range.end === null,
        isSmall: true,
        ...range,
      });
    }

    const hasSmallLane = smallRanges.length > 0;

    return {
      placed,
      lanes: bigLaneCount + (hasSmallLane ? 1 : 0),
      spanningObjects,
      ongoingObjects,
    };
  }, [ranges, xFor, width, now, visibleStart, visibleEnd]);
}

export const ObjectsLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { objects, loading } = useObjects();
      const setSpanningObjects = useSpanningObjectsStore(
        (state) => state.setSpanningObjects,
      );
      const setOngoingObjects = useSpanningObjectsStore(
        (state) => state.setOngoingObjects,
      );

      const ranges = useMemo(() => flattenObjectsToRanges(objects), [objects]);
      const { start, end } = useTimelineRange();

      const xFor = useMemo(() => {
        return (d: Date) => transform.applyX(scale(d));
      }, [scale, transform]);

      const layout = useLaneLayout(ranges, xFor, width, start, end);

      useEffect(() => {
        setSpanningObjects(layout.spanningObjects);
      }, [layout.spanningObjects, setSpanningObjects]);

      useEffect(() => {
        setOngoingObjects(layout.ongoingObjects);
      }, [layout.ongoingObjects, setOngoingObjects]);

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
          {loading && (
            <g className="loading-indicator" opacity={0.6}>
              <rect
                x={xFor(start)}
                y={4}
                width={Math.max(2, xFor(end) - xFor(start))}
                height={3}
                fill="currentColor"
                className="text-primary animate-pulse"
                rx={1}
              />
            </g>
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
  tooltip: "Create new object",
};

export const RefreshObjectsTool: Tool = {
  component: () => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const fetchForRange = useObjectsStore((state) => state.fetchForRange);
    const { start, end } = useTimelineRange();

    const handleRefresh = async () => {
      setIsRefreshing(true);
      try {
        await fetchForRange(start, end);
      } finally {
        setIsRefreshing(false);
      }
    };

    return (
      <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="icon">
        <RefreshCw
          className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
        />
      </Button>
    );
  },
  tooltip: "Refresh objects for current time range",
  label: "Refresh",
};
