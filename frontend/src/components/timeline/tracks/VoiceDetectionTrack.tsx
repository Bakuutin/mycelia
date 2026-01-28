import React, { memo, useMemo } from "react";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";
import { BaseTrack } from "./BaseTrack";

export const VOICE_DETECTION_CONFIG: TrackConfig = {
  id: "voice-detection",
  label: "Voice Detection",
  description: "Shows speech probability intensity",
  defaultVisible: true,
  defaultHeight: 32,
  color: "hsl(221, 83%, 53%)", // Blue
};

export const VoiceDetectionTrack = memo(function VoiceDetectionTrack({
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

  const bars = useMemo(() => {
    return items.map((item) => {
      const startX = rescaledScale(item.start);
      const endX = rescaledScale(item.end);
      const barWidth = Math.max(endX - startX, 1);

      const speechProb = item.totals.audio_chunks?.speech_probability_avg ?? 0;
      const opacity = 0.15 + speechProb * 0.85;
      const hasSpeech = (item.totals.audio_chunks?.has_speech ?? 0) > 0;

      return {
        id: item.id,
        x: startX,
        width: barWidth,
        opacity,
        hasSpeech,
      };
    });
  }, [items, rescaledScale]);

  return (
    <BaseTrack
      config={VOICE_DETECTION_CONFIG}
      scale={scale}
      transform={transform}
      width={width}
      height={height}
      items={items}
    >
      <g>
        {bars.map((bar) => (
          <rect
            key={bar.id}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill={bar.hasSpeech ? VOICE_DETECTION_CONFIG.color : "#94a3b8"}
            opacity={bar.opacity}
          />
        ))}
      </g>
    </BaseTrack>
  );
});
