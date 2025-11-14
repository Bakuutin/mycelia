import React, { useMemo } from "react";
import type { Layer, LayerComponentProps } from "@/core/core.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { useTimelineBins } from "@/hooks/useTimelineData.ts";
import { getResolutionForDuration, RESOLUTION_TO_MS } from "@/lib/resolution.ts";
import type { TimelineItem } from "@/types/timeline.ts";

const BIN_HEIGHT = 25;

interface BinProps {
  bin: TimelineItem;
  startX: number;
  endX: number;
  width: number;
}

const Bin: React.FC<BinProps> = ({ bin, startX, width }) => {
  const fillColor = bin.stale
    ? "rgba(239, 68, 68, 0.3)" // Light red for stale
    : "rgba(34, 197, 94, 0.3)"; // Light green for fresh

  const strokeColor = bin.stale
    ? "rgba(239, 68, 68, 0.5)"
    : "rgba(34, 197, 94, 0.5)";

  return (
    <rect
      x={startX}
      y={0}
      width={width}
      height={BIN_HEIGHT}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={0.5}
      className="cursor-pointer"
      title={`${bin.stale ? "Stale" : "Fresh"} bin: ${bin.start.toISOString()} - ${bin.end.toISOString()}`}
    />
  );
};

export const HistogramLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { start, end } = useTimelineRange();

      // Calculate appropriate resolution based on duration
      const resolution = useMemo(() => {
        const duration = end.getTime() - start.getTime();
        return getResolutionForDuration(duration);
      }, [start, end]);

      // Calculate which bins we need to fetch based on visible range
      const binStarts = useMemo(() => {
        const binSize = RESOLUTION_TO_MS[resolution];
        const startTime = start.getTime();
        const endTime = end.getTime();

        // Calculate the first bin that overlaps with our range
        const firstBinStart = Math.floor(startTime / binSize) * binSize;
        // Calculate the last bin that overlaps with our range
        const lastBinStart = Math.ceil(endTime / binSize) * binSize;

        const bins: number[] = [];
        for (let binStart = firstBinStart; binStart <= lastBinStart; binStart += binSize) {
          bins.push(binStart);
        }

        console.log("[HistogramLayer] Calculated bin starts:", {
          resolution,
          binSize,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          firstBinStart: new Date(firstBinStart).toISOString(),
          lastBinStart: new Date(lastBinStart).toISOString(),
          binCount: bins.length,
        });

        return bins;
      }, [start, end, resolution]);

      // Fetch all needed bins in parallel
      const binQueries = useTimelineBins(binStarts, resolution);

      // Calculate x positions for bins
      const xFor = useMemo(() => {
        return (d: Date) => transform.applyX(scale(d));
      }, [scale, transform]);

      // Process bin query results into visible bins
      const visibleBins = useMemo(() => {
        return binQueries
          .map((query, index) => {
            const binStart = binStarts[index];
            const bin = query.data;

            if (!bin) return null;

            const binStartDate = new Date(binStart);
            const binEndDate = new Date(binStart + RESOLUTION_TO_MS[resolution]);

            // Only show bins that overlap with the visible range
            if (binEndDate <= start || binStartDate >= end) {
              return null;
            }

            const startX = Math.max(0, xFor(binStartDate));
            const endX = Math.min(width, xFor(binEndDate));
            const binWidth = endX - startX;

            if (binWidth <= 1) return null; // Too narrow to see

            return {
              ...bin,
              startX,
              endX,
              width: binWidth,
            };
          })
          .filter((bin): bin is NonNullable<typeof bin> => bin !== null);
      }, [binQueries, binStarts, resolution, start, end, xFor, width]);

      const isLoading = binQueries.some((query) => query.isLoading);
      const hasError = binQueries.some((query) => query.error);

      console.log("[HistogramLayer] State:", {
        resolution,
        start: start.toISOString(),
        end: end.toISOString(),
        duration: end.getTime() - start.getTime(),
        binCount: binStarts.length,
        isLoading,
        hasError,
        visibleBinsCount: visibleBins.length,
        loadedBins: binQueries.filter((q) => q.data).length,
      });

      // Show loading only if we have bins to load and none are loaded yet
      if (isLoading && visibleBins.length === 0 && binStarts.length > 0) {
        return (
          <svg width={width} height={BIN_HEIGHT} className="zoomable">
            <text
              x={width / 2}
              y={BIN_HEIGHT / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12px"
              fill="#6b7280"
            >
              Loading bins...
            </text>
          </svg>
        );
      }

      // Show error only if there's an actual error and no bins loaded
      if (hasError && visibleBins.length === 0) {
        return (
          <svg width={width} height={BIN_HEIGHT} className="zoomable">
            <text
              x={width / 2}
              y={BIN_HEIGHT / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12px"
              fill="#ef4444"
            >
              Error loading bins
            </text>
          </svg>
        );
      }

      // Empty bins is not an error - just render empty layer or partial bins
      if (visibleBins.length === 0) {
        return (
          <svg width={width} height={BIN_HEIGHT} className="zoomable" />
        );
      }

      return (
        <svg width={width} height={BIN_HEIGHT} className="zoomable">
          {visibleBins.map((bin) => (
            <Bin
              key={bin.id}
              bin={bin}
              startX={bin.startX}
              endX={bin.endX}
              width={bin.width}
            />
          ))}
        </svg>
      );
    },
  } as Layer;
};

