import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineSelectionActions } from "./TimelineSelectionActions";
import { TrackVisibilityButton } from "./controls/TrackVisibilityPanel";
import { TimelinePlayerControls } from "./TimelinePlayerControls";

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
    <div className="flex items-start justify-between gap-2">
      {/* Player Controls - Left side */}
      <TimelinePlayerControls />

      {/* Right side controls */}
      <div className="flex items-start gap-2">
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
    </div>
  );
}
