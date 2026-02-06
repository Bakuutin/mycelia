import { memo, useMemo } from "react";
import type { ScaleTime } from "d3-scale";
import type { ZoomTransform } from "d3-zoom";

interface TimeGridLinesProps {
  /** D3 time scale */
  scale: ScaleTime<number, number>;
  /** D3 zoom transform */
  transform: ZoomTransform;
  /** Width of the container in pixels */
  width: number;
}

// Format a date for the grid line label based on duration context
function formatGridLabel(date: Date, durationMs: number): string {
  const hour = 1000 * 60 * 60;
  const day = hour * 24;
  const week = day * 7;
  const month = day * 30;
  const year = day * 365;

  // For very short ranges (< 1 hour), show time with seconds
  if (durationMs < hour) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  // For ranges < 1 day, show time only
  if (durationMs < day) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  // For ranges < 1 week, show weekday and time
  if (durationMs < week) {
    const weekday = date.toLocaleDateString([], { weekday: "short" });
    const time = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${weekday} ${time}`;
  }

  // For ranges < 2 months, show date
  if (durationMs < month * 2) {
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  }

  // For ranges < 2 years, show month and year
  if (durationMs < year * 2) {
    return date.toLocaleDateString([], {
      month: "short",
      year: "numeric",
    });
  }

  // For very long ranges, show year only
  return date.getFullYear().toString();
}

/**
 * TimeGridLines - Renders vertical grid lines at time intervals across the timeline.
 * Adapts to zoom level: shows years, months, weeks, days, or hours.
 * Aims for approximately 5-15 marks on display.
 */
export const TimeGridLines = memo(function TimeGridLines({
  scale,
  transform,
  width,
}: TimeGridLinesProps) {
  // Calculate grid lines based on current scale and transform
  const gridLines = useMemo(() => {
    const rescaledScale = transform.rescaleX(scale);
    const domain = rescaledScale.domain();
    const durationMs = domain[1].getTime() - domain[0].getTime();
    
    // Target 5-15 ticks, so about every 100-200 pixels
    const targetTickCount = Math.max(5, Math.min(15, Math.floor(width / 120)));
    const tickValues = rescaledScale.ticks(targetTickCount);

    return tickValues.map((date) => ({
      date,
      x: rescaledScale(date),
      label: formatGridLabel(date, durationMs),
    }));
  }, [scale, transform, width]);

  return (
    <div
      className="absolute inset-0 pointer-events-none z-10"
      style={{ overflow: "hidden" }}
    >
      {gridLines.map((line, index) => {
        // Skip lines outside visible area
        if (line.x < 0 || line.x > width) return null;

        return (
          <div key={index} className="absolute top-0 bottom-0" style={{ left: line.x }}>
            {/* Vertical line */}
            <div
              className="absolute top-0 bottom-0 border-l border-border/40"
              style={{ left: 0 }}
            />
            {/* Label at top */}
            <div
              className="absolute top-0 text-[10px] text-muted-foreground whitespace-nowrap"
              style={{
                left: 4,
                top: 2,
              }}
            >
              {line.label}
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default TimeGridLines;
