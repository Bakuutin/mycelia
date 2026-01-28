import type * as d3 from "d3";
import type { HistogramItem } from "@/modules/histogram/useHistogramCache";

export type TrackId =
  | "voice-detection"
  | "data-presence"
  | "transcriptions"
  | "audio-chunks"
  | "diarizations"
  | "objects";

export interface TrackConfig {
  id: TrackId;
  label: string;
  description?: string;
  defaultVisible: boolean;
  defaultHeight: number;
  color: string;
}

export interface TrackRenderProps {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  width: number;
  height: number;
  items: HistogramItem[];
}

export interface Track {
  config: TrackConfig;
  component: React.ComponentType<TrackRenderProps>;
}

export interface TrackVisibilityState {
  visibleTracks: Set<TrackId>;
  trackHeights: Record<TrackId, number>;
  toggleTrack: (id: TrackId) => void;
  setTrackHeight: (id: TrackId, height: number) => void;
  showAll: () => void;
  hideAll: () => void;
  resetDefaults: () => void;
}
