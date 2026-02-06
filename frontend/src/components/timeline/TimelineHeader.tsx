import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineSelectionActions } from "./TimelineSelectionActions";
import { TrackVisibilityButton } from "./controls/TrackVisibilityPanel";

interface TimelineHeaderProps {
  hasTimeSelection: boolean;
  timeSelectionStart?: Date;
  timeSelectionEnd?: Date;
  isShortRange: boolean;
  onZoomToFit: () => void;
  onTimeRangeSelect: (range: string) => void;
  onZoomToSelection: () => void;
  onZoomToRange?: (start: Date, end: Date) => void;
  onCreateEvent: () => void;
  onClearTimeSelection: () => void;
}

export function TimelineHeader({
  hasTimeSelection,
  timeSelectionStart,
  timeSelectionEnd,
  isShortRange,
  onZoomToFit,
  onTimeRangeSelect,
  onZoomToSelection,
  onZoomToRange,
  onCreateEvent,
  onClearTimeSelection,
}: TimelineHeaderProps) {
  return (
    <div className="flex items-start justify-end gap-2">
      {/* Selection and toolbar controls */}
      {hasTimeSelection && timeSelectionStart && timeSelectionEnd && (
        <TimelineSelectionActions
          startDate={timeSelectionStart}
          endDate={timeSelectionEnd}
          isShortRange={isShortRange}
          onZoomToSelection={onZoomToSelection}
          onCreateEvent={onCreateEvent}
          onClearSelection={onClearTimeSelection}
        />
      )}
      <TimelineToolbar
        onZoomToFit={onZoomToFit}
        onTimeRangeSelect={onTimeRangeSelect}
        onZoomToRange={onZoomToRange}
      />
      <TrackVisibilityButton />
    </div>
  );
}
