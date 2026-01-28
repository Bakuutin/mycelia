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
  onCreateEvent,
  onClearTimeSelection,
}: TimelineHeaderProps) {
  return (
    <div className="flex items-start justify-end gap-2">
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
      />
      <TrackVisibilityButton />
    </div>
  );
}
