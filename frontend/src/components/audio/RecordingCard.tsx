import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Mic,
  Play,
  Settings2,
  FileAudio,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAudioPlayer } from "@/modules/audio/player";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ObjectId } from "bson";

export interface SourceFileRecord {
  _id: string;
  start: Date;
  size?: number;
  extension?: string;
  ingested?: boolean;
  importer?: string;
  platform?: {
    system?: string;
    node?: string;
  };
  metadata?: {
    rate?: number;
    width?: number;
    channels?: number;
    format?: string;
    source?: string;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  };
  processing_status?: string;
}

interface RecordingCardProps {
  recording: SourceFileRecord;
}

export function RecordingCard({ recording }: RecordingCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { resetDate, setIsPlaying } = useAudioPlayer();

  // Fetch chunk count when expanded
  const { data: chunkCount, isLoading: isLoadingChunks } = useQuery({
    queryKey: ["recording-chunks", recording._id],
    queryFn: async () => {
      const count = await api.callResource("mongo", {
        action: "count",
        collection: "audio_chunks",
        query: { original_id: new ObjectId(recording._id) },
      });
      return count as number;
    },
    enabled: isExpanded,
  });

  // Calculate duration from chunks (approximate based on chunk count)
  const { data: durationData, isLoading: isLoadingDuration } = useQuery({
    queryKey: ["recording-duration", recording._id],
    queryFn: async () => {
      // Get first and last chunk to calculate duration
      const chunks = await api.callResource("mongo", {
        action: "find",
        collection: "audio_chunks",
        query: { original_id: new ObjectId(recording._id) },
        options: {
          sort: { start: 1 },
          limit: 1,
          projection: { start: 1 },
        },
      }) as Array<{ start: Date }>;

      const lastChunks = await api.callResource("mongo", {
        action: "find",
        collection: "audio_chunks",
        query: { original_id: new ObjectId(recording._id) },
        options: {
          sort: { start: -1 },
          limit: 1,
          projection: { start: 1 },
        },
      }) as Array<{ start: Date }>;

      if (chunks.length > 0 && lastChunks.length > 0) {
        const firstTime = new Date(chunks[0].start).getTime();
        const lastTime = new Date(lastChunks[0].start).getTime();
        // Add approximate chunk duration (1 second for opus at default settings)
        return Math.ceil((lastTime - firstTime) / 1000) + 1;
      }
      return 0;
    },
    enabled: true,
  });

  const handlePlay = () => {
    resetDate(new Date(recording.start));
    setIsPlaying(true);
  };

  const formatDurationDisplay = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  const startDate = new Date(recording.start);
  const metadata = recording.metadata || {};

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Main row - always visible */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors",
            isExpanded && "border-b",
          )}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {/* Play button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
          >
            <Play className="h-4 w-4" />
          </Button>

          {/* Recording info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">
                {format(startDate, "MMM d, yyyy 'at' h:mm a")}
              </span>
              <span className="text-xs text-muted-foreground">
                ({formatDistanceToNow(startDate, { addSuffix: true })})
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {durationData !== undefined && !isLoadingDuration ? (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDurationDisplay(durationData)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <Loader2 className="h-3 w-3 animate-spin" />
                </span>
              )}
              {metadata.rate && (
                <span className="text-xs text-muted-foreground">
                  {metadata.rate / 1000} kHz
                </span>
              )}
              {recording.processing_status && (
                <Badge
                  variant={
                    recording.processing_status === "complete"
                      ? "secondary"
                      : "outline"
                  }
                  className="text-xs h-5"
                >
                  {recording.processing_status}
                </Badge>
              )}
            </div>
          </div>

          {/* Expand button */}
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="p-3 bg-muted/30 space-y-3">
            {/* Audio settings */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Settings2 className="h-3.5 w-3.5" />
                Recording Settings
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <Mic className="h-3 w-3 text-muted-foreground" />
                  <span>Sample Rate:</span>
                  <span className="font-medium">
                    {metadata.rate ? `${metadata.rate / 1000} kHz` : "Unknown"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>Channels:</span>
                  <span className="font-medium">{metadata.channels || 1}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>Format:</span>
                  <span className="font-medium">{metadata.format || "pcm"}</span>
                </div>
              </div>
            </div>

            {/* Processing options */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Audio Processing
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={metadata.echoCancellation ? "default" : "outline"}
                  className="text-xs"
                >
                  Echo Cancellation: {metadata.echoCancellation ? "On" : "Off"}
                </Badge>
                <Badge
                  variant={metadata.noiseSuppression ? "default" : "outline"}
                  className="text-xs"
                >
                  Noise Suppression: {metadata.noiseSuppression ? "On" : "Off"}
                </Badge>
                <Badge
                  variant={metadata.autoGainControl ? "default" : "outline"}
                  className="text-xs"
                >
                  Auto Gain: {metadata.autoGainControl ? "On" : "Off"}
                </Badge>
              </div>
            </div>

            {/* File info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileAudio className="h-3.5 w-3.5" />
                File Details
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                {recording.size !== undefined && (
                  <div>
                    <span>Size: </span>
                    <span className="font-medium">
                      {(recording.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                )}
                {!isLoadingChunks && chunkCount !== undefined && (
                  <div>
                    <span>Chunks: </span>
                    <span className="font-medium">{chunkCount}</span>
                  </div>
                )}
                <div>
                  <span>Ingested: </span>
                  <span className="font-medium">
                    {recording.ingested ? "Yes" : "No"}
                  </span>
                </div>
                {recording.importer && (
                  <div>
                    <span>Source: </span>
                    <span className="font-medium">{recording.importer}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
