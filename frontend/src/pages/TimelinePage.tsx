import { useEffect, useRef } from "react";
import { TimelineChart } from "@/components/timeline/TimelineChart";
import { config } from "@/config";
import { useObjects } from "@/modules/objects/useObjects";
import { useTimelineRange } from "@/stores/timelineRange";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

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
  const { loading, error, objects } = useObjects();
  const { setRange } = useTimelineRange();
  const { clearSelection, selectedIds } = useObjectSelectionStore();
  const hasRescaledRef = useRef(false);
  const hasSelection = selectedIds.size > 0;

  // Clear selection when navigating away
  useEffect(() => {
    return () => {
      clearSelection();
    };
  }, [clearSelection]);

  // Rescale timeline to fit all objects when they finish loading
  useEffect(() => {
    if (loading || hasRescaledRef.current || !objects || objects.length === 0) {
      return;
    }

    // Extract all time ranges from objects
    const allTimes: Date[] = [];
    for (const object of objects) {
      if (object.timeRanges && object.timeRanges.length > 0) {
        for (const range of object.timeRanges) {
          allTimes.push(range.start);
          if (range.end) {
            allTimes.push(range.end);
          } else {
            // If no end time, use start time as end (for point events)
            allTimes.push(range.start);
          }
        }
      }
    }

    if (allTimes.length === 0) {
      return;
    }

    // Find earliest and latest times
    const earliest = new Date(Math.min(...allTimes.map(t => t.getTime())));
    const latest = new Date(Math.max(...allTimes.map(t => t.getTime())));

    // Add padding (5% on each side)
    const duration = latest.getTime() - earliest.getTime();
    const padding = duration * 0.05;
    const paddedStart = new Date(earliest.getTime() - padding);
    const paddedEnd = new Date(latest.getTime() + padding);

    // Set the range
    setRange(paddedStart, paddedEnd);
    hasRescaledRef.current = true;
  }, [loading, objects, setRange]);

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
          <div className="flex items-center gap-2">
            {config.tools.map((tool, i) => (
              <ToolWrapper key={i} tool={tool} />
            ))}
          </div>
        </div>

        <div className="border rounded-lg p-2">
          <TimelineChart />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default TimelinePage;
