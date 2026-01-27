import React, { useMemo, memo } from "react";
import { useTimelineRange } from "@/stores/timelineRange";
import { useHistogramItems } from "@/modules/histogram/useHistogramItems";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import { TimeLayer } from "@/modules/time";
import { ObjectsLayer } from "@/modules/objects";
import { ProcessingLayer } from "@/modules/histogram/ProcessingLayer";
import { AudioLayer } from "@/modules/audio/index";
import {
  VoiceDetectionTrack,
  DataPresenceTrack,
  TranscriptionsTrack,
  AudioChunksTrack,
  DiarizationsTrack,
  VOICE_DETECTION_CONFIG,
  DATA_PRESENCE_CONFIG,
  TRANSCRIPTIONS_CONFIG,
  AUDIO_CHUNKS_CONFIG,
  DIARIZATIONS_CONFIG,
} from "./tracks";
import { TrackHeader } from "./tracks/TrackHeader";
import type { TrackId } from "@/types/tracks";
import type { useTimeline } from "@/hooks/useTimeline";

// Pre-create layer instances (these are stable references)
const TIME_LAYER = TimeLayer();
const PROCESSING_LAYER = ProcessingLayer();
const OBJECTS_LAYER = ObjectsLayer();
const AUDIO_LAYER = AudioLayer();

interface MultiTrackTimelineProps {
  timeline: ReturnType<typeof useTimeline>;
  className?: string;
}

// Map track IDs to components
const TRACK_COMPONENTS: Record<TrackId, React.ComponentType<any>> = {
  "voice-detection": VoiceDetectionTrack,
  "data-presence": DataPresenceTrack,
  "transcriptions": TranscriptionsTrack,
  "audio-chunks": AudioChunksTrack,
  "diarizations": DiarizationsTrack,
  "objects": () => null, // Handled separately
};

const TRACK_CONFIGS: Record<TrackId, { label: string; color: string }> = {
  "voice-detection": VOICE_DETECTION_CONFIG,
  "data-presence": DATA_PRESENCE_CONFIG,
  "transcriptions": TRANSCRIPTIONS_CONFIG,
  "audio-chunks": AUDIO_CHUNKS_CONFIG,
  "diarizations": DIARIZATIONS_CONFIG,
  "objects": { label: "Objects", color: "#6b7280" },
};

// Stable list of histogram track IDs
const HISTOGRAM_TRACK_IDS: TrackId[] = [
  "voice-detection",
  "data-presence",
  "transcriptions",
  "audio-chunks",
  "diarizations",
];

export const MultiTrackTimeline = memo(function MultiTrackTimeline({
  timeline,
  className,
}: MultiTrackTimelineProps) {
  const { containerRef, width, timeScale, transform } = timeline;

  const { start, end } = useTimelineRange();
  const { items } = useHistogramItems(start, end);
  const { visibleTracks, trackHeights } = useTrackVisibilityStore();

  // Use pre-created layer components
  const TimeLayerComponent = TIME_LAYER.component;
  const ProcessingLayerComponent = PROCESSING_LAYER.component;
  const ObjectsLayerComponent = OBJECTS_LAYER.component;
  const AudioLayerComponent = AUDIO_LAYER.component;

  const visibleHistogramTracks = useMemo(
    () => HISTOGRAM_TRACK_IDS.filter((id) => visibleTracks.includes(id)),
    [visibleTracks]
  );

  const showObjects = visibleTracks.includes("objects");

  return (
    <div ref={containerRef} className={`relative ${className || ""}`}>
      <div className="flex flex-col gap-0.5">
        {/* Processing overlay layer */}
        <ProcessingLayerComponent
          scale={timeScale}
          transform={transform}
          width={width}
        />

        {/* Time axis layer (always visible) */}
        <TimeLayerComponent
          scale={timeScale}
          transform={transform}
          width={width}
        />

        {/* Data tracks */}
        {visibleHistogramTracks.map((trackId) => {
          const TrackComponent = TRACK_COMPONENTS[trackId];
          const config = TRACK_CONFIGS[trackId];
          const height = trackHeights[trackId] ?? 40;

          if (!TrackComponent) return null;

          return (
            <div key={trackId} className="relative border-b border-border/30 last:border-b-0">
              <TrackHeader config={{ ...config, id: trackId, defaultVisible: true, defaultHeight: height }} />
              <TrackComponent
                scale={timeScale}
                transform={transform}
                width={width}
                height={height}
                items={items}
              />
            </div>
          );
        })}

        {/* Objects layer */}
        {showObjects && (
          <div className="relative border-b border-border/30">
            <TrackHeader
              config={{
                id: "objects",
                label: "Objects",
                defaultVisible: true,
                defaultHeight: 120,
                color: "#6b7280",
              }}
            />
            <ObjectsLayerComponent
              scale={timeScale}
              transform={transform}
              width={width}
            />
          </div>
        )}

        {/* Audio layer (always visible at bottom) */}
        <AudioLayerComponent
          scale={timeScale}
          transform={transform}
          width={width}
        />
      </div>
    </div>
  );
});

export default MultiTrackTimeline;
