import { useEffect, useState } from "react";
import { Play, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callResource } from "@/lib/api";
import { useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime } from "@/lib/formatTime";

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

  const { resetDate, setIsPlaying } = useAudioPlayer();
  const { timeFormat } = useSettingsStore();

  const startDate = typeof timeRange.start === "string"
    ? new Date(timeRange.start)
    : timeRange.start;

  const endDate = timeRange.end
    ? (typeof timeRange.end === "string" ? new Date(timeRange.end) : timeRange.end)
    : new Date(); // If no end date, use now

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
  }, [startDate.getTime(), endDate.getTime()]);

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
      <Card className="p-4 bg-muted/50">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
        </h3>
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 bg-muted/50">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
        </h3>
        <p className="text-sm text-red-500">{error}</p>
      </Card>
    );
  }

  if (segments.length === 0) {
    return (
      <Card className="p-4 bg-muted/50">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Transcript
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">
          No transcript available for this time range
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-muted/50">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Transcript
        <span className="text-xs font-normal">({segments.length} segments)</span>
      </h3>

      <ScrollArea className="h-[300px] pr-3">
        <div className="space-y-1">
          {segments.map((seg, idx) => (
            <div
              key={idx}
              className="group flex items-start gap-2 p-2 rounded hover:bg-muted/80 transition-colors"
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                onClick={() => handlePlayFromSegment(seg.time)}
                title="Play from here"
              >
                <Play className="w-3 h-3" />
              </Button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatTime(seg.time, timeFormat)}
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    ({formatDuration(seg.time, seg.endTime)})
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{seg.text}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}
