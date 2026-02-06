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
  initFromURL: () => void;
}

// Helper to update URL params without triggering navigation
function updateSelectionURLParams(start: Date | null, end: Date | null) {
  if (typeof window === "undefined") return;

  const url = new URL(globalThis.location.href);
  if (start && end) {
    url.searchParams.set("selStart", start.getTime().toString());
    url.searchParams.set("selEnd", end.getTime().toString());
  } else {
    url.searchParams.delete("selStart");
    url.searchParams.delete("selEnd");
  }
  globalThis.history.replaceState({}, "", url.toString());
}

// Helper to read selection from URL
function getSelectionFromURL(): TimelineSelection {
  if (typeof window === "undefined") {
    return { start: null, end: null };
  }

  const params = new URLSearchParams(globalThis.location.search);
  const selStartParam = params.get("selStart");
  const selEndParam = params.get("selEnd");

  if (selStartParam && selEndParam) {
    const startMs = parseInt(selStartParam, 10);
    const endMs = parseInt(selEndParam, 10);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      return {
        start: new Date(startMs),
        end: new Date(endMs),
      };
    }
  }

  return { start: null, end: null };
}

export const useTimelineSelectionStore = create<TimelineSelectionStore>()(
  devtools(
    (set) => ({
      selection: {
        start: null,
        end: null,
      },
      setSelection: (selection) => {
        set({ selection }, false, "setSelection");
        updateSelectionURLParams(selection.start, selection.end);
      },
      clearSelection: () => {
        set(
          { selection: { start: null, end: null } },
          false,
          "clearSelection",
        );
        updateSelectionURLParams(null, null);
      },
      initFromURL: () => {
        const selection = getSelectionFromURL();
        if (selection.start && selection.end) {
          set({ selection }, false, "initFromURL");
        }
      },
    }),
    {
      name: "timeline-selection-store",
    },
  ),
);




