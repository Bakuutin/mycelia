import React, { memo, useMemo } from "react";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";
import type { HistogramItem } from "@/modules/histogram/useHistogramCache";
import { BaseTrack } from "./BaseTrack";
import { useQuery } from "@tanstack/react-query";
import { callResource } from "@/lib/api";
import { useNavigate } from "react-router-dom";

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
  label: "Speaker identity",
  description: "Sky / other / uncertain voice intervals",
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
  const navigate = useNavigate();
  const rescaledScale = useMemo(() => props.transform.rescaleX(props.scale), [props.transform, props.scale]);
  const [start, end] = rescaledScale.domain() as [Date, Date];
  const { data } = useQuery({
    queryKey: ["speaker-track", start.getTime(), end.getTime()],
    queryFn: () => callResource("speaker-segments", { action: "list", start, end, limit: 5000 }) as Promise<{ segments: any[] }>,
  });
  const segments = data?.segments ?? [];
  const farZoom = (end.getTime() - start.getTime()) / Math.max(props.width, 1) > 60_000;
  const color = (state?: string) => state === "matched" ? "#22c55e" : state === "rejected" ? "#64748b" : "#f59e0b";
  const marks = useMemo(() => {
    if (!farZoom) return segments.map((segment) => ({
      id: String(segment._id),
      x: rescaledScale(new Date(segment.start)),
      width: Math.max(2, rescaledScale(new Date(segment.end)) - rescaledScale(new Date(segment.start))),
      state: segment.speakerIdentity?.state,
      segment,
    }));
    const buckets = new Map<number, { counts: Record<string, number>; segment: any }>();
    for (const segment of segments) {
      const x = Math.max(0, Math.floor(rescaledScale(new Date(segment.start))));
      const bucket = buckets.get(x) ?? { counts: {}, segment };
      const state = segment.speakerIdentity?.state ?? "uncertain";
      bucket.counts[state] = (bucket.counts[state] ?? 0) + 1;
      buckets.set(x, bucket);
    }
    return [...buckets.entries()].map(([x, bucket]) => ({
      id: `bucket-${x}`,
      x,
      width: 2,
      state: Object.entries(bucket.counts).sort((a, b) => b[1] - a[1])[0]?.[0],
      segment: bucket.segment,
    }));
  }, [farZoom, segments, rescaledScale]);
  return (
    <BaseTrack {...props} config={DIARIZATIONS_CONFIG}>
      <g>
        {marks.map((mark) => (
          <rect key={mark.id} x={mark.x} y={4} width={mark.width} height={Math.max(4, props.height - 8)} fill={color(mark.state)} opacity={0.82} className="cursor-pointer" onClick={() => navigate(`/diarizations/${String(mark.segment._id)}`)}>
            <title>{mark.state === "matched" ? "Sky" : mark.state === "rejected" ? "not Sky" : "uncertain"}</title>
          </rect>
        ))}
      </g>
    </BaseTrack>
  );
});
