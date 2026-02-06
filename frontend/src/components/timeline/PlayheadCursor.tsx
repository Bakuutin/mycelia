import { memo, useMemo } from "react";
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
 * to show the current playhead position. This is an overlay component
 * that renders on top of all tracks (pointer-events-none so clicks pass through).
 */
export const PlayheadCursor = memo(function PlayheadCursor({
  scale,
  transform,
  width,
}: PlayheadCursorProps) {
  const { currentDate, isPlaying } = useAudioPlayer();

  // Calculate playhead position in pixels
  const position = useMemo(() => {
    if (!currentDate) return null;
    return transform.applyX(scale(currentDate));
  }, [currentDate, scale, transform]);

  // Don't render if no position or out of bounds
  if (position === null || position < 0 || position > width) {
    return null;
  }

  const handleSize = 10;

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* Vertical line spanning full height */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: position,
          width: 2,
          transform: "translateX(-50%)",
          background: "hsl(var(--primary))",
          boxShadow: isPlaying
            ? "0 0 8px 2px hsl(var(--primary) / 0.4)"
            : "0 0 4px 1px hsl(var(--primary) / 0.2)",
        }}
      />

      {/* Small triangle handle at top */}
      <div
        className="absolute"
        style={{
          left: position,
          top: 0,
          transform: "translateX(-50%)",
        }}
      >
        <svg width={handleSize * 2} height={handleSize} viewBox={`0 0 ${handleSize * 2} ${handleSize}`}>
          <polygon
            points={`0,0 ${handleSize * 2},0 ${handleSize},${handleSize}`}
            fill="hsl(var(--primary))"
          />
        </svg>
      </div>

      {/* Playing indicator pulse at handle */}
      {isPlaying && (
        <div
          className="absolute rounded-full animate-ping"
          style={{
            left: position,
            top: handleSize / 2,
            width: 6,
            height: 6,
            transform: "translate(-50%, -50%)",
            background: "hsl(var(--primary))",
            opacity: 0.5,
          }}
        />
      )}
    </div>
  );
});

export default PlayheadCursor;
