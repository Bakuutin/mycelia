import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";
import { Badge } from "@/components/ui/badge";

const CLUSTER_RADIUS_PX = 52;

function icon(count: number, status?: string) {
  const color = count > 1
    ? "#f97316"
    : status === "ready"
    ? "#22c55e"
    : status === "failed" || status === "source_missing"
    ? "#ef4444"
    : "#64748b";
  const size = count > 99 ? 44 : count > 9 ? 38 : 32;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:12px;font-family:inherit;">📷${
        count > 1 ? ` ${count}` : ""
      }</div>`,
  });
}

export function PhotoClustersLayer({
  onStats,
}: {
  onStats?: (stats: {
    totalPlaced: number;
    visibleCount: number;
    unplacedLocationCount: number;
    truncated: boolean;
  }) => void;
}) {
  const map = useMap();
  const fittedOnce = useRef(false);
  const fittingUntil = useRef(0);
  const loadSerial = useRef(0);
  const moveTimer = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(
    undefined,
  );
  const [points, setPoints] = useState<any[]>([]);
  const [viewTick, setViewTick] = useState(0);

  const load = useCallback(async () => {
    const serial = ++loadSerial.current;
    const bounds = map.getBounds();
    const initialLoad = !fittedOnce.current;
    const result = await callResource("media-library", {
      action: "map",
      ...(initialLoad ? {} : {
        bounds: {
          west: Math.max(-180, Math.min(180, bounds.getWest())),
          south: Math.max(-90, Math.min(90, bounds.getSouth())),
          east: Math.max(-180, Math.min(180, bounds.getEast())),
          north: Math.max(-90, Math.min(90, bounds.getNorth())),
        },
      }),
      limit: 2_000,
    });
    if (serial !== loadSerial.current) return;
    setPoints(result.points ?? []);
    if (initialLoad) {
      fittedOnce.current = true;
    }
    if (initialLoad && (result.points?.length ?? 0) > 0) {
      // Leaflet can emit a late moveend after the fit animation and after the
      // initial request has resolved. Keep the authoritative bootstrap points
      // while that programmatic movement settles; subsequent user movement
      // still switches to bounded viewport queries.
      fittingUntil.current = Date.now() + 5_000;
      map.fitBounds(
        result.points.map((point: any) => [point.latitude, point.longitude]),
        { padding: [24, 24], maxZoom: 14 },
      );
    }
    onStats?.({
      totalPlaced: Number(result.totalPlaced ?? 0),
      visibleCount: Number(result.points?.length ?? 0),
      unplacedLocationCount: Number(result.unplacedLocationCount ?? 0),
      truncated: Boolean(result.truncated),
    });
  }, [map, onStats]);

  useEffect(() => {
    void load();
  }, [load]);
  const scheduleViewportLoad = useCallback(() => {
    if (Date.now() < fittingUntil.current) return;
    if (moveTimer.current !== undefined) {
      globalThis.clearTimeout(moveTimer.current);
    }
    moveTimer.current = globalThis.setTimeout(() => {
      setViewTick((value) => value + 1);
      void load();
    }, 120);
  }, [load]);
  useEffect(() => () => {
    if (moveTimer.current !== undefined) {
      globalThis.clearTimeout(moveTimer.current);
    }
  }, []);
  useMapEvents({
    moveend: scheduleViewportLoad,
    zoomend: scheduleViewportLoad,
  });

  const clusters = useMemo(() => {
    void viewTick;
    const result: Array<{
      lat: number;
      lng: number;
      x: number;
      y: number;
      points: any[];
    }> = [];
    for (const point of points) {
      const projected = map.latLngToContainerPoint([
        point.latitude,
        point.longitude,
      ]);
      const found = result.find((entry) =>
        Math.hypot(entry.x - projected.x, entry.y - projected.y) <
          CLUSTER_RADIUS_PX
      );
      if (found) found.points.push(point);
      else {
        result.push({
          lat: point.latitude,
          lng: point.longitude,
          x: projected.x,
          y: projected.y,
          points: [point],
        });
      }
    }
    return result;
  }, [map, points, viewTick]);

  return (
    <>
      {clusters.map((cluster, index) => {
        const point = cluster.points[0];
        const merged = cluster.points.length > 1;
        return (
          <Marker
            key={`${cluster.lat}:${cluster.lng}:${index}`}
            position={[cluster.lat, cluster.lng]}
            icon={icon(cluster.points.length, point.status)}
            eventHandlers={merged
              ? {
                click: () =>
                  map.setView(
                    [cluster.lat, cluster.lng],
                    Math.min(map.getZoom() + 2, 18),
                  ),
              }
              : undefined}
          >
            {!merged && (
              <Popup minWidth={240}>
                <div className="space-y-2">
                  <AuthenticatedMediaImage
                    path={point.thumbnailUrl}
                    alt={point.fileName}
                    className="h-32 w-full rounded object-cover"
                  />
                  <div className="font-medium">{point.fileName}</div>
                  <div className="flex gap-1">
                    <Badge>{point.status}</Badge>
                    {point.capturedAt && (
                      <Badge variant="outline">
                        {new Date(point.capturedAt).toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  <div className="font-mono text-xs">
                    {Number(point.latitude).toFixed(6)},{" "}
                    {Number(point.longitude).toFixed(6)}
                  </div>
                  {point.shortCaption && (
                    <p className="text-sm">{point.shortCaption}</p>
                  )}
                  <Link
                    className="text-sm underline"
                    to={`/media?assetId=${String(point.assetId)}`}
                  >
                    Open photo details
                  </Link>
                </div>
              </Popup>
            )}
          </Marker>
        );
      })}
    </>
  );
}
