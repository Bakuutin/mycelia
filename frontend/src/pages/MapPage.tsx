import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMap } from "react-leaflet";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  Clock,
  Database,
  Loader2,
  MapPin,
  MessageSquare,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { callResource } from "@/lib/api";
import { useTimelineRange } from "@/stores/timelineRange";
import {
  useConversationsOnMap,
  useLocationLiveUpdates,
  useLocationSegments,
  useLocationStatus,
} from "@/hooks/useLocationQueries";
import { LocationMap, formatDurationShort } from "@/components/location/LocationMap";
import { ConversationClustersLayer } from "@/components/location/ConversationClustersLayer";
import { ImportTracksDialog } from "@/components/location/ImportTracksDialog";
import { AssignLocationDialog } from "@/components/location/AssignLocationDialog";
import type {
  ConversationMapGroup,
  LocationPlace,
  LocationSegment,
} from "@/types/location";
import { placeColor } from "@/types/location";

interface PlaceChip {
  key: string;
  place: LocationPlace | null;
  loc: { type: "Point"; coordinates: [number, number] };
  dwellMs: number;
  stayCount: number;
  conversationCount: number;
  manual: boolean;
  longestStay: LocationSegment | null;
  group: ConversationMapGroup | null;
}

type IconData = { text?: string; base64?: string };

function renderIcon(icon: string | IconData | null | undefined): string {
  if (!icon) return "";
  if (typeof icon === "string") return icon;
  if ("text" in icon && icon.text) return icon.text;
  if ("base64" in icon && icon.base64) return "📷";
  return "";
}
import { formatPlace, segmentDurationMs } from "@/types/location";

const DAY_MS = 24 * 60 * 60 * 1000;

const PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "Day", days: 1 },
  { label: "Week", days: 7 },
  { label: "Month", days: 30 },
  { label: "Year", days: 365 },
  { label: "All", days: null },
];

function maxPointsForRange(rangeMs: number): number {
  if (rangeMs <= 7 * DAY_MS) return 5000;
  if (rangeMs <= 90 * DAY_MS) return 3000;
  return 2000;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 11));
  }, [map, target?.[0], target?.[1]]);
  return null;
}

const MapPage = () => {
  const navigate = useNavigate();
  const { start, end, setRange } = useTimelineRange();
  const { data: status } = useLocationStatus();
  const [showConversations, setShowConversations] = useState(true);
  const [conversationsAllTime, setConversationsAllTime] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignRange, setAssignRange] = useState<
    { start: Date; end: Date } | null
  >(null);
  const [selectedGroup, setSelectedGroup] = useState<
    ConversationMapGroup | null
  >(null);
  const [selectedSegment, setSelectedSegment] = useState<
    LocationSegment | null
  >(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [downloadingGeonames, setDownloadingGeonames] = useState(false);

  const rangeMs = end.getTime() - start.getTime();
  const { data: segmentsData, isLoading } = useLocationSegments(start, end, {
    maxPoints: maxPointsForRange(rangeMs),
  });
  useLocationLiveUpdates();
  const { data: conversationsData } = useConversationsOnMap(start, end, {
    enabled: showConversations,
    allTime: conversationsAllTime,
  });

  const segments = segmentsData?.segments ?? [];
  const hasData = status?.hasData ?? true;

  // Places currently on the map, aggregated for the chip strip under it.
  const placeChips = useMemo<PlaceChip[]>(() => {
    const byKey = new Map<string, PlaceChip>();
    const keyOf = (place: LocationPlace | null | undefined, fallback: string) =>
      place?.geonameId != null
        ? `g:${place.geonameId}`
        : place?.name
        ? `n:${place.name}`
        : fallback;

    for (const segment of segments) {
      if (
        (segment.type !== "stay" && segment.type !== "manual") || !segment.loc
      ) continue;
      const key = keyOf(segment.place, `s:${segment._id}`);
      const dwell = segmentDurationMs(segment);
      let chip = byKey.get(key);
      if (!chip) {
        chip = {
          key,
          place: segment.place ?? null,
          loc: segment.loc,
          dwellMs: 0,
          stayCount: 0,
          conversationCount: 0,
          manual: segment.type === "manual",
          longestStay: null,
          group: null,
        };
        byKey.set(key, chip);
      }
      chip.dwellMs += dwell;
      chip.stayCount++;
      if (
        !chip.longestStay || dwell > segmentDurationMs(chip.longestStay)
      ) {
        chip.longestStay = segment;
      }
    }

    for (const group of conversationsData?.groups ?? []) {
      const key = keyOf(group.place, group.key);
      const chip = byKey.get(key);
      if (chip) {
        chip.conversationCount = group.conversationCount;
        chip.group = group;
      } else {
        byKey.set(key, {
          key,
          place: group.place,
          loc: group.loc,
          dwellMs: 0,
          stayCount: group.stayCount,
          conversationCount: group.conversationCount,
          manual: false,
          longestStay: null,
          group,
        });
      }
    }

    return [...byKey.values()].sort((a, b) => b.dwellMs - a.dwellMs);
  }, [segments, conversationsData?.groups]);

  const applyPreset = (days: number | null) => {
    const now = new Date();
    if (days === null) {
      setRange(new Date("2000-01-01T00:00:00Z"), now);
    } else {
      setRange(new Date(now.getTime() - days * DAY_MS), now);
    }
  };

  const activePreset = useMemo(() => {
    const now = Date.now();
    if (Math.abs(end.getTime() - now) > 6 * 60 * 60 * 1000) return null;
    for (const preset of PRESETS) {
      if (preset.days === null) {
        if (start.getFullYear() <= 2000) return preset.label;
        continue;
      }
      if (Math.abs(rangeMs - preset.days * DAY_MS) < DAY_MS / 4) {
        return preset.label;
      }
    }
    return null;
  }, [start, end, rangeMs]);

  const openInTimeline = (segment: LocationSegment) => {
    const s = new Date(segment.start).getTime() - 60 * 60 * 1000;
    const e = new Date(segment.end).getTime() + 60 * 60 * 1000;
    navigate(`/timeline?start=${s}&end=${e}`);
  };

  const startGeonamesDownload = async () => {
    setDownloadingGeonames(true);
    try {
      await callResource("jobs", {
        action: "enqueue",
        data: { type: "geonames_download" },
        trigger: {
          type: "manual",
          reason: "Places database download requested from the map page",
        },
      });
      toast.success(
        "Downloading the places database in the background — check the Jobs page for progress. Place names appear automatically when it finishes.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start download",
      );
      setDownloadingGeonames(false);
    }
  };

  const handleSegmentClick = (segment: LocationSegment) => {
    if (segment.type === "gap") {
      setAssignRange({
        start: new Date(segment.start),
        end: new Date(segment.end),
      });
      return;
    }
    setSelectedGroup(null);
    setSelectedSegment(segment);
  };

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant={activePreset === preset.label ? "secondary" : "ghost"}
              size="sm"
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="show-conversations"
            checked={showConversations}
            onCheckedChange={setShowConversations}
          />
          <Label
            htmlFor="show-conversations"
            className="flex items-center gap-1 text-sm"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Conversations
          </Label>
          {showConversations && (
            <>
              <Switch
                id="conversations-all-time"
                checked={conversationsAllTime}
                onCheckedChange={setConversationsAllTime}
              />
              <Label htmlFor="conversations-all-time" className="text-sm">
                All time
              </Label>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {status && !status.geonamesReady && (
            <Button
              variant="outline"
              size="sm"
              disabled={downloadingGeonames}
              onClick={startGeonamesDownload}
            >
              {downloadingGeonames
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Database className="mr-2 h-4 w-4" />}
              Download places database
            </Button>
          )}
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import tracks
          </Button>
        </div>
      </div>

      {/* Map + side panel */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="isolate min-h-0 flex-1 overflow-hidden rounded-lg border">
          {!hasData
            ? (
              <div className="flex h-full items-center justify-center">
                <Card className="max-w-md">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5" />
                      No location data yet
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1">
                      <li>
                        Download the places database (one time, ~13 MB) so
                        stays get city names.
                      </li>
                      <li>
                        Export a track from Organic Maps: track →{" "}
                        <span className="font-medium">Share → GPX/KML</span>.
                      </li>
                      <li>Import the files here.</li>
                    </ol>
                    <div className="flex gap-2 pt-1">
                      {status && !status.geonamesReady && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={startGeonamesDownload}
                          disabled={downloadingGeonames}
                        >
                          <Database className="mr-2 h-4 w-4" />
                          Download places
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setImportOpen(true)}>
                        <Upload className="mr-2 h-4 w-4" />
                        Import tracks
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
            : (
              <LocationMap
                segments={segments}
                selectedSegmentId={selectedSegment
                  ? String(selectedSegment._id)
                  : null}
                onSegmentClick={handleSegmentClick}
              >
                {showConversations && (
                  <ConversationClustersLayer
                    groups={conversationsData?.groups ?? []}
                    onSelectGroup={(group) => {
                      setSelectedSegment(null);
                      setSelectedGroup(group);
                    }}
                  />
                )}
                <FlyTo target={flyTarget} />
              </LocationMap>
            )}
        </div>

        {/* Places currently on the map: clickable cluster chips */}
        {placeChips.length > 0 && (
          <div className="flex max-h-24 shrink-0 flex-wrap gap-1.5 overflow-y-auto">
            {placeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                title={`${formatPlace(chip.place)} — ${
                  chip.stayCount
                } stay${chip.stayCount === 1 ? "" : "s"}`}
                onClick={() => {
                  setFlyTarget([
                    chip.loc.coordinates[1],
                    chip.loc.coordinates[0],
                  ]);
                  if (chip.group) {
                    setSelectedSegment(null);
                    setSelectedGroup(chip.group);
                  } else if (chip.longestStay) {
                    setSelectedGroup(null);
                    setSelectedSegment(chip.longestStay);
                  }
                }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: placeColor(chip.place, chip.manual),
                  }}
                />
                <span className="max-w-40 truncate font-medium">
                  {formatPlace(chip.place)}
                </span>
                {chip.dwellMs > 0 && (
                  <span className="text-muted-foreground">
                    {formatDurationShort(chip.dwellMs)}
                  </span>
                )}
                {chip.conversationCount > 0 && (
                  <span className="text-muted-foreground">
                    💬 {chip.conversationCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        </div>

        {(selectedGroup || selectedSegment) && (
          <Card className="flex w-80 shrink-0 flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="text-base">
                {selectedGroup
                  ? formatPlace(selectedGroup.place)
                  : formatPlace(selectedSegment!.place)}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setSelectedGroup(null);
                  setSelectedSegment(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {selectedSegment && (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    {new Date(selectedSegment.start).toLocaleString()} —{" "}
                    {new Date(selectedSegment.end).toLocaleString()}
                  </p>
                  <p>
                    Stayed {formatDurationShort(
                      segmentDurationMs(selectedSegment),
                    )}
                    {selectedSegment.timeZone && (
                      <Badge variant="secondary" className="ml-2">
                        {selectedSegment.timeZone}
                      </Badge>
                    )}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openInTimeline(selectedSegment)}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    Open in timeline
                  </Button>
                </div>
              )}

              {selectedGroup && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {selectedGroup.conversationCount}{" "}
                    conversation{selectedGroup.conversationCount === 1
                      ? ""
                      : "s"} here
                    {conversationsAllTime
                      ? " (all time)"
                      : " in the selected period"}
                  </p>
                  {selectedGroup.conversations.map((conv) => (
                    <div
                      key={String(conv._id)}
                      className="rounded-md border p-2 text-sm hover:bg-accent/50"
                    >
                      <Link
                        to={`/objects/${conv._id}`}
                        className="font-medium hover:underline"
                      >
                        {renderIcon(conv.icon as string | IconData)
                          ? `${renderIcon(conv.icon as string | IconData)} `
                          : ""}
                        {conv.name ?? "Untitled conversation"}
                      </Link>
                      <button
                        type="button"
                        className="mt-0.5 block text-xs text-muted-foreground hover:text-foreground"
                        title="Show on map"
                        onClick={() =>
                          setFlyTarget([
                            conv.stayLoc.coordinates[1],
                            conv.stayLoc.coordinates[0],
                          ])}
                      >
                        {new Date(conv.start).toLocaleString()}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <ImportTracksDialog open={importOpen} onOpenChange={setImportOpen} />
      <AssignLocationDialog
        open={assignRange !== null}
        onOpenChange={(open) => !open && setAssignRange(null)}
        initialStart={assignRange?.start}
        initialEnd={assignRange?.end}
      />
    </div>
  );
};

export default MapPage;
