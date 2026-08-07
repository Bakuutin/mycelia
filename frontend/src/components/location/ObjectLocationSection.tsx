import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useLocationForRange,
  useLocationStatus,
} from "@/hooks/useLocationQueries";
import { LocationMiniMap } from "./LocationMiniMap";
import { formatDurationShort } from "./LocationMap";
import { formatPlace } from "@/types/location";
import type { Object as MyceliaObject } from "@/types/objects";

interface ObjectLocationSectionProps {
  object: MyceliaObject;
  /** Wire "Use detected location" into the object's lat/lng fields. */
  onApplyLocation?: (latitude: number, longitude: number) => void;
}

/**
 * Where the conversation/object happened, resolved from imported GPS tracks
 * by time overlap with its first time range. Hidden when there is no data.
 */
export function ObjectLocationSection({
  object,
  onApplyLocation,
}: ObjectLocationSectionProps) {
  const range = object.timeRanges?.[0];
  const start = range?.start ? new Date(range.start) : undefined;
  const end = range?.end
    ? new Date(range.end)
    : start
    ? new Date(start.getTime() + 60 * 60 * 1000)
    : undefined;

  const { data: status } = useLocationStatus(!!start);
  const enabled = !!start && !!end && (status?.hasData ?? false);
  const { data } = useLocationForRange(start, end, enabled);

  if (!enabled || !data || data.stays.length === 0) return null;

  const primary = data.primaryStay!;
  const [lng, lat] = primary.loc!.coordinates;
  const overlapMs = (primary as unknown as { overlapMs?: number }).overlapMs ??
    0;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          Location
        </h3>
        {onApplyLocation && !object.location && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onApplyLocation(lat, lng)}
          >
            Use detected location
          </Button>
        )}
      </div>
      <LocationMiniMap
        segments={data.stays}
        primary={primary}
        caption={
          <span>
            This happened in{" "}
            <span className="font-medium text-foreground">
              {formatPlace(data.primaryPlace)}
            </span>
            {overlapMs >= 5 * 60 * 1000 && (
              <>{" · "}{formatDurationShort(overlapMs)} there</>
            )}
            {primary.type === "manual" && " · set manually"}
          </span>
        }
      />
    </div>
  );
}
