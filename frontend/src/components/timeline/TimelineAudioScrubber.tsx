import { memo, useCallback, useEffect, useMemo, useRef } from "react";
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
 * Uses direct DOM manipulation for the playhead to avoid re-renders at ~20fps.
 */
export const TimelineAudioScrubber = memo(function TimelineAudioScrubber({
  scale,
  transform,
  width,
  height = 48,
  className,
}: TimelineAudioScrubberProps) {
  const containerRef = useRef<SVGSVGElement>(null);
  const playheadGroupRef = useRef<SVGGElement>(null);

  const { start, end } = useTimelineRange();
  const { items } = useHistogramItems(start, end);
  // Only subscribe to actions, NOT currentDate
  const resetDate = useAudioPlayer((s) => s.resetDate);
  const setIsPlaying = useAudioPlayer((s) => s.setIsPlaying);

  const scaleRef = useRef(scale);
  const transformRef = useRef(transform);
  const widthRef = useRef(width);
  scaleRef.current = scale;
  transformRef.current = transform;
  widthRef.current = width;

  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform]
  );

  // Simple bar calculation with viewport culling (stable — doesn't depend on currentDate)
  const { bars, maxCount } = useMemo(() => {
    let max = 1;
    const barData: Array<{ id: string; x: number; w: number; count: number }> = [];
    for (const item of items) {
      const x = rescaledScale(item.start);
      const w = Math.max(rescaledScale(item.end) - rescaledScale(item.start), 1);
      if (x + w < 0 || x > width) continue;
      const count = item.totals.audio_chunks?.count ?? 0;
      if (count > max) max = count;
      barData.push({ id: item.id, x, w, count });
    }
    return { bars: barData, maxCount: max };
  }, [items, rescaledScale, width]);

  // Update playhead position via DOM — no React re-renders
  useEffect(() => {
    const updatePlayhead = () => {
      const group = playheadGroupRef.current;
      if (!group) return;
      const { currentDate, isPlaying } = useAudioPlayer.getState();
      if (!currentDate) {
        group.style.display = "none";
        return;
      }
      const x = transformRef.current.applyX(scaleRef.current(currentDate));
      if (x < 0 || x > widthRef.current) {
        group.style.display = "none";
        return;
      }
      group.style.display = "";
      group.setAttribute("transform", `translate(${x}, 0)`);
      // Update ping visibility
      const ping = group.querySelector(".scrubber-ping");
      if (ping) (ping as SVGElement).style.display = isPlaying ? "" : "none";
    };
    updatePlayhead();
    const unsub = useAudioPlayer.subscribe(updatePlayhead);
    return unsub;
  }, []);

  // Also update when scale/transform/width change (zoom/pan)
  useEffect(() => {
    const group = playheadGroupRef.current;
    if (!group) return;
    const { currentDate } = useAudioPlayer.getState();
    if (!currentDate) { group.style.display = "none"; return; }
    const x = transform.applyX(scale(currentDate));
    if (x < 0 || x > width) { group.style.display = "none"; return; }
    group.style.display = "";
    group.setAttribute("transform", `translate(${x}, 0)`);
  }, [scale, transform, width]);

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const rescaled = transformRef.current.rescaleX(scaleRef.current);
      const clickedDate = rescaled.invert(x);
      resetDate(clickedDate);
      setIsPlaying(true);
    },
    [resetDate, setIsPlaying]
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

      {/* Waveform bars (centered/mirrored) — stable, no currentDate dependency */}
      {bars.map((bar) => {
        if (bar.count === 0) return null;
        const ratio = bar.count / maxCount;
        const barH = Math.max(4, ratio * (height - 4));
        const y = midY - barH / 2;

        return (
          <rect
            key={bar.id}
            x={bar.x}
            y={y}
            width={Math.max(bar.w - 0.5, 0.5)}
            height={barH}
            rx={0.5}
            fill="hsl(199, 89%, 48%)"
            opacity={0.6}
          />
        );
      })}

      {/* Playhead group — positioned via DOM manipulation */}
      <g ref={playheadGroupRef} style={{ display: "none" }}>
        <line
          x1={0} y1={0} x2={0} y2={height}
          stroke="hsl(var(--primary))"
          strokeWidth={2}
        />
        <polygon
          points="-5,0 5,0 0,6"
          fill="hsl(var(--primary))"
        />
        <circle
          className="scrubber-ping animate-ping"
          cx={0} cy={3} r={2}
          fill="hsl(var(--primary))"
          opacity={0.5}
          style={{ display: "none" }}
        />
      </g>
    </svg>
  );
});

export default TimelineAudioScrubber;
