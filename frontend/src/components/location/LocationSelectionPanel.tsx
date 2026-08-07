import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocationAt } from "@/hooks/useLocationQueries";
import { useLocationSelectionStore } from "@/stores/locationSelectionStore";
import { LocationMiniMap } from "./LocationMiniMap";
import { formatPlace } from "@/types/location";

interface LocationSelectionPanelProps {
  /**
   * Fallback instant to resolve when nothing is selected on the Locations
   * track itself — e.g. the start of the currently selected object marker.
   */
  fallbackTime?: Date | null;
  enabled: boolean;
}

export function LocationSelectionPanel({
  fallbackTime,
  enabled,
}: LocationSelectionPanelProps) {
  const { segmentId, time, clear } = useLocationSelectionStore();
  const effectiveTime = time ?? fallbackTime ?? undefined;
  const { data, isLoading } = useLocationAt(effectiveTime, enabled);

  if (!enabled || !effectiveTime) return null;
  if (!isLoading && !data?.segment && !data?.point) {
    if (!segmentId) return null;
  }

  const segment = data?.segment ?? null;
  const timeZone = data?.timeZone ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {segment ? formatPlace(segment.place) : "Location"}
          {timeZone && (
            <span className="ml-2 font-normal text-muted-foreground">
              {timeZone}
            </span>
          )}
        </CardTitle>
        {segmentId && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clear}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {segment
          ? (
            <LocationMiniMap
              segments={[segment]}
              primary={segment}
              caption={
                <span>
                  <span className="font-medium text-foreground">
                    {formatPlace(segment.place)}
                  </span>
                  {" · "}
                  {new Date(effectiveTime).toLocaleString()}
                  {segment.type === "gap" ? " · assumed (no data)" : ""}
                  {segment.type === "manual" ? " · set manually" : ""}
                </span>
              }
            />
          )
          : (
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? "Looking up location…"
                : "No location data around this moment."}
            </p>
          )}
      </CardContent>
    </Card>
  );
}
