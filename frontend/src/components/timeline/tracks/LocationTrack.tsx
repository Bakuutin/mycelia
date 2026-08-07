import React, { memo, useEffect, useMemo, useState } from "react";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";
import { BaseTrack } from "./BaseTrack";
import { useTimelineRange } from "@/stores/timelineRange";
import {
  useLocationLiveUpdates,
  useLocationSegments,
} from "@/hooks/useLocationQueries";
import { useLocationSelectionStore } from "@/stores/locationSelectionStore";
import type { LocationSegment } from "@/types/location";
import { formatPlace, placeColor as sharedPlaceColor } from "@/types/location";

export const LOCATIONS_CONFIG: TrackConfig = {
  id: "locations",
  label: "Locations",
  description: "Where you were, from imported GPS tracks",
  defaultVisible: false,
  defaultHeight: 28,
  color: "#14b8a6", // Teal
};

const GAP_FILL = "#9ca3af";
const MOVE_FILL = "#3b82f6";

function placeColor(segment: LocationSegment): string {
  return sharedPlaceColor(segment.place, segment.type === "manual");
}

/** Debounce the shared range so zooming does not spam the API. */
function useDebouncedRange(delayMs = 300): { start: Date; end: Date } {
  const { start, end } = useTimelineRange();
  const [debounced, setDebounced] = useState({ start, end });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ start, end }), delayMs);
    return () => clearTimeout(t);
  }, [start.getTime(), end.getTime(), delayMs]);
  return debounced;
}

export const LocationTrack = memo(function LocationTrack({
  scale,
  transform,
  width,
  height,
}: Omit<TrackRenderProps, "items"> & { items?: TrackRenderProps["items"] }) {
  const { start, end } = useDebouncedRange();
  const select = useLocationSelectionStore((s) => s.select);
  const selectedId = useLocationSelectionStore((s) => s.segmentId);

  // Drop sub-2px moves/gaps server-side; the track never draws paths.
  const coalesceMs = width > 0
    ? ((end.getTime() - start.getTime()) / width) * 2
    : undefined;
  const { data } = useLocationSegments(start, end, {
    maxPoints: 500,
    coalesceMs,
  });
  useLocationLiveUpdates();

  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform],
  );

  const bands = useMemo(() => {
    return (data?.segments ?? []).map((segment) => {
      const x0 = rescaledScale(new Date(segment.start));
      const x1 = rescaledScale(new Date(segment.end));
      const x = Math.max(-10, x0);
      const w = Math.max(1.5, Math.min(width + 10, x1) - x);
      return { segment, x, width: w };
    }).filter((b) => b.x < width && b.x + b.width > 0);
  }, [data?.segments, rescaledScale, width]);

  return (
    <BaseTrack
      config={LOCATIONS_CONFIG}
      scale={scale}
      transform={transform}
      width={width}
      height={height}
      items={[]}
    >
      <defs>
        <pattern
          id="location-gap-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={GAP_FILL} strokeWidth="2" />
        </pattern>
      </defs>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="#e5e7eb"
        className="dark:fill-slate-800"
        opacity={0.4}
      />
      {bands.map(({ segment, x, width: w }) => {
        const isStay = segment.type === "stay" || segment.type === "manual";
        const isGap = segment.type === "gap";
        const selected = selectedId === String(segment._id);
        const label = isStay && w >= 60 ? formatPlace(segment.place) : null;
        const fill = isStay
          ? placeColor(segment)
          : isGap
          ? "url(#location-gap-hatch)"
          : MOVE_FILL;
        const y = isStay ? 2 : height / 2 - (isGap ? 6 : 2);
        const h = isStay ? height - 4 : isGap ? 12 : 4;
        return (
          <g
            key={String(segment._id)}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              const mid = new Date(
                (new Date(segment.start).getTime() +
                  new Date(segment.end).getTime()) / 2,
              );
              select(String(segment._id), mid);
            }}
          >
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={isStay ? 3 : 2}
              fill={fill}
              opacity={isGap ? 0.7 : selected ? 1 : 0.85}
              stroke={selected ? "#f59e0b" : "transparent"}
              strokeWidth={selected ? 2 : 0}
            >
              <title>
                {isGap
                  ? "No data — assumed route"
                  : formatPlace(segment.place)}
              </title>
            </rect>
            {label && (
              <text
                x={Math.max(x, 0) + 6}
                y={height / 2 + 3.5}
                fontSize={10}
                fill="white"
                pointerEvents="none"
                style={{ userSelect: "none" }}
              >
                {label.length > Math.floor(w / 6)
                  ? label.slice(0, Math.floor(w / 6)) + "…"
                  : label}
              </text>
            )}
          </g>
        );
      })}
    </BaseTrack>
  );
});
