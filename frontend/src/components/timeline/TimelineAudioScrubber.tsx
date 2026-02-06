import { memo, useCallback, useMemo, useRef } from "react";
import type { ZoomTransform } from "d3-zoom";
import type { ScaleTime } from "d3-scale";
import { useTimelineRange } from "@/stores/timelineRange";
import { useHistogramItems } from "@/modules/histogram/useHistogramItems";
import { useAudioPlayer } from "@/modules/audio/player";
import { cn } from "@/lib/utils";

interface TimelineAudioScrubberProps {
  scale: ScaleTime<number, number>;
  transform: ZoomTransform;
  width: number;
  height?: number;
  className?: string;
}

/**
 * TimelineAudioScrubber - Simple centered waveform with click-to-seek.
 * Uses the same histogram audio_chunks count data as AudioChunksTrack.
 */
export const TimelineAudioScrubber = memo(function TimelineAudioScrubber({
  scale,
  transform,
  width,
  height = 48,
  className,
}: TimelineAudioScrubberProps) {
  const containerRef = useRef<SVGSVGElement>(null);
  const { start, end } = useTimelineRange();
  const { items } = useHistogramItems(start, end);
  const { currentDate, resetDate, setIsPlaying, isPlaying } = useAudioPlayer();

  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform]
  );

  const playheadX = useMemo(() => {
    if (!currentDate) return null;
    return transform.applyX(scale(currentDate));
  }, [currentDate, scale, transform]);

  // Simple bar calculation with viewport culling
  const { bars, maxCount } = useMemo(() => {
    let max = 1;
    const barData: Array<{ id: string; x: number; w: number; count: number }> = [];
    for (const item of items) {
      const x = rescaledScale(item.start);
      const w = Math.max(rescaledScale(item.end) - rescaledScale(item.start), 1);
      // Skip bars entirely outside visible area
      if (x + w < 0 || x > width) continue;
      const count = item.totals.audio_chunks?.count ?? 0;
      if (count > max) max = count;
      barData.push({ id: item.id, x, w, count });
    }
    return { bars: barData, maxCount: max };
  }, [items, rescaledScale, width]);

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

  const midY = height / 2;

  return (
    <svg
      ref={containerRef}
      className={cn("w-full cursor-pointer select-none", className)}
      width={width}
      height={height}
      onClick={handleClick}
    >
      {/* Background */}
      <rect x={0} y={0} width={width} height={height} fill="hsl(var(--muted))" rx={4} opacity={0.3} />

      {/* Center line */}
      <line x1={0} y1={midY} x2={width} y2={midY} stroke="currentColor" strokeWidth={0.5} opacity={0.15} />

      {/* Waveform bars (centered/mirrored) */}
      {bars.map((bar) => {
        if (bar.count === 0) return null;
        const ratio = bar.count / maxCount;
        const barH = Math.max(4, ratio * (height - 4));
        const y = midY - barH / 2;
        const beforePlayhead = playheadX !== null && bar.x + bar.w <= playheadX;

        return (
          <rect
            key={bar.id}
            x={bar.x}
            y={y}
            width={Math.max(bar.w - 0.5, 0.5)}
            height={barH}
            rx={0.5}
            fill={beforePlayhead ? "hsl(var(--primary))" : "hsl(199, 89%, 48%)"}
            opacity={beforePlayhead ? 0.8 : 0.6}
          />
        );
      })}

      {/* Playhead line */}
      {playheadX !== null && playheadX >= 0 && playheadX <= width && (
        <>
          <line
            x1={playheadX}
            y1={0}
            x2={playheadX}
            y2={height}
            stroke="hsl(var(--primary))"
            strokeWidth={2}
          />
          {/* Small triangle at top */}
          <polygon
            points={`${playheadX - 5},0 ${playheadX + 5},0 ${playheadX},6`}
            fill="hsl(var(--primary))"
          />
          {isPlaying && (
            <circle
              cx={playheadX}
              cy={3}
              r={2}
              fill="hsl(var(--primary))"
              className="animate-ping"
              opacity={0.5}
            />
          )}
        </>
      )}
    </svg>
  );
});

export default TimelineAudioScrubber;
