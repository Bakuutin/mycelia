import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface PlayheadHandleProps {
  /** Position in pixels from the left edge */
  position: number;
  /** Height of the vertical line */
  height: number;
  /** Whether the playhead is currently playing */
  isPlaying?: boolean;
  /** Called when the user starts dragging */
  onDragStart?: () => void;
  /** Called during drag with the new X position relative to container */
  onDrag?: (x: number) => void;
  /** Called when the user stops dragging */
  onDragEnd?: () => void;
  /** Container element for calculating relative position during drag */
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * PlayheadHandle - A draggable playhead indicator for the timeline audio scrubber.
 * Features:
 * - Pill-shaped handle at the top for grabbing
 * - Vertical line with subtle glow
 * - Drag-to-scrub functionality
 * - Visual feedback on hover and drag
 */
export function PlayheadHandle({
  position,
  height,
  isPlaying = false,
  onDragStart,
  onDrag,
  onDragEnd,
  containerRef,
}: PlayheadHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const handleRef = useRef<SVGGElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      onDragStart?.();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!containerRef?.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = moveEvent.clientX - rect.left;
        onDrag?.(Math.max(0, Math.min(x, rect.width)));
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        onDragEnd?.();
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [containerRef, onDragStart, onDrag, onDragEnd]
  );

  // Handle width for the pill shape
  const handleWidth = 14;
  const handleHeight = 18;
  const lineWidth = 2;

  return (
    <g
      ref={handleRef}
      transform={`translate(${position}, 0)`}
      className={cn(
        "transition-opacity",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      onMouseDown={handleMouseDown}
    >
      {/* Glow effect behind the line */}
      <line
        x1={0}
        y1={handleHeight}
        x2={0}
        y2={height}
        stroke="hsl(var(--primary))"
        strokeWidth={6}
        opacity={0.2}
        className="pointer-events-none"
      />

      {/* Main vertical line */}
      <line
        x1={0}
        y1={handleHeight}
        x2={0}
        y2={height}
        stroke="hsl(var(--primary))"
        strokeWidth={lineWidth}
        className="pointer-events-none"
      />

      {/* Handle pill shape */}
      <rect
        x={-handleWidth / 2}
        y={0}
        width={handleWidth}
        height={handleHeight}
        rx={handleWidth / 2}
        ry={handleWidth / 2}
        fill="hsl(var(--primary))"
        className={cn(
          "transition-all duration-150",
          isDragging && "scale-110"
        )}
        style={{
          filter: isDragging ? "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" : undefined,
          transformOrigin: "center",
        }}
      />

      {/* Inner indicator line on handle */}
      <line
        x1={0}
        y1={4}
        x2={0}
        y2={handleHeight - 4}
        stroke="hsl(var(--primary-foreground))"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.8}
        className="pointer-events-none"
      />

      {/* Playing indicator dot */}
      {isPlaying && (
        <circle
          cx={0}
          cy={handleHeight / 2}
          r={2}
          fill="hsl(var(--primary-foreground))"
          className="animate-pulse pointer-events-none"
        />
      )}
    </g>
  );
}

export default PlayheadHandle;
