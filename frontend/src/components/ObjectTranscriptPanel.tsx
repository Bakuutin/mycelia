import { useEffect, useState, useRef, useMemo } from "react";
import { Play, FileText, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callResource } from "@/lib/api";
import { useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime } from "@/lib/formatTime";
import { cn } from "@/lib/utils";

interface ObjectTranscriptPanelProps {
  timeRange: { start: Date | string; end?: Date | string | null };
}

interface TranscriptSegment {
  start: number; // seconds from transcript start
  end: number;
  text: string;
}

interface TranscriptionDoc {
  _id: unknown;
  start: Date;
  end: Date;
  segments: TranscriptSegment[];
}

interface RenderSegment {
  time: Date;
  endTime: Date;
  text: string;
}

export function ObjectTranscriptPanel({ timeRange }: ObjectTranscriptPanelProps) {
  const [segments, setSegments] = useState<RenderSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);

  const { currentDate, resetDate, setIsPlaying } = useAudioPlayer();
  const { timeFormat } = useSettingsStore();
  const currentSegmentRef = useRef<HTMLDivElement>(null);
  const lastScrolledIndex = useRef<number>(-1);

  // Find the index of the currently playing segment
  const currentSegmentIndex = segments.findIndex(seg =>
    currentDate &&
    currentDate >= seg.time &&
    currentDate < seg.endTime
  );

  // Auto-scroll to current segment when it changes (only if sync enabled)
  useEffect(() => {
    if (syncEnabled && currentSegmentIndex >= 0 && currentSegmentIndex !== lastScrolledIndex.current) {
      lastScrolledIndex.current = currentSegmentIndex;
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        currentSegmentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [currentSegmentIndex, syncEnabled]);

  // Memoize dates to prevent infinite re-renders when end is null
  const startDate = useMemo(() => {
    return typeof timeRange.start === "string"
      ? new Date(timeRange.start)
      : timeRange.start;
  }, [timeRange.start]);

  // For endDate, we use a stable fallback (1 hour from start) instead of new Date()
  // to prevent infinite re-renders when timeRange.end is null
  const endDate = useMemo(() => {
    if (timeRange.end) {
      return typeof timeRange.end === "string" ? new Date(timeRange.end) : timeRange.end;
    }
    // Fallback: 1 hour from start instead of current time to keep it stable
    return new Date(startDate.getTime() + 60 * 60 * 1000);
  }, [timeRange.end, startDate]);

  useEffect(() => {
    async function fetchTranscripts() {
      setLoading(true);
      setError(null);

      try {
        const docs: TranscriptionDoc[] = await callResource("mongo", {
          action: "find",
          collection: "transcriptions",
          query: {
            start: { $lt: endDate },
            end: { $gt: startDate },
          },
          options: { sort: { start: 1 }, limit: 500 },
        });

        // Convert to render segments with absolute timestamps
        const rendered: RenderSegment[] = [];
        for (const doc of docs) {
          for (const s of doc.segments || []) {
            const absStart = new Date(new Date(doc.start).getTime() + s.start * 1000);
            const absEnd = new Date(new Date(doc.start).getTime() + s.end * 1000);
            // Only include segments that overlap with our time range
            if (absEnd > startDate && absStart < endDate) {
              rendered.push({
                time: absStart,
                endTime: absEnd,
                text: (s.text || "").replace(/\n/g, " ").trim(),
              });
            }
          }
        }

        // Sort by time
        rendered.sort((a, b) => a.time.getTime() - b.time.getTime());
        setSegments(rendered);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch transcripts");
      } finally {
        setLoading(false);
      }
    }

    fetchTranscripts();
  }, [startDate, endDate]);

  const handlePlayFromSegment = (segmentTime: Date) => {
    resetDate(segmentTime);
    setIsPlaying(true);
  };

  // Format duration between two dates
  const formatDuration = (start: Date, end: Date): string => {
    const diffMs = end.getTime() - start.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    if (diffSeconds < 60) return `${diffSeconds}s`;
    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  if (loading) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
        </h3>
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
        </h3>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">
          No transcript available for this time range
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
          <span className="text-xs font-normal">({segments.length} segments)</span>
        </h3>
        <Button
          variant={syncEnabled ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSyncEnabled(!syncEnabled)}
          title={syncEnabled ? "Sync enabled - click to disable" : "Sync disabled - click to enable"}
          className="h-7 px-2 gap-1"
        >
          {syncEnabled ? (
            <Link2 className="w-3.5 h-3.5" />
          ) : (
            <Link2Off className="w-3.5 h-3.5" />
          )}
          <span className="text-xs">{syncEnabled ? "Sync" : "No sync"}</span>
        </Button>
      </div>

      <ScrollArea className="h-[400px] pr-3">
        <div className="space-y-1">
          {segments.map((seg, idx) => {
            const isCurrentSegment = syncEnabled && idx === currentSegmentIndex;
            return (
              <div
                key={idx}
                ref={isCurrentSegment ? currentSegmentRef : null}
                className={cn(
                  "group flex items-start gap-2 p-2 rounded transition-colors cursor-pointer",
                  isCurrentSegment
                    ? "bg-primary/10 border-l-2 border-primary"
                    : "hover:bg-muted/80"
                )}
                onClick={() => handlePlayFromSegment(seg.time)}
              >
                <div className={cn(
                  "flex-shrink-0 w-6 h-6 flex items-center justify-center",
                  isCurrentSegment ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100"
                )}>
                  <Play className="w-3 h-3" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn(
                      "text-xs font-mono",
                      isCurrentSegment ? "text-primary font-medium" : "text-muted-foreground"
                    )}>
                      {formatTime(seg.time, timeFormat)}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      ({formatDuration(seg.time, seg.endTime)})
                    </span>
                  </div>
                  <p className={cn(
                    "text-sm leading-relaxed",
                    isCurrentSegment && "font-medium"
                  )}>{seg.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
