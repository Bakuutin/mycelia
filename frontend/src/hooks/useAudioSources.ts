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
 * Fetch distinct audio sources for a time range.
 * Re-fetches when start/end change (debounced).
 */
export function useAudioSources(start: Date, end: Date) {
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [loading, setLoading] = useState(false);
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
          setSources(
            data.sources.map((s: any) => ({
              ...s,
              firstChunk: new Date(s.firstChunk),
              lastChunk: new Date(s.lastChunk),
            }))
          );
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to fetch audio sources:", err);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    // Debounce to avoid excessive fetches during zoom/pan
    const timer = setTimeout(fetchSources, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [start.getTime(), end.getTime()]);

  return { sources, loading };
}
