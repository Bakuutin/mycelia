import { useState, useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Maximize2,
  CircleOff,
  CalendarPlus,
  Wand2,
  Play,
  Star,
  StarOff,
  Pencil,
  Trash2,
} from "lucide-react";
import { SummarizeDialog } from "@/components/dialogs/SummarizeDialog";
import { RunJobDialog } from "@/components/dialogs/RunJobDialog";
import { useMarkedRangesStore } from "@/stores/markedRangesStore";

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
  const [isMarkPopoverOpen, setIsMarkPopoverOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState("");
  
  const { ranges, addRange, removeRange, updateRange } = useMarkedRangesStore();

  // Check if current selection matches an existing marked range
  const matchingRange = useMemo(() => {
    return ranges.find(
      (r) =>
        Math.abs(r.start.getTime() - startDate.getTime()) < 1000 &&
        Math.abs(r.end.getTime() - endDate.getTime()) < 1000
    );
  }, [ranges, startDate, endDate]);

  const handleMarkRange = () => {
    if (matchingRange) {
      // Open popover to edit/delete
      setEditingLabel(matchingRange.label || "");
      setIsMarkPopoverOpen(true);
    } else {
      // Create new marked range
      addRange(startDate, endDate);
    }
  };

  const handleSaveLabel = () => {
    if (matchingRange) {
      updateRange(matchingRange.id, { label: editingLabel || undefined });
      setIsMarkPopoverOpen(false);
    }
  };

  const handleDeleteRange = () => {
    if (matchingRange) {
      removeRange(matchingRange.id);
      setIsMarkPopoverOpen(false);
    }
  };

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
        {matchingRange ? (
          // Existing marked range - show popover for edit/delete
          <Popover open={isMarkPopoverOpen} onOpenChange={setIsMarkPopoverOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-yellow-500"
                    style={{ borderColor: matchingRange.color }}
                  >
                    <Star className="w-4 h-4 fill-current" style={{ color: matchingRange.color }} />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit marked range</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent className="w-64" align="start">
              <div className="space-y-3">
                <div className="font-medium text-sm">Edit Marked Range</div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    placeholder="Enter label..."
                    className="h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveLabel();
                    }}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveLabel} className="flex-1">
                    <Pencil className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleDeleteRange}>
                    <Trash2 className="w-3 h-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          // No existing range - simple mark button
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleMarkRange}
                variant="outline"
                size="icon"
              >
                <Star className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Mark/favorite this range</p>
            </TooltipContent>
          </Tooltip>
        )}
        <span className="text-xs text-muted-foreground">
          {matchingRange ? "Marked" : "Mark"}
        </span>
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
