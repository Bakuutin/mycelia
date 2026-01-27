import React, { memo, useMemo } from "react";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";
import type { HistogramItem } from "@/modules/histogram/useHistogramCache";
import { BaseTrack } from "./BaseTrack";

// Config for each histogram track type
export const TRANSCRIPTIONS_CONFIG: TrackConfig = {
  id: "transcriptions",
  label: "Transcriptions",
  description: "Transcription density",
  defaultVisible: true,
  defaultHeight: 40,
  color: "hsl(262, 83%, 58%)", // Purple
};

export const AUDIO_CHUNKS_CONFIG: TrackConfig = {
  id: "audio-chunks",
  label: "Audio",
  description: "Audio chunk density",
  defaultVisible: true,
  defaultHeight: 40,
  color: "hsl(199, 89%, 48%)", // Cyan
};

export const DIARIZATIONS_CONFIG: TrackConfig = {
  id: "diarizations",
  label: "Diarizations",
  description: "Speaker diarization data",
  defaultVisible: true,
  defaultHeight: 40,
  color: "hsl(25, 95%, 53%)", // Orange
};

type DataKey = "audio_chunks" | "transcriptions" | "diarizations";

interface HistogramTrackProps extends TrackRenderProps {
  config: TrackConfig;
  dataKey: DataKey;
}

const HistogramTrackInner = memo(function HistogramTrackInner({
  scale,
  transform,
  width,
  height,
  items,
  config,
  dataKey,
}: HistogramTrackProps) {
  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform]
  );

  const { bars, maxCount } = useMemo(() => {
    let max = 1;
    const barData = items.map((item) => {
      const count = item.totals[dataKey]?.count ?? 0;
      if (count > max) max = count;
      return {
        id: item.id,
        x: rescaledScale(item.start),
        width: Math.max(rescaledScale(item.end) - rescaledScale(item.start), 1),
        count,
        stale: item.stale,
      };
    });
    return { bars: barData, maxCount: max };
  }, [items, rescaledScale, dataKey]);

  return (
    <BaseTrack
      config={config}
      scale={scale}
      transform={transform}
      width={width}
      height={height}
      items={items}
    >
      <g>
        {bars.map((bar) => {
          const barHeight = maxCount > 0 ? (bar.count / maxCount) * height : 0;
          return (
            <rect
              key={bar.id}
              x={bar.x}
              y={height - barHeight}
              width={bar.width}
              height={barHeight}
              fill={bar.stale ? "rgb(255, 182, 193)" : config.color}
              opacity={0.8}
            />
          );
        })}
      </g>
    </BaseTrack>
  );
});

// Export specialized track components
export const TranscriptionsTrack = memo(function TranscriptionsTrack(
  props: TrackRenderProps
) {
  return (
    <HistogramTrackInner
      {...props}
      config={TRANSCRIPTIONS_CONFIG}
      dataKey="transcriptions"
    />
  );
});

export const AudioChunksTrack = memo(function AudioChunksTrack(
  props: TrackRenderProps
) {
  return (
    <HistogramTrackInner
      {...props}
      config={AUDIO_CHUNKS_CONFIG}
      dataKey="audio_chunks"
    />
  );
});

export const DiarizationsTrack = memo(function DiarizationsTrack(
  props: TrackRenderProps
) {
  return (
    <HistogramTrackInner
      {...props}
      config={DIARIZATIONS_CONFIG}
      dataKey="diarizations"
    />
  );
});
