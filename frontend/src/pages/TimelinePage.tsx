import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, ChevronDown } from "lucide-react";
import { MultiTrackTimeline } from "@/components/timeline/MultiTrackTimeline";
import { TimelineHeader } from "@/components/timeline/TimelineHeader";
import { TimelinePlayerBar } from "@/components/timeline/TimelinePlayerBar";
import { SelectedObjectsPanel } from "@/components/timeline/SelectedObjectsPanel";
import { TrackVisibilityPanel } from "@/components/timeline/controls/TrackVisibilityPanel";
import { ObjectTranscriptPanel } from "@/components/ObjectTranscriptPanel";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AudioPlayer, useAudioPlayer } from "@/modules/audio/player";
import { useObjects } from "@/modules/objects/useObjects";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore";
import { useTimelineSelectionStore } from "@/stores/timelineSelectionStore";

import { useTimeline } from "@/hooks/useTimeline";
import { useTimelineRange } from "@/stores/timelineRange";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMarkedRangesStore } from "@/stores/markedRangesStore";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const TimelinePage = () => {
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const { error, objects } = useObjects();
  const { clearSelection: clearObjectSelection, selectedIds } =
    useObjectSelectionStore();
  const { selection: timeSelection, clearSelection: clearTimeSelection, initFromURL: initSelectionFromURL } =
    useTimelineSelectionStore();

  const timeline = useTimeline();
  const { zoomTo } = timeline;
  const { start: rangeStart, end: rangeEnd, setRange } = useTimelineRange();
  const hasTimeSelection = !!(timeSelection.start && timeSelection.end);
  const isPlaying = useAudioPlayer((s) => s.isPlaying);
  const followPlayback = useSettingsStore((s) => s.followPlayback);

  // Apply start/end from URL when navigating to timeline with ?start=&end= (e.g. "View on timeline" from object)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const startParam = params.get("start");
    const endParam = params.get("end");
    if (!startParam) return;
    const startMs = parseInt(startParam, 10);
    if (Number.isNaN(startMs)) return;
    const start = new Date(startMs);
    const end = endParam ? new Date(parseInt(endParam, 10)) : new Date();
    if (endParam && Number.isNaN(end.getTime())) return;
    setRange(start, end);
  }, [location.search, setRange]);

  // Initialize selection from URL on mount
  useEffect(() => {
    initSelectionFromURL();
  }, [initSelectionFromURL]);

  // Load marked ranges from server on mount
  const { loadFromServer: loadMarkedRanges, loaded: markedRangesLoaded } = useMarkedRangesStore();
  useEffect(() => {
    if (!markedRangesLoaded) {
      loadMarkedRanges();
    }
  }, [loadMarkedRanges, markedRangesLoaded]);

  // Follow playback: immediately center on playhead when enabled,
  // then keep it in view while playing.
  useEffect(() => {
    if (!followPlayback) return;
    // Immediately center the timeline on the current playhead position
    const currentDate = useAudioPlayer.getState().currentDate;
    if (!currentDate) return;
    const { start, end } = useTimelineRange.getState();
    const duration = end.getTime() - start.getTime();
    const newStart = new Date(currentDate.getTime() - duration / 2);
    const newEnd = new Date(currentDate.getTime() + duration / 2);
    setRange(newStart, newEnd);
  }, [followPlayback, setRange]);

  // While playing + following, keep playhead in view via interval
  useEffect(() => {
    if (!followPlayback || !isPlaying) return;

    const intervalId = setInterval(() => {
      const currentDate = useAudioPlayer.getState().currentDate;
      if (!currentDate) return;
      const { start, end } = useTimelineRange.getState();
      const duration = end.getTime() - start.getTime();
      const playheadTime = currentDate.getTime();

      // Recenter if playhead is off-screen or within 10% of either edge
      const threshold = duration * 0.1;
      const isOffScreen = playheadTime < start.getTime() || playheadTime > end.getTime();
      const nearEdge =
        playheadTime - start.getTime() < threshold ||
        end.getTime() - playheadTime < threshold;

      if (isOffScreen || nearEdge) {
        const newStart = new Date(playheadTime - duration / 2);
        const newEnd = new Date(playheadTime + duration / 2);
        useTimelineRange.getState().setRange(newStart, newEnd);
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [followPlayback, isPlaying]);

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

  // Objects visible in the current timeline range
  const visibleObjects = useMemo(() => {
    if (!objects || !rangeStart || !rangeEnd) return [];
    return objects.filter((object) => {
      if (!object.timeRanges || object.timeRanges.length === 0) return false;
      return object.timeRanges.some((range: { start: Date | string; end?: Date | string | null }) => {
        const start = new Date(range.start).getTime();
        const end = range.end ? new Date(range.end).getTime() : Date.now();
        return start < rangeEnd.getTime() && end > rangeStart.getTime();
      });
    });
  }, [objects, rangeStart, rangeEnd]);

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
      <div className="flex gap-4">
        {/* Main timeline content */}
        <div className="flex-1 space-y-6 min-w-0">
          <TimelineHeader
            hasTimeSelection={hasTimeSelection}
            timeSelectionStart={timeSelection.start}
            timeSelectionEnd={timeSelection.end}
            isShortRange={isShortRange}
            onZoomToFit={handleZoomToFit}
            onTimeRangeSelect={handleTimeRangeSelect}
            onZoomToSelection={handleZoomToSelection}
            onZoomToRange={zoomTo}
            onCreateEvent={handleCreateEvent}
            onClearTimeSelection={clearTimeSelection}
          />

          <div className="border rounded-lg p-2 overflow-visible">
            <TimelinePlayerBar
              scale={timeline.timeScale}
              transform={timeline.transform}
              width={timeline.width}
              className="border-0 rounded-none mb-1"
            />
            <MultiTrackTimeline timeline={timeline} />
          </div>

          {/* Hidden audio player component that handles actual playback */}
          <AudioPlayer />

          {/* Transcript (left) and Objects (right) side by side */}
          <div className="grid grid-cols-2 gap-4">
            {/* Collapsible transcript panel synced with player */}
            <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen} className="border rounded-lg p-4">
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full cursor-pointer">
                  <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Transcript
                  </h3>
                  <ChevronDown className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform duration-200",
                    transcriptOpen && "rotate-180"
                  )} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                {rangeStart && rangeEnd && (
                  <ObjectTranscriptPanel
                    timeRange={{ start: rangeStart, end: rangeEnd }}
                  />
                )}
              </CollapsibleContent>
            </Collapsible>

            <SelectedObjectsPanel
              selectedObjects={visibleObjects}
              onClear={clearObjectSelection}
              hasSelections={selectedIds.size > 0}
              selectedIds={selectedIds}
            />
          </div>
        </div>

        {/* Side panel for track visibility */}
        <TrackVisibilityPanel />
      </div>
    </TooltipProvider>
  );
};

export default TimelinePage;
