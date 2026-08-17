import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationSegment } from "@/types/location";
import { formatPlace, segmentDurationMs } from "@/types/location";
import { useSettingsStore } from "@/stores/settingsStore";

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const STAY_COLOR = "#14b8a6";
export const MANUAL_COLOR = "#8b5cf6";
export const MOVE_COLOR = "#3b82f6";
export const GAP_COLOR = "#9ca3af";

export function formatDurationShort(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.round(hours / 24)}d`;
}

/** Radius encodes dwell duration: r = 4 * sqrt(hours), clamped to 4..24 px. */
export function stayRadiusPx(segment: LocationSegment): number {
  const hours = segmentDurationMs(segment) / 3_600_000;
  return Math.min(24, Math.max(4, 4 * Math.sqrt(hours)));
}

function segmentLatLngs(segment: LocationSegment): LatLngExpression[] {
  return (segment.path ?? []).map(([lng, lat]) => [lat, lng]);
}

export function segmentsBounds(
  segments: LocationSegment[],
  extraPoints: Array<[number, number]> = [],
): LatLngBoundsExpression | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  const feed = (lat: number, lng: number) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  };
  for (const s of segments) {
    if (s.loc) feed(s.loc.coordinates[1], s.loc.coordinates[0]);
    for (const [lng, lat] of s.path ?? []) feed(lat, lng);
  }
  for (const [lat, lng] of extraPoints) feed(lat, lng);
  if (!Number.isFinite(minLat)) return null;
  const latPad = Math.max(0.005, (maxLat - minLat) * 0.1);
  const lngPad = Math.max(0.005, (maxLng - minLng) * 0.1);
  return [
    [minLat - latPad, minLng - lngPad],
    [maxLat + latPad, maxLng + lngPad],
  ];
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  const boundsKey = JSON.stringify(bounds);
  useEffect(() => {
    if (!bounds) return;
    let fitted = false;
    const tryFit = () => {
      const size = map.getSize();
      if (size.x > 0 && size.y > 0) {
        map.fitBounds(bounds, { animate: false });
        fitted = true;
      }
    };
    tryFit();
    if (fitted) return;
    // Container had no size yet (flex layout still settling) — fit once it does.
    const onResize = () => {
      if (!fitted) tryFit();
    };
    map.on("resize", onResize);
    return () => {
      map.off("resize", onResize);
    };
  }, [map, boundsKey]);
  return null;
}

/** Leaflet sizes itself once at mount; recover from late layout changes. */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const timeout = setTimeout(() => map.invalidateSize(), 50);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

export interface LocationMapProps {
  segments: LocationSegment[];
  className?: string;
  fitToSegments?: boolean;
  selectedSegmentId?: string | null;
  onSegmentClick?: (segment: LocationSegment) => void;
  children?: React.ReactNode;
  scrollWheelZoom?: boolean;
  extraBoundsPoints?: Array<[number, number]>;
}

export function LocationMap({
  segments,
  className,
  fitToSegments = true,
  selectedSegmentId,
  onSegmentClick,
  children,
  scrollWheelZoom = true,
  extraBoundsPoints,
}: LocationMapProps) {
  const tileUrl = useSettingsStore((state) => state.mapTileUrl);
  const bounds = useMemo(
    () => (fitToSegments
      ? segmentsBounds(segments, extraBoundsPoints ?? [])
      : null),
    [segments, fitToSegments, extraBoundsPoints],
  );

  const stays = segments.filter(
    (s) => (s.type === "stay" || s.type === "manual") && s.loc,
  );
  const moves = segments.filter((s) => s.type === "move" && s.path?.length);
  const gaps = segments.filter((s) => s.type === "gap" && s.path?.length);

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      className={className ?? "h-full w-full"}
      scrollWheelZoom={scrollWheelZoom}
      attributionControl
    >
      <TileLayer url={tileUrl} attribution={OSM_ATTRIBUTION} />
      <InvalidateOnResize />
      <FitBounds bounds={bounds} />

      {gaps.map((s) => (
        <Polyline
          key={String(s._id)}
          positions={segmentLatLngs(s)}
          pathOptions={{
            color: GAP_COLOR,
            weight: 2,
            dashArray: "6 6",
            opacity: 0.7,
          }}
          eventHandlers={onSegmentClick
            ? { click: () => onSegmentClick(s) }
            : undefined}
        >
          <Tooltip sticky>
            Assumed route · {formatDurationShort(segmentDurationMs(s))}{" "}
            without data
          </Tooltip>
        </Polyline>
      ))}

      {moves.map((s) => (
        <Polyline
          key={String(s._id)}
          positions={segmentLatLngs(s)}
          pathOptions={{ color: MOVE_COLOR, weight: 3, opacity: 0.8 }}
          eventHandlers={onSegmentClick
            ? { click: () => onSegmentClick(s) }
            : undefined}
        >
          <Tooltip sticky>
            {((s.distanceM ?? 0) / 1000).toFixed(1)} km ·{" "}
            {formatDurationShort(segmentDurationMs(s))}
          </Tooltip>
        </Polyline>
      ))}

      {stays.map((s) => {
        const [lng, lat] = s.loc!.coordinates;
        const selected = selectedSegmentId != null &&
          String(s._id) === selectedSegmentId;
        const color = s.type === "manual" ? MANUAL_COLOR : STAY_COLOR;
        return (
          <CircleMarker
            key={String(s._id)}
            center={[lat, lng]}
            radius={stayRadiusPx(s)}
            pathOptions={{
              color: selected ? "#f59e0b" : color,
              weight: selected ? 3 : 1.5,
              fillColor: color,
              fillOpacity: 0.7,
            }}
            eventHandlers={onSegmentClick
              ? { click: () => onSegmentClick(s) }
              : undefined}
          >
            <Tooltip>
              {formatPlace(s.place)} ·{" "}
              {formatDurationShort(segmentDurationMs(s))}
              {s.type === "manual" ? " · set manually" : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {children}
    </MapContainer>
  );
}
