import { useEffect, useRef } from "react";
import { TimelineChart } from "@/components/timeline/TimelineChart";
import { config } from "@/config";
import { useObjects } from "@/modules/objects/useObjects";
import { useTimelineRange } from "@/stores/timelineRange";

const TimelinePage = () => {
  const { loading, error, objects } = useObjects();
  const { setRange } = useTimelineRange();
  const hasRescaledRef = useRef(false);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="flex items-center gap-2">
          {config.tools.map((tool, i) => <tool.component key={i} />)}
        </div>
      </div>

      <div className="border rounded-lg p-2">
        <TimelineChart />
      </div>
    </div>
  );
};

export default TimelinePage;
