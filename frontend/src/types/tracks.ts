import type * as d3 from "d3";
import type { HistogramItem } from "@/modules/histogram/useHistogramCache";

export type TrackId =
  | "voice-detection"
  | "data-presence"
  | "transcriptions"
  | "audio-chunks"
  | "diarizations"
  | "objects";

// Object categories for timeline grouping
export type ObjectCategory = "person" | "event" | "relationship" | "promise" | "other";

export type ObjectsLayoutMode = "mixed" | "by-category";

export interface ObjectCategoryConfig {
  id: ObjectCategory;
  label: string;
  color: string;
  icon: string;
}

export const OBJECT_CATEGORIES: ObjectCategoryConfig[] = [
  { id: "event", label: "Events", color: "#8b5cf6", icon: "📅" },
  { id: "person", label: "People", color: "#3b82f6", icon: "👤" },
  { id: "relationship", label: "Relationships", color: "#ec4899", icon: "🔗" },
  { id: "promise", label: "Promises", color: "#f97316", icon: "🤝" },
  { id: "other", label: "Other", color: "#6b7280", icon: "📦" },
];

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
