import React, { useMemo, useCallback, memo } from "react";
import { useTimelineRange } from "@/stores/timelineRange";
import { useHistogramItems } from "@/modules/histogram/useHistogramItems";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import { useAudioPlayer } from "@/modules/audio/player";
import { TimeLayer } from "@/modules/time";
import { ObjectsLayer } from "@/modules/objects";
import { ProcessingLayer } from "@/modules/histogram/ProcessingLayer";
import { PlayheadCursor } from "./PlayheadCursor";
import { TimeGridLines } from "./TimeGridLines";
import { AudioSourcesTrack } from "./AudioSourcesTrack";
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
  "audio-sources": { label: "Audio Sources", color: "#0ea5e9" },
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
  const { resetDate, setIsPlaying } = useAudioPlayer();

  // Use pre-created layer components
  const TimeLayerComponent = TIME_LAYER.component;
  const ProcessingLayerComponent = PROCESSING_LAYER.component;
  const ObjectsLayerComponent = OBJECTS_LAYER.component;

  const visibleHistogramTracks = useMemo(
    () => HISTOGRAM_TRACK_IDS.filter((id) => visibleTracks.includes(id)),
    [visibleTracks]
  );

  const rescaledScale = useMemo(
    () => transform.rescaleX(timeScale),
    [timeScale, transform]
  );

  // Click anywhere on the timeline to set playhead and start playing
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't seek if clicking on an object, button, selection handle, or track header
      const target = e.target as HTMLElement;
      if (
        target.closest("[data-no-seek]") ||
        target.closest("button") ||
        target.closest("a") ||
        target.closest(".track-header")
      ) {
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickedDate = rescaledScale.invert(x);
      resetDate(clickedDate);
      setIsPlaying(true);
    },
    [rescaledScale, resetDate, setIsPlaying]
  );

  const showObjects = visibleTracks.includes("objects");

  return (
    <div
      ref={containerRef}
      className={`relative overflow-visible ${className || ""}`}
      style={{ cursor: "crosshair" }}
      onClick={handleTimelineClick}
    >
      {/* Time grid lines overlay - spans all tracks */}
      <TimeGridLines
        scale={timeScale}
        transform={transform}
        width={width}
      />

      {/* Playhead cursor overlay - spans all tracks */}
      <PlayheadCursor
        scale={timeScale}
        transform={transform}
        width={width}
      />

      <div className="flex flex-col gap-0.5 overflow-visible">
        {/* Processing overlay layer */}
        <ProcessingLayerComponent
          scale={timeScale}
          transform={transform}
          width={width}
        />

        {/* Time axis layer (always visible) with header */}
        <div className="relative border-b border-border/30 overflow-visible pt-7">
          <TrackHeader
            config={{
              id: "time-selection" as any,
              label: "Time / Selection",
              defaultVisible: true,
              defaultHeight: 40,
              color: "#6b7280",
            }}
          />
          <TimeLayerComponent
            scale={timeScale}
            transform={transform}
            width={width}
          />
        </div>

        {/* Audio sources track (only shows when multiple sources exist and visible) */}
        {visibleTracks.includes("audio-sources") && (
          <AudioSourcesTrack
            scale={timeScale}
            transform={transform}
            width={width}
          />
        )}

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

        {/* Objects layer — category headers inside SVG serve as labels */}
        {showObjects && (
          <div className="relative border-b border-border/30">
            <ObjectsLayerComponent
              scale={timeScale}
              transform={transform}
              width={width}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default MultiTrackTimeline;
