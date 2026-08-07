import { useMemo, useState } from "react";
import { Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { ConversationMapGroup } from "@/types/location";

const CLUSTER_RADIUS_PX = 56;

interface Cluster {
  lat: number;
  lng: number;
  groups: ConversationMapGroup[];
  count: number;
}

function clusterIcon(count: number, merged: boolean): L.DivIcon {
  const size = count >= 100 ? 44 : count >= 10 ? 38 : 32;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:#8b5cf6${
        merged ? "" : "e6"
      };border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:12px;font-family:inherit;">💬 ${count}</div>`,
  });
}

interface ConversationClustersLayerProps {
  groups: ConversationMapGroup[];
  onSelectGroup: (group: ConversationMapGroup) => void;
}

/**
 * Conversation counts per place, merged into pixel-space clusters at low
 * zoom. Clicking a merged cluster zooms in; a single place opens its list.
 */
export function ConversationClustersLayer({
  groups,
  onSelectGroup,
}: ConversationClustersLayerProps) {
  const map = useMap();
  const [viewTick, setViewTick] = useState(0);
  useMapEvents({
    zoomend: () => setViewTick((t) => t + 1),
    moveend: () => setViewTick((t) => t + 1),
  });

  const clusters = useMemo<Cluster[]>(() => {
    void viewTick; // re-project on every zoom/pan
    const placed: Array<Cluster & { x: number; y: number }> = [];
    for (const group of groups) {
      const [lng, lat] = group.loc.coordinates;
      const pt = map.latLngToContainerPoint([lat, lng]);
      const hit = placed.find(
        (c) => Math.hypot(c.x - pt.x, c.y - pt.y) < CLUSTER_RADIUS_PX,
      );
      if (hit) {
        hit.groups.push(group);
        hit.count += group.conversationCount;
      } else {
        placed.push({
          x: pt.x,
          y: pt.y,
          lat,
          lng,
          groups: [group],
          count: group.conversationCount,
        });
      }
    }
    return placed;
  }, [groups, map, viewTick]);

  return (
    <>
      {clusters.map((cluster, i) => (
        <Marker
          key={`${cluster.lat}:${cluster.lng}:${i}`}
          position={[cluster.lat, cluster.lng]}
          icon={clusterIcon(cluster.count, cluster.groups.length > 1)}
          eventHandlers={{
            click: () => {
              if (cluster.groups.length > 1) {
                map.setView(
                  [cluster.lat, cluster.lng],
                  Math.min(map.getZoom() + 2, 16),
                );
              } else {
                onSelectGroup(cluster.groups[0]);
              }
            },
          }}
        />
      ))}
    </>
  );
}
