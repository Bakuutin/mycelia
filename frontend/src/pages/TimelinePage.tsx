import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, callResource } from "@/lib/api";
import { TimelineChart } from "@/components/timeline/TimelineChart";
import { config } from "@/config";
import { useObjects } from "@/modules/objects/useObjects";
import { useTimelineRange } from "@/stores/timelineRange";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore";
import { useTimelineSelectionStore } from "@/stores/timelineSelectionStore";
import { useTimeline } from "@/hooks/useTimeline";
// import { useTimelineRecalc } from "@/hooks/useTimelineRecalc";
import type { Model } from "@/types/llm";
import type { Prompt } from "@/types/config";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  X,
  Maximize2,
  CircleOff,
  RefreshCw,
  CalendarPlus,
  Loader2,
  Minimize2,
  Wand2,
} from "lucide-react";
import { SummarizeDialog } from "@/components/dialogs/SummarizeDialog";

// Yes, it's module level
// We wanted it that way :)
let hasZoomedToFit = false;

const ToolWrapper = ({ tool }: { tool: any }) => {
  const Component = tool.component;

  if (!tool.tooltip) {
    return <Component />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Wrap in a span because some components might not forward refs or handle events correctly */}
        <span className="inline-flex">
          <Component />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tool.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const TimelinePage = () => {
  const navigate = useNavigate();
  const { loading, error, objects } = useObjects();
  const { setRange } = useTimelineRange();
  const { clearSelection: clearObjectSelection, selectedIds } =
    useObjectSelectionStore();
  const { selection: timeSelection, clearSelection: clearTimeSelection } =
    useTimelineSelectionStore();
  const [recalculating, setRecalculating] = useState(false);
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);

  const timeline = useTimeline();
  // const { processingRanges } = useTimelineRecalc(); // Moved to ProcessingLayer
  const { zoomTo } = timeline;
  const hasObjectSelection = selectedIds.size > 0;
  const hasTimeSelection = !!(timeSelection.start && timeSelection.end);

  const isShortRange =
    timeSelection.start &&
    timeSelection.end &&
    timeSelection.end.getTime() - timeSelection.start.getTime() <
      24 * 60 * 60 * 1000;

  // Clear selection when navigating away
  useEffect(() => {
    return () => {
      clearObjectSelection();
      clearTimeSelection();
    };
  }, [clearObjectSelection, clearTimeSelection]);

  const handleZoomToSelection = () => {
    if (timeSelection.start && timeSelection.end) {
      zoomTo(timeSelection.start, timeSelection.end);
    }
  };

  const handleRecalculate = async () => {
    if (!timeSelection.start || !timeSelection.end) return;
    setRecalculating(true);
    try {
      await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "histRecalculation",
          start: timeSelection.start,
          end: timeSelection.end,
          all: false,
        },
        trigger: {
          type: "manual",
          reason: `Manual recalculation from timeline range selection`,
        },
      });
      console.log("Recalculation job queued");
    } catch (e) {
      console.error("Failed to queue recalculation job:", e);
    } finally {
      // Short delay to show feedback, as the job is async
      setTimeout(() => setRecalculating(false), 500);
    }
  };

  const handleCreateEvent = () => {
    if (!timeSelection.start) return;

    const params = new URLSearchParams();
    params.set("start", timeSelection.start.getTime().toString());
    if (timeSelection.end) {
      params.set("end", timeSelection.end.getTime().toString());
    }
    navigate(`/objects/create?${params.toString()}`);
  };

  const handleZoomToFit = useCallback(() => {
    if (!objects || objects.length === 0) return;

    console.log("Zooming to fit", objects.length, "objects");

    const allTimes: Date[] = [];
    for (const object of objects) {
      if (object.timeRanges && object.timeRanges.length > 0) {
        for (const range of object.timeRanges) {
          allTimes.push(range.start);
          if (range.end) {
            allTimes.push(range.end);
          } else {
            allTimes.push(range.start);
          }
        }
      }
    }

    if (allTimes.length === 0) return;

    const earliest = new Date(Math.min(...allTimes.map((t) => t.getTime())));
    const latest = new Date(Math.max(...allTimes.map((t) => t.getTime())));

    const duration = latest.getTime() - earliest.getTime();
    const padding = duration * 0.05;
    const paddedStart = new Date(earliest.getTime() - padding);
    const paddedEnd = new Date(latest.getTime() + padding);
    zoomTo(paddedStart, paddedEnd);
  }, [objects, zoomTo]);

  useEffect(() => {
    if (!loading && objects && objects.length > 0 && !hasZoomedToFit) {
      setTimeout(() => {
        handleZoomToFit();
      }, 500);
      hasZoomedToFit = true;
    }
  }, [loading, objects, handleZoomToFit]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading objects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500 mb-2">Error loading objects: {error}</p>
          <p className="text-sm text-muted-foreground">
            Check browser console for details
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Timeline</h1>
          <div className="flex items-center flex-1 justify-end gap-2 ml-4">
            {hasTimeSelection && (
              <div className="flex items-center gap-2 mr-auto">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleZoomToSelection}
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
                      onClick={handleRecalculate}
                      variant="outline"
                      size="icon"
                      disabled={recalculating}
                    >
                      {recalculating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Recalculate histograms</p>
                  </TooltipContent>
                </Tooltip>

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
                      startDate={timeSelection.start || new Date()}
                      endDate={timeSelection.end || new Date()}
                    />
                  </>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleCreateEvent}
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
                      onClick={clearTimeSelection}
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
            )}
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleZoomToFit}
                    variant="outline"
                    size="icon"
                  >
                    <Minimize2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Zoom to fit all objects</p>
                </TooltipContent>
              </Tooltip>
              {config.tools.map((tool, i) => (
                <ToolWrapper key={i} tool={tool} />
              ))}
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-2">
          <TimelineChart
            timeline={timeline}
            layers={config.layers}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default TimelinePage;
