import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface TimelineSelection {
  start: Date | null;
  end: Date | null;
}

interface TimelineSelectionStore {
  selection: TimelineSelection;
  setSelection: (selection: TimelineSelection) => void;
  clearSelection: () => void;
}

export const useTimelineSelectionStore = create<TimelineSelectionStore>()(
  devtools(
    (set) => ({
      selection: {
        start: null,
        end: null,
      },
      setSelection: (selection) => set({ selection }, false, "setSelection"),
      clearSelection: () =>
        set(
          { selection: { start: null, end: null } },
          false,
          "clearSelection",
        ),
    }),
    {
      name: "timeline-selection-store",
    },
  ),
);

