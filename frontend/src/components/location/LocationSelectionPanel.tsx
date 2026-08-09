import { useState } from "react";
import { Info, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocationAt } from "@/hooks/useLocationQueries";
import { useLocationSelectionStore } from "@/stores/locationSelectionStore";
import { LocationMiniMap } from "./LocationMiniMap";
import { LocationSegmentDialog } from "./LocationSegmentDialog";
import { AssignLocationDialog } from "./AssignLocationDialog";
import { formatPlace, formatSources } from "@/types/location";

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (!enabled || !effectiveTime) return null;
  if (!isLoading && !data?.segment && !data?.point) {
    if (!segmentId) return null;
  }

  const segment = data?.segment ?? null;
  const timeZone = data?.timeZone ?? null;
  const sources = segment ? formatSources(segment.sources) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          📍 {segment ? formatPlace(segment.place) : "Location"}
          {timeZone && (
            <span className="font-normal text-muted-foreground">
              {timeZone}
            </span>
          )}
          {sources.map((s) => (
            <Badge key={s} variant="outline" className="font-normal">
              {s}
            </Badge>
          ))}
        </CardTitle>
        <div className="flex items-center gap-1">
          {segment && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Geotag details"
                onClick={() => setDetailsOpen(true)}
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title={segment.type === "manual"
                  ? "Edit manual location"
                  : "Override with a manual location"}
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
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
        </div>
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

      <LocationSegmentDialog
        segment={segment}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        onDeleted={clear}
      />
      {segment && (
        <AssignLocationDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editSegment={segment}
        />
      )}
    </Card>
  );
}
