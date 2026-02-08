import { useEffect, useState, useRef } from "react";
import { apiClient } from "@/lib/api";

export interface AudioSource {
  originalId: string;
  label: string;
  count: number;
  firstChunk: Date;
  lastChunk: Date;
}

/**
 * Auto-collapse sources with identical labels (e.g., same microphone).
 * Merges them into a single source with combined stats.
 */
function collapseSourcesByLabel(sources: AudioSource[]): AudioSource[] {
  if (sources.length <= 1) return sources;

  // Group by label
  const byLabel = new Map<string, AudioSource[]>();
  for (const source of sources) {
    const existing = byLabel.get(source.label) || [];
    existing.push(source);
    byLabel.set(source.label, existing);
  }

  // Merge sources with same label
  const result: AudioSource[] = [];
  for (const [label, group] of byLabel) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      // Merge multiple sources with same label
      result.push({
        originalId: group[0].originalId, // Use first source's ID for selection
        label: `${label} (${group.length} merged)`,
        count: group.reduce((sum, s) => sum + s.count, 0),
        firstChunk: new Date(Math.min(...group.map(s => s.firstChunk.getTime()))),
        lastChunk: new Date(Math.max(...group.map(s => s.lastChunk.getTime()))),
      });
    }
  }

  return result;
}

/**
 * Fetch distinct audio sources for a time range.
 * Re-fetches when start/end change (debounced).
 */
export function useAudioSources(start: Date, end: Date) {
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [skippedWideRange, setSkippedWideRange] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!start || !end) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fetchSources = async () => {
      setLoading(true);
      try {
        const resp = await apiClient.get(
          `/data/audio/sources?start=${start.getTime()}&end=${end.getTime()}`,
        );
        if (controller.signal.aborted) return;

        const data = resp as { sources: any[] };
        if (data?.sources) {
          const parsed = data.sources.map((s: any) => ({
            ...s,
            firstChunk: new Date(s.firstChunk),
            lastChunk: new Date(s.lastChunk),
          }));
          // Auto-collapse sources with identical labels (same microphone)
          setSources(collapseSourcesByLabel(parsed));
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to fetch audio sources:", err);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    // Debounce: longer delay for wider ranges (aggregation is heavier)
    const rangeMs = end.getTime() - start.getTime();
    // Skip fetch for very wide ranges (>90 days) - aggregation too slow
    if (rangeMs > 90 * 24 * 60 * 60 * 1000) {
      setSources([]);
      setSkippedWideRange(true);
      return;
    }
    setSkippedWideRange(false);
    const debounceMs = rangeMs > 7 * 24 * 60 * 60 * 1000 ? 800 : 400;
    const timer = setTimeout(fetchSources, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [start.getTime(), end.getTime()]);

  return { sources, loading, skippedWideRange };
}
