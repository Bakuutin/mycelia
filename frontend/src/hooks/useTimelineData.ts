import { useQueries } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { LoaderData, TimelineItem } from "@/types/timeline";
import { zLoaderData } from "@/types/timeline";
import type { Resolution } from "@/lib/resolution";
import { RESOLUTION_TO_MS } from "@/lib/resolution";

export const timelineDataKeys = {
  all: ["timeline"] as const,
  bin: (binStart: number, resolution: Resolution) =>
    [...timelineDataKeys.all, "bin", binStart, resolution] as const,
};

/**
 * Fetches a single timeline bin from the backend
 * @param binStart - Start timestamp of the bin
 * @param resolution - Resolution for the histogram bin
 * @returns Query result with bin data
 */
function fetchTimelineBin(
  binStart: number,
  resolution: Resolution,
): Promise<TimelineItem | null> {
  const binSize = RESOLUTION_TO_MS[resolution];
  const binEnd = binStart + binSize;

  const params = new URLSearchParams({
    start: binStart.toString(),
    end: binEnd.toString(),
    resolution,
  });

  const url = `/data/audio/items?${params.toString()}`;
  console.log("[fetchTimelineBin] Fetching bin:", {
    url,
    binStart: new Date(binStart).toISOString(),
    binEnd: new Date(binEnd).toISOString(),
    resolution,
  });

  return apiClient
    .get<LoaderData>(url)
    .then((response) => {
      console.log("[fetchTimelineBin] Raw response:", response);

      // Validate response with Zod schema
      const validated = zLoaderData.parse(response);

      // Find the bin that matches our binStart
      const bin = validated.items.find(
        (item) => item.start.getTime() === binStart,
      );

      if (!bin) {
        console.log("[fetchTimelineBin] Bin not found in response");
        return null;
      }

      console.log("[fetchTimelineBin] Found bin:", bin);
      return bin;
    })
    .catch((error) => {
      console.error("[fetchTimelineBin] Error fetching bin:", error);
      throw error;
    });
}

/**
 * Fetches multiple timeline bins in parallel
 * @param binStarts - Array of bin start timestamps
 * @param resolution - Resolution for the histogram bins
 * @returns Array of query results for each bin
 */
export function useTimelineBins(
  binStarts: number[],
  resolution: Resolution,
) {
  return useQueries({
    queries: binStarts.map((binStart) => ({
      queryKey: timelineDataKeys.bin(binStart, resolution),
      queryFn: () => fetchTimelineBin(binStart, resolution),
      enabled: binStarts.length > 0,
      staleTime: 5 * 60 * 1000, // 5 minutes - bins don't change often
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });
}

