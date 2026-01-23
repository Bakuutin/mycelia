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
    <div className="flex items-center gap-2 mr-auto">
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
          <p>Run job on range</p>
        </TooltipContent>
      </Tooltip>
      <RunJobDialog
        open={isRunJobOpen}
        onOpenChange={setIsRunJobOpen}
        startDate={startDate}
        endDate={endDate}
      />

      {isShortRange && (
        <>
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
              <p>Summarize range</p>
            </TooltipContent>
          </Tooltip>
          <SummarizeDialog
            open={isSummarizeOpen}
            onOpenChange={setIsSummarizeOpen}
            startDate={startDate}
            endDate={endDate}
          />
        </>
      )}

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
          <p>Create object from range</p>
        </TooltipContent>
      </Tooltip>

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
          <p>Clear selection</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
