import { memo, useEffect, useRef } from "react";
import type { ScaleTime } from "d3-scale";
import type { ZoomTransform } from "d3-zoom";
import { useAudioPlayer } from "@/modules/audio/player";

interface PlayheadCursorProps {
  /** D3 time scale */
  scale: ScaleTime<number, number>;
  /** D3 zoom transform */
  transform: ZoomTransform;
  /** Width of the container in pixels */
  width: number;
}

/**
 * PlayheadCursor - A vertical line that spans all timeline tracks
 * to show the current playhead position. Uses direct DOM manipulation
 * to update position without triggering React re-renders during playback.
 */
export const PlayheadCursor = memo(function PlayheadCursor({
  scale,
  transform,
  width,
}: PlayheadCursorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SVGSVGElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);

  const scaleRef = useRef(scale);
  const transformRef = useRef(transform);
  const widthRef = useRef(width);
  scaleRef.current = scale;
  transformRef.current = transform;
  widthRef.current = width;

  // Subscribe to audio player state changes and update DOM directly
  useEffect(() => {
    const update = () => {
      const { currentDate, isPlaying } = useAudioPlayer.getState();
      const container = containerRef.current;
      const line = lineRef.current;
      const handle = handleRef.current;
      const pulse = pulseRef.current;
      if (!container || !line || !handle) return;

      if (!currentDate) {
        container.style.display = "none";
        return;
      }

      const pos = transformRef.current.applyX(scaleRef.current(currentDate));

      if (pos < 0 || pos > widthRef.current) {
        container.style.display = "none";
        return;
      }

      container.style.display = "";
      line.style.left = `${pos}px`;
      line.style.boxShadow = isPlaying
        ? "0 0 8px 2px hsl(var(--primary) / 0.4)"
        : "0 0 4px 1px hsl(var(--primary) / 0.2)";
      handle.style.left = `${pos}px`;
      if (pulse) {
        pulse.style.left = `${pos}px`;
        pulse.style.display = isPlaying ? "" : "none";
      }
    };

    // Run once immediately
    update();

    // Subscribe to Zustand store — fires on every state change
    const unsub = useAudioPlayer.subscribe(update);
    return unsub;
  }, []);

  // Also update when scale/transform/width change (zoom/pan)
  useEffect(() => {
    const { currentDate } = useAudioPlayer.getState();
    if (!currentDate) return;

    const container = containerRef.current;
    const line = lineRef.current;
    const handle = handleRef.current;
    const pulse = pulseRef.current;
    if (!container || !line || !handle) return;

    const pos = transform.applyX(scale(currentDate));

    if (pos < 0 || pos > width) {
      container.style.display = "none";
      return;
    }

    container.style.display = "";
    line.style.left = `${pos}px`;
    handle.style.left = `${pos}px`;
    if (pulse) pulse.style.left = `${pos}px`;
  }, [scale, transform, width]);

  const handleSize = 10;

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-20">
      {/* Vertical line spanning full height */}
      <div
        ref={lineRef}
        className="absolute top-0 bottom-0"
        style={{
          width: 2,
          transform: "translateX(-50%)",
          background: "hsl(var(--primary))",
        }}
      />

      {/* Small triangle handle at top */}
      <svg
        ref={handleRef}
        className="absolute"
        width={handleSize * 2}
        height={handleSize}
        viewBox={`0 0 ${handleSize * 2} ${handleSize}`}
        style={{
          top: 0,
          transform: "translateX(-50%)",
        }}
      >
        <polygon
          points={`0,0 ${handleSize * 2},0 ${handleSize},${handleSize}`}
          fill="hsl(var(--primary))"
        />
      </svg>

      {/* Playing indicator pulse at handle */}
      <div
        ref={pulseRef}
        className="absolute rounded-full animate-ping"
        style={{
          top: handleSize / 2,
          width: 6,
          height: 6,
          transform: "translate(-50%, -50%)",
          background: "hsl(var(--primary))",
          opacity: 0.5,
          display: "none",
        }}
      />
    </div>
  );
});

export default PlayheadCursor;
