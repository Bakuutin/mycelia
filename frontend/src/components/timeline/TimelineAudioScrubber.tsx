import { memo, useCallback, useMemo, useRef } from "react";
import type { ZoomTransform } from "d3-zoom";
import type { ScaleTime } from "d3-scale";
import { useTimelineRange } from "@/stores/timelineRange";
import { useHistogramItems } from "@/modules/histogram/useHistogramItems";
import { useAudioPlayer } from "@/modules/audio/player";
import { PlayheadHandle } from "./PlayheadHandle";
import { cn } from "@/lib/utils";

interface TimelineAudioScrubberProps {
  /** D3 time scale */
  scale: ScaleTime<number, number>;
  /** D3 zoom transform */
  transform: ZoomTransform;
  /** Width of the container in pixels */
  width: number;
  /** Height of the scrubber in pixels */
  height?: number;
  /** Whether to show full waveform or just around playhead */
  showFullWaveform?: boolean;
  /** Minutes around playhead to show when not in full mode */
  playheadWindowMinutes?: number;
  className?: string;
}

/**
 * TimelineAudioScrubber - An integrated audio scrubber with waveform visualization.
 * Uses histogram audio_chunks data to render a waveform-like display.
 * Features:
 * - Waveform visualization based on speech probability
 * - Draggable playhead handle
 * - Click-to-seek anywhere on the waveform
 */
export const TimelineAudioScrubber = memo(function TimelineAudioScrubber({
  scale,
  transform,
  width,
  height = 48,
  showFullWaveform = true,
  playheadWindowMinutes = 5,
  className,
}: TimelineAudioScrubberProps) {
  const containerRef = useRef<SVGSVGElement>(null);
  const { start, end } = useTimelineRange();
  const { items } = useHistogramItems(start, end);
  const { currentDate, resetDate, setIsPlaying, isPlaying } = useAudioPlayer();

  // Create rescaled scale for current transform
  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform]
  );

  // Calculate playhead position
  const playheadPosition = useMemo(() => {
    if (!currentDate) return null;
    return transform.applyX(scale(currentDate));
  }, [currentDate, scale, transform]);

  // Calculate waveform bars from histogram data
  const bars = useMemo(() => {
    const waveformHeight = height - 20; // Leave space for handle
    
    // Find max speech probability for normalization
    let maxProb = 0.1; // Minimum to avoid division by zero
    for (const item of items) {
      const prob = item.totals.audio_chunks?.speech_probability_avg ?? 0;
      if (prob > maxProb) maxProb = prob;
    }

    // If in playhead mode, filter to window around playhead
    let filteredItems = items;
    if (!showFullWaveform && currentDate) {
      const windowMs = playheadWindowMinutes * 60 * 1000;
      const windowStart = currentDate.getTime() - windowMs;
      const windowEnd = currentDate.getTime() + windowMs;
      filteredItems = items.filter((item) => {
        const itemTime = item.start.getTime();
        return itemTime >= windowStart && itemTime <= windowEnd;
      });
    }

    return filteredItems.map((item) => {
      const x = rescaledScale(item.start);
      const itemEnd = item.end;
      const barWidth = Math.max(rescaledScale(itemEnd) - x, 1);
      
      // Use speech probability for height, or has_speech count as fallback
      const hasSpeech = item.totals.audio_chunks?.has_speech ?? 0;
      const speechProb = item.totals.audio_chunks?.speech_probability_avg ?? 0;
      const count = item.totals.audio_chunks?.count ?? 0;
      
      // Normalize intensity: combine speech probability and presence
      let intensity = speechProb / maxProb;
      if (count > 0 && hasSpeech > 0) {
        intensity = Math.max(intensity, 0.3); // Minimum height if there's speech
      }
      
      const barHeight = Math.max(2, intensity * waveformHeight * 0.8);
      
      return {
        id: item.id,
        x,
        width: barWidth,
        height: barHeight,
        intensity,
        hasAudio: count > 0,
        hasSpeech: hasSpeech > 0,
      };
    });
  }, [items, rescaledScale, height, showFullWaveform, currentDate, playheadWindowMinutes]);

  // Handle click to seek
  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickedDate = rescaledScale.invert(x);
      resetDate(clickedDate);
      setIsPlaying(true);
    },
    [rescaledScale, resetDate, setIsPlaying]
  );

  // Handle right-click to stop
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsPlaying(false);
      resetDate(null);
    },
    [setIsPlaying, resetDate]
  );

  // Handle playhead drag
  const handlePlayheadDrag = useCallback(
    (x: number) => {
      const draggedDate = rescaledScale.invert(x);
      resetDate(draggedDate);
    },
    [rescaledScale, resetDate]
  );

  const handlePlayheadDragStart = useCallback(() => {
    setIsPlaying(false);
  }, [setIsPlaying]);

  const handlePlayheadDragEnd = useCallback(() => {
    setIsPlaying(true);
  }, [setIsPlaying]);

  const waveformY = 20; // Start below handle area
  const waveformHeight = height - waveformY;

  return (
    <svg
      ref={containerRef}
      className={cn(
        "w-full cursor-pointer select-none",
        "bg-muted/30 rounded-md",
        className
      )}
      width={width}
      height={height}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Background track */}
      <rect
        x={0}
        y={waveformY}
        width={width}
        height={waveformHeight}
        fill="hsl(var(--muted) / 0.5)"
        rx={4}
      />

      {/* Waveform bars */}
      <g>
        {bars.map((bar) => {
          const y = waveformY + (waveformHeight - bar.height) / 2;
          const isBeforePlayhead = playheadPosition !== null && bar.x < playheadPosition;
          
          return (
            <rect
              key={bar.id}
              x={bar.x}
              y={y}
              width={Math.max(bar.width - 1, 1)}
              height={bar.height}
              rx={1}
              fill={
                isBeforePlayhead
                  ? "hsl(var(--primary) / 0.7)"
                  : bar.hasSpeech
                  ? "hsl(var(--muted-foreground) / 0.5)"
                  : "hsl(var(--muted-foreground) / 0.2)"
              }
              className="transition-colors duration-100"
            />
          );
        })}
      </g>

      {/* Playhead handle */}
      {playheadPosition !== null && playheadPosition >= 0 && playheadPosition <= width && (
        <PlayheadHandle
          position={playheadPosition}
          height={height}
          isPlaying={isPlaying}
          containerRef={containerRef as React.RefObject<HTMLElement>}
          onDragStart={handlePlayheadDragStart}
          onDrag={handlePlayheadDrag}
          onDragEnd={handlePlayheadDragEnd}
        />
      )}

      {/* Time markers at edges (optional visual enhancement) */}
      <line
        x1={0}
        y1={waveformY}
        x2={0}
        y2={height}
        stroke="hsl(var(--border))"
        strokeWidth={1}
        opacity={0.5}
      />
      <line
        x1={width}
        y1={waveformY}
        x2={width}
        y2={height}
        stroke="hsl(var(--border))"
        strokeWidth={1}
        opacity={0.5}
      />
    </svg>
  );
});

export default TimelineAudioScrubber;
