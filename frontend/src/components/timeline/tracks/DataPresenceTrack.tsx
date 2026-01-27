import React, { memo, useMemo } from "react";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";
import { BaseTrack } from "./BaseTrack";

export const DATA_PRESENCE_CONFIG: TrackConfig = {
  id: "data-presence",
  label: "Has Data",
  description: "Shows where data exists",
  defaultVisible: true,
  defaultHeight: 20,
  color: "hsl(142, 71%, 45%)", // Green
};

export const DataPresenceTrack = memo(function DataPresenceTrack({
  scale,
  transform,
  width,
  height,
  items,
}: TrackRenderProps) {
  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform]
  );

  const segments = useMemo(() => {
    return items
      .filter((item) => {
        const audioCount = item.totals.audio_chunks?.count ?? 0;
        const transcriptCount = item.totals.transcriptions?.count ?? 0;
        return audioCount > 0 || transcriptCount > 0;
      })
      .map((item) => ({
        id: item.id,
        x: rescaledScale(item.start),
        width: Math.max(rescaledScale(item.end) - rescaledScale(item.start), 2),
      }));
  }, [items, rescaledScale]);

  return (
    <BaseTrack
      config={DATA_PRESENCE_CONFIG}
      scale={scale}
      transform={transform}
      width={width}
      height={height}
      items={items}
    >
      {/* Background */}
      <rect x={0} y={0} width={width} height={height} fill="#e5e7eb" className="dark:fill-slate-800" />
      {/* Data segments */}
      <g>
        {segments.map((seg) => (
          <rect
            key={seg.id}
            x={seg.x}
            y={2}
            width={seg.width}
            height={height - 4}
            fill={DATA_PRESENCE_CONFIG.color}
            rx={2}
          />
        ))}
      </g>
    </BaseTrack>
  );
});
