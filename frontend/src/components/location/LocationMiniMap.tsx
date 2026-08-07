import { MapPin } from "lucide-react";
import type { LocationSegment } from "@/types/location";
import { formatPlace, segmentDurationMs } from "@/types/location";
import { formatDurationShort, LocationMap } from "./LocationMap";

interface LocationMiniMapProps {
  segments: LocationSegment[];
  /** Segment the caption describes (defaults to the first stay/manual). */
  primary?: LocationSegment | null;
  caption?: React.ReactNode;
  className?: string;
}

export function LocationMiniMap({
  segments,
  primary,
  caption,
  className,
}: LocationMiniMapProps) {
  const focus = primary ??
    segments.find((s) => s.type === "stay" || s.type === "manual") ??
    segments[0] ?? null;

  return (
    <div className={className}>
      <div className="isolate h-48 overflow-hidden rounded-md border border-border">
        <LocationMap
          segments={segments}
          selectedSegmentId={focus ? String(focus._id) : null}
          scrollWheelZoom={false}
        />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        {caption ?? (
          focus
            ? (
              <span>
                <span className="font-medium text-foreground">
                  {formatPlace(focus.place)}
                </span>
                {" · "}
                {formatDurationShort(segmentDurationMs(focus))}
                {focus.type === "manual" ? " · set manually" : ""}
                {focus.type === "gap" ? " · assumed" : ""}
              </span>
            )
            : <span>No location data for this moment</span>
        )}
      </div>
    </div>
  );
}
