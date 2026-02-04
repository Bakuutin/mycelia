import { Link } from "react-router-dom";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useRecordingStore,
  recordingResources,
  formatDuration,
} from "@/stores/recordingStore";
import { cn } from "@/lib/utils";

export function RecordingIndicator() {
  const { isRecording, recordingDuration, deviceLabel } = useRecordingStore();

  if (!isRecording) {
    return null;
  }

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (recordingResources.stopRecordingFn) {
      recordingResources.stopRecordingFn();
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to="/audio/record">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 px-2 h-9 text-red-500 hover:text-red-600 hover:bg-red-500/10"
          >
            {/* Pulsing recording dot */}
            <span className="relative flex h-3 w-3">
              <span
                className={cn(
                  "animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75",
                )}
              />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>

            {/* Duration */}
            <span className="font-mono text-sm font-medium">
              {formatDuration(recordingDuration)}
            </span>

            {/* Stop button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 hover:bg-red-500/20"
              onClick={handleStop}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          </Button>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>
          Recording{deviceLabel ? ` from ${deviceLabel}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">Click to view, stop to end</p>
      </TooltipContent>
    </Tooltip>
  );
}
