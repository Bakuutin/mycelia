import { useMemo } from "react";
import type * as d3 from "d3";
import { useTimelineTimeZone } from "@/hooks/useTimelineTimeZone";
import { getShortTimeZoneName } from "@/lib/timeZones";

interface TimeZoneContextTrackProps {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  width: number;
}

export function TimeZoneContextTrack({
  scale,
  transform,
  width,
}: TimeZoneContextTrackProps) {
  const { periods } = useTimelineTimeZone();
  const rendered = useMemo(() => {
    const rescaled = transform.rescaleX(scale);
    const [domainStart, domainEnd] = rescaled.domain();
    return periods.flatMap((period) => {
      const start = new Date(period.start);
      const end = new Date(period.end);
      if (end <= domainStart || start >= domainEnd) return [];
      const left = Math.max(0, rescaled(start));
      const right = Math.min(width, rescaled(end));
      return [{
        ...period,
        left,
        width: Math.max(1, right - left),
        start,
      }];
    });
  }, [periods, scale, transform, width]);

  if (rendered.length === 0) return null;

  return (
    <div className="relative h-7 overflow-hidden rounded-sm border-y bg-muted/20">
      <div className="absolute left-2 top-1 z-10 text-[10px] font-medium text-muted-foreground">
        Time zones
      </div>
      {rendered.map((period) => (
        <div
          key={typeof period._id === "string"
            ? period._id
            : period._id.toString()}
          className="absolute inset-y-0 overflow-hidden border-x border-primary/30 bg-primary/10 px-1 text-[10px] leading-7 text-primary"
          style={{ left: period.left, width: period.width }}
          title={`${
            period.location?.name ? `${period.location.name} · ` : ""
          }${period.timeZone}`}
        >
          <span className="whitespace-nowrap">
            {period.location?.name ? `${period.location.name} · ` : ""}
            {period.timeZone}{" "}
            ({getShortTimeZoneName(period.start, period.timeZone)})
          </span>
        </div>
      ))}
    </div>
  );
}
