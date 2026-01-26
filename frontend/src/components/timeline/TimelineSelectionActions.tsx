import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Maximize2,
  CircleOff,
  CalendarPlus,
  Wand2,
  Play,
} from "lucide-react";
import { SummarizeDialog } from "@/components/dialogs/SummarizeDialog";
import { RunJobDialog } from "@/components/dialogs/RunJobDialog";

interface TimelineSelectionActionsProps {
  startDate: Date;
  endDate: Date;
  isShortRange: boolean;
  onZoomToSelection: () => void;
  onCreateEvent: () => void;
  onClearSelection: () => void;
}

export function TimelineSelectionActions({
  startDate,
  endDate,
  isShortRange,
  onZoomToSelection,
  onCreateEvent,
  onClearSelection,
}: TimelineSelectionActionsProps) {
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [isRunJobOpen, setIsRunJobOpen] = useState(false);

  return (
    <div className="flex items-start gap-3 mr-auto">
      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onZoomToSelection}
              variant="outline"
              size="icon"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Zoom to selected range</p>
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">Zoom</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsRunJobOpen(true)}
            >
              <Play className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Run job on selected range</p>
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">Run Job</span>
      </div>
      <RunJobDialog
        open={isRunJobOpen}
        onOpenChange={setIsRunJobOpen}
        startDate={startDate}
        endDate={endDate}
      />

      {isShortRange && (
        <>
          <div className="flex flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsSummarizeOpen(true)}
                >
                  <Wand2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Generate AI summary for range</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-xs text-muted-foreground">Summarize</span>
          </div>
          <SummarizeDialog
            open={isSummarizeOpen}
            onOpenChange={setIsSummarizeOpen}
            startDate={startDate}
            endDate={endDate}
          />
        </>
      )}

      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onCreateEvent}
              variant="outline"
              size="icon"
            >
              <CalendarPlus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Create new object from selected range</p>
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">Create</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onClearSelection}
              variant="outline"
              size="icon"
            >
              <CircleOff className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Clear time selection</p>
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">Clear</span>
      </div>
    </div>
  );
}
