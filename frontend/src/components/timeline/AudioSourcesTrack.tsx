import { memo, useMemo, useCallback } from "react";
import type { ScaleTime } from "d3-scale";
import type { ZoomTransform } from "d3-zoom";
import { useTimelineRange } from "@/stores/timelineRange";
import { useAudioSources, type AudioSource } from "@/hooks/useAudioSources";
import { useAudioPlayer } from "@/modules/audio/player";
import { cn } from "@/lib/utils";

interface AudioSourcesTrackProps {
  scale: ScaleTime<number, number>;
  transform: ZoomTransform;
  width: number;
}

const LANE_HEIGHT = 24;
const COLORS = [
  "hsl(199, 89%, 48%)", // cyan
  "hsl(262, 83%, 58%)", // purple
  "hsl(25, 95%, 53%)",  // orange
  "hsl(142, 71%, 45%)", // green
  "hsl(346, 77%, 50%)", // pink
  "hsl(47, 96%, 53%)",  // yellow
];

/**
 * AudioSourcesTrack - Shows distinct audio sources as horizontal lanes.
 * Click a source to filter playback to that source.
 */
export const AudioSourcesTrack = memo(function AudioSourcesTrack({
  scale,
  transform,
  width,
}: AudioSourcesTrackProps) {
  const { start, end } = useTimelineRange();
  const { sources, loading } = useAudioSources(start, end);
  const { originalId, setOriginalId, resetDate, setIsPlaying, currentDate } = useAudioPlayer();

  const rescaledScale = useMemo(
    () => transform.rescaleX(scale),
    [scale, transform]
  );

  const handleSourceClick = useCallback(
    (source: AudioSource) => {
      if (originalId === source.originalId) {
        // Deselect - go back to auto mode
        setOriginalId(null);
      } else {
        setOriginalId(source.originalId);
        // If we have a current position, restart from there on the new source
        if (currentDate) {
          resetDate(currentDate);
          setIsPlaying(true);
        }
      }
    },
    [originalId, setOriginalId, resetDate, setIsPlaying, currentDate]
  );

  if (sources.length <= 1 && !loading) {
    return null; // Don't show if there's 0 or 1 source
  }

  const height = sources.length * LANE_HEIGHT + 4;

  return (
    <div className="relative" style={{ height }} data-no-seek>
      {/* Label showing count */}
      <div
        className="track-header absolute left-0 top-0 px-2 py-0.5 text-xs font-medium text-muted-foreground bg-background/80 backdrop-blur-sm rounded-br z-10"
        style={{ pointerEvents: "none" }}
      >
        Audio Sources ({sources.length})
      </div>

      {/* Source lanes */}
      <svg width={width} height={height} className="w-full">
        {sources.map((source, idx) => {
          const y = idx * LANE_HEIGHT + 2;
          const x1 = rescaledScale(source.firstChunk);
          const x2 = rescaledScale(source.lastChunk);
          const barX = Math.max(0, Math.min(x1, width));
          const barW = Math.max(4, Math.min(x2, width) - barX);
          const color = COLORS[idx % COLORS.length];
          const isSelected = originalId === source.originalId;
          const isOtherSelected = originalId !== null && !isSelected;

          return (
            <g
              key={source.originalId}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                handleSourceClick(source);
              }}
            >
              {/* Lane background */}
              <rect
                x={barX}
                y={y}
                width={barW}
                height={LANE_HEIGHT - 2}
                rx={3}
                fill={color}
                opacity={isOtherSelected ? 0.15 : 0.35}
                stroke={isSelected ? color : "none"}
                strokeWidth={isSelected ? 2 : 0}
              />

              {/* Selected highlight */}
              {isSelected && (
                <rect
                  x={barX}
                  y={y}
                  width={barW}
                  height={LANE_HEIGHT - 2}
                  rx={3}
                  fill={color}
                  opacity={0.5}
                />
              )}

              {/* Label */}
              <foreignObject
                x={barX + 4}
                y={y}
                width={Math.max(barW - 8, 60)}
                height={LANE_HEIGHT - 2}
              >
                <div
                  className={cn(
                    "flex items-center gap-1.5 h-full text-xs truncate",
                    isSelected ? "font-semibold text-foreground" : "text-muted-foreground",
                    isOtherSelected && "opacity-50"
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{source.label}</span>
                  <span className="text-[10px] opacity-60">({source.count})</span>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

export default AudioSourcesTrack;
