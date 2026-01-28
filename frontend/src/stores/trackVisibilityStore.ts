import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TrackId } from "@/types/tracks";

const DEFAULT_VISIBLE_TRACKS: TrackId[] = [
  "voice-detection",
  "data-presence",
  "transcriptions",
  "audio-chunks",
  "diarizations",
  "objects",
];

const DEFAULT_HEIGHTS: Record<TrackId, number> = {
  "voice-detection": 32,
  "data-presence": 20,
  "transcriptions": 40,
  "audio-chunks": 40,
  "diarizations": 40,
  "objects": 120,
};

interface TrackVisibilityState {
  visibleTracks: TrackId[];
  trackHeights: Record<string, number>;
  toggleTrack: (id: TrackId) => void;
  setTrackHeight: (id: TrackId, height: number) => void;
  showAll: () => void;
  hideAll: () => void;
  resetDefaults: () => void;
  isVisible: (id: TrackId) => boolean;
}

export const useTrackVisibilityStore = create<TrackVisibilityState>()(
  persist(
    (set, get) => ({
      visibleTracks: [...DEFAULT_VISIBLE_TRACKS],
      trackHeights: { ...DEFAULT_HEIGHTS },

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
        }),

      isVisible: (id) => get().visibleTracks.includes(id),
    }),
    {
      name: "track-visibility",
    }
  )
);
