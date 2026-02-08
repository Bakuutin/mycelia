import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TrackId, ObjectCategory, ObjectsLayoutMode } from "@/types/tracks";

const DEFAULT_VISIBLE_TRACKS: TrackId[] = [
  "voice-detection",
  "data-presence",
  "transcriptions",
  "audio-chunks",
  "diarizations",
  "objects",
  "audio-sources",
];

const DEFAULT_HEIGHTS: Record<TrackId, number> = {
  "voice-detection": 32,
  "data-presence": 20,
  "transcriptions": 40,
  "audio-chunks": 40,
  "diarizations": 40,
  "objects": 120,
  "audio-sources": 48,
};

const ALL_OBJECT_CATEGORIES: ObjectCategory[] = [
  "event",
  "person",
  "relationship",
  "promise",
  "other",
];

interface TrackVisibilityState {
  visibleTracks: TrackId[];
  trackHeights: Record<string, number>;
  objectsLayoutMode: ObjectsLayoutMode;
  visibleObjectCategories: ObjectCategory[];
  toggleTrack: (id: TrackId) => void;
  setTrackHeight: (id: TrackId, height: number) => void;
  showAll: () => void;
  hideAll: () => void;
  resetDefaults: () => void;
  isVisible: (id: TrackId) => boolean;
  setObjectsLayoutMode: (mode: ObjectsLayoutMode) => void;
  toggleObjectCategory: (category: ObjectCategory) => void;
}

export const useTrackVisibilityStore = create<TrackVisibilityState>()(
  persist(
    (set, get) => ({
      visibleTracks: [...DEFAULT_VISIBLE_TRACKS],
      trackHeights: { ...DEFAULT_HEIGHTS },
      objectsLayoutMode: "by-category" as ObjectsLayoutMode,
      visibleObjectCategories: [...ALL_OBJECT_CATEGORIES],

      toggleTrack: (id) => {
        set((state) => {
          const isCurrentlyVisible = state.visibleTracks.includes(id);
          if (isCurrentlyVisible) {
            return {
              visibleTracks: state.visibleTracks.filter((t) => t !== id),
            };
          } else {
            return {
              visibleTracks: [...state.visibleTracks, id],
            };
          }
        });
      },

      setTrackHeight: (id, height) => {
        set((state) => ({
          trackHeights: { ...state.trackHeights, [id]: height },
        }));
      },

      showAll: () => set({ visibleTracks: [...DEFAULT_VISIBLE_TRACKS] }),
      hideAll: () => set({ visibleTracks: [] }),
      resetDefaults: () =>
        set({
          visibleTracks: [...DEFAULT_VISIBLE_TRACKS],
          trackHeights: { ...DEFAULT_HEIGHTS },
          objectsLayoutMode: "by-category",
          visibleObjectCategories: [...ALL_OBJECT_CATEGORIES],
        }),

      isVisible: (id) => get().visibleTracks.includes(id),

      setObjectsLayoutMode: (mode) => set({ objectsLayoutMode: mode }),

      toggleObjectCategory: (category: ObjectCategory) => {
        set((state) => {
          const isVisible = state.visibleObjectCategories.includes(category);
          if (isVisible) {
            return {
              visibleObjectCategories: state.visibleObjectCategories.filter(
                (c: ObjectCategory) => c !== category
              ),
            };
          } else {
            return {
              visibleObjectCategories: [...state.visibleObjectCategories, category],
            };
          }
        });
      },
    }),
    {
      name: "track-visibility",
    }
  )
);
