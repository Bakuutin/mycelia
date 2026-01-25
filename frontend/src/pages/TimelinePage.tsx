import { useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TimelineChart } from "@/components/timeline/TimelineChart";
import { TimelineHeader } from "@/components/timeline/TimelineHeader";
import { SelectedObjectsPanel } from "@/components/timeline/SelectedObjectsPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { config } from "@/config";
import { useObjects } from "@/modules/objects/useObjects";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore";
import { useTimelineSelectionStore } from "@/stores/timelineSelectionStore";
import { useSpanningObjectsStore } from "@/stores/spanningObjectsStore";
import { useTimeline } from "@/hooks/useTimeline";
import { api } from "@/lib/api";

const TimelinePage = () => {
  const navigate = useNavigate();
  const { error, objects } = useObjects();
  const { clearSelection: clearObjectSelection, selectedIds } =
    useObjectSelectionStore();
  const { selection: timeSelection, clearSelection: clearTimeSelection } =
    useTimelineSelectionStore();
  const spanningObjects = useSpanningObjectsStore(
    (state) => state.spanningObjects,
  );
  const ongoingObjects = useSpanningObjectsStore(
    (state) => state.ongoingObjects,
  );

  const timeline = useTimeline();
  const { zoomTo } = timeline;
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

  const selectedObjects = useMemo(() => {
    if (!objects || selectedIds.size === 0) return [];
    return objects.filter((object) => selectedIds.has(object._id.toString()));
  }, [objects, selectedIds]);

  const panelObjects = useMemo(() => {
    const excludedIds = new Set([
      ...spanningObjects.map((o) => o._id.toString()),
      ...ongoingObjects.map((o) => o._id.toString()),
    ]);
    const selectedNotExcluded = selectedObjects.filter(
      (o) => !excludedIds.has(o._id.toString()),
    );
    return [...ongoingObjects, ...spanningObjects, ...selectedNotExcluded];
  }, [spanningObjects, ongoingObjects, selectedObjects]);

  const handleZoomToSelection = () => {
    if (timeSelection.start && timeSelection.end) {
      zoomTo(timeSelection.start, timeSelection.end);
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

  const handleZoomToFit = useCallback(async () => {
    try {
      const result = await api.callResource("objects", {
        action: "getTimeRange",
      });

      if (result.start && result.end) {
        const earliest = result.start instanceof Date ? result.start : new Date(result.start);
        const latest = result.end instanceof Date ? result.end : new Date(result.end);

        const duration = latest.getTime() - earliest.getTime();
        const padding = duration * 0.05;
        const paddedStart = new Date(earliest.getTime() - padding);
        const paddedEnd = new Date(latest.getTime() + padding);
        zoomTo(paddedStart, paddedEnd);
      }
    } catch (err) {
      console.error("Failed to get time range:", err);
    }
  }, [zoomTo]);

  const handleTimeRangeSelect = (range: string) => {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    switch (range) {
      case "last5min":
        start = new Date(now.getTime() - 5 * 60 * 1000);
        break;
      case "lastHour":
        start = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "today":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "yesterday":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "thisWeek": {
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + mondayOffset,
        );
        break;
      }
      case "currentMonth":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearToDate":
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case "pastYear":
        start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        return;
    }

    zoomTo(start, end);
  };

  if (error) {
    return (
      <div className="space-y-6">
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
        <TimelineHeader
          hasTimeSelection={hasTimeSelection}
          timeSelectionStart={timeSelection.start}
          timeSelectionEnd={timeSelection.end}
          isShortRange={isShortRange}
          onZoomToFit={handleZoomToFit}
          onTimeRangeSelect={handleTimeRangeSelect}
          onZoomToSelection={handleZoomToSelection}
          onCreateEvent={handleCreateEvent}
          onClearTimeSelection={clearTimeSelection}
        />

        <div className="border rounded-lg p-2">
          <TimelineChart timeline={timeline} layers={config.layers} />
        </div>

        <SelectedObjectsPanel
          selectedObjects={panelObjects}
          onClear={clearObjectSelection}
          hasSelections={selectedIds.size > 0}
        />
      </div>
    </TooltipProvider>
  );
};

export default TimelinePage;
